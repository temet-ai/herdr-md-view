// md-view: a markdown panel beside the terminal a .md path was Ctrl-clicked in.
// View, Edit and Split modes, auto-save, and a send button beside every block and
// list item that quotes its lines back into that terminal.
import { View, div, image, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, TextView, Editor, EditorState, ScrollHandle } from "gpui-base";
import { checking, exec, hc, notify, window as window_, panes, props, readTextFile, run, setShared, settings, shared, theme, watchFolder, writeTextFile } from "herdr";
import { parseBlocks, parseChart, tidyInline } from "./blocks.js";
import { configPath, loadConfig, resolveFont, saveConfig, starterConfig, DEFAULTS } from "./config.js";
import { settingsPage } from "./settings.js";
import { cacheImage, renderDiagram } from "./media.js";
import { blockAtLine, closeFind, findBar, goHistory, markChanged, nextChanged, onKey, openFind, openPicker, outline, picker, remember, scrollTo, updateMatches } from "./features.js";

const dirOf = (p) => p.slice(0, p.lastIndexOf("/")) || "/";
const nameOf = (p) => p.slice(p.lastIndexOf("/") + 1);
const extOf = (p) => (nameOf(p).includes(".") ? nameOf(p).split(".").pop().toLowerCase() : "");
const isMarkdown = (p) => ["md", "markdown", "mdx"].includes(extOf(p));

// Clipboard. terminal.paste pastes Herdr's own copy of the clipboard, which only follows
// changes made through Herdr at once, so the quote goes in with cx.write_to_clipboard.
// The person's clipboard is read and put back with the system tools where they exist,
// because Herdr's copy can lag behind what another app copied.
async function readClipboard(cx) {
  if (window_().platform === "linux") {
    try { const r = await exec("wl-paste", ["--no-newline"]); if (r.code === 0) return r.stdout; } catch { /* not Wayland */ }
  }
  return cx.read_from_clipboard();
}

async function restoreClipboard(text, cx) {
  if (window_().platform === "linux") {
    try { if ((await exec("wl-copy", ["--", text])).code === 0) return; } catch { /* not Wayland */ }
  }
  cx.write_to_clipboard(text);
}

export default class MdView extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.tab = p.tab ?? null;      // set when the panel follows Ctrl-clicks in its tab
    this.file = null;              // absolute path shown
    this.source = p.source ?? null; // {pane, terminal, machine} the click came from
    this.openedAt = Date.now();
    this.base = "";                // text on disk
    this.draft = null;             // text in the editor, when editing
    this.error = null;
    this.conflict = false;
    this.parsed = { text: null, blocks: [] };
    this.codeStates = new Map();
    this.media = new Map();
    this.hover = null;
    this.width = 600;
    this.editor = null;
    this.config = DEFAULTS;
    this.configError = null;
    this.font = null;
    this.mode = DEFAULTS.mode;
    this.keys = cx.focus_handle(); // lets the panel's keys reach it
    this.scroll = ScrollHandle.new();
    this.pendingLine = p.line ?? null;
    this.history = []; this.histPos = -1; this.changed = []; this.cursor = 0;
    this.matches = []; this.findPos = -1; this.query = "";
    if (checking()) return;
    cx.spawn(async (cx) => {
      await this.reloadConfig(cx);
      this.mode = this.config.mode;
      // Hand edits to md-view.json apply without the Settings page: check it every 3 s.
      this.configText = await readTextFile(configPath());
      cx.timer.every(3000, (cx) => {
        cx.spawn(async (cx) => {
          const text = await readTextFile(configPath());
          if (text !== this.configText) { this.configText = text; await this.reloadConfig(cx); }
        });
      });
      if (this.mode !== "view") this.openEditor(cx);
      this.sync(cx);
      cx.notify();
    });
  }

  async close() {
    for (const s of this.codeStates.values()) s.release();
    this.editor?.release();
  }

  async reloadConfig(cx) {
    const { config, error } = await loadConfig();
    this.config = config;
    this.configError = error;
    this.font = await resolveFont(config, settings());
    // Sizes and colours are baked into code editors: rebuild them.
    for (const st of this.codeStates.values()) st.release();
    this.codeStates.clear();
    this.parsed = { text: null, blocks: this.parsed.blocks };
    if (cx) { this.reparse(cx); cx.notify(); }
  }

  key() {
    // A panel opened with a file of its own learns its tab from the terminal it came
    // from, so it follows later clicks there once panels are reused.
    if (!this.tab && this.source?.pane) this.tab = panes().find((p) => p.pane === this.source.pane)?.tab ?? null;
    return this.tab ? `md-view.file.${this.tab}` : null;
  }
  text() { return this.draft ?? this.base; }
  dirty() { return this.draft !== null && this.draft !== this.base; }
  myPane() { return panes().find((p) => p.mod === "md-view" && (this.tab ? p.tab === this.tab : p.focused))?.pane; }

  // What the panel should show: the last Ctrl-click in its tab, else its props.
  wanted() {
    const raw = this.key() ? shared(this.key()) : null;
    // Clicks from before this panel opened belong to another panel.
    if (raw && !(props()?.file && (raw.at ?? 0) < this.openedAt)) return typeof raw === "string" ? { path: raw, at: 0 } : raw;
    return props()?.file ? { path: props().file, at: 0, ...(props().source ?? {}) } : null;
  }

  sync(cx) {
    if (this.switching) return;
    const want = this.wanted();
    // Only a new click moves the panel; files opened from inside it (links, settings) stay.
    if (!want || want.at === this.at) return;
    if (want.path !== this.file && this.dirty()) return; // the header offers to save first
    this.switching = true;
    cx.spawn(async (cx) => { this.switching = false; this.open(want, cx); });
  }

  // Show a file. Runs in a task or handler (it may create an editor).
  open(want, cx) {
    this.at = want.at;
    if (want.pane) this.source = { pane: want.pane, terminal: want.terminal ?? null, machine: want.machine ?? null };
    if (want.line) this.pendingLine = want.line;
    if (!want.fromHistory) remember(this, want.path);
    if (want.path === this.file) { if (this.pendingLine) this.jumpPending(cx); cx.notify(); return; }
    this.changed = []; this.cursor = 0; this.showPicker = false;
    this.file = want.path;
    this.draft = null; this.conflict = false; this.error = null; this.base = ""; this.saveState = null;
    this.parsed = { text: null, blocks: [] };
    this.editor?.release(); this.editor = null;
    if (this.mode !== "view") this.openEditor(cx);
    this.watch(this.file, cx);
  }

  watch(file, cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        if (this.file !== file) return;
        const text = await readTextFile(file);
        if (this.file !== file) return;
        const first = this.loadedFor !== file; // the first read of this file is not a change
        if (text != null) this.loadedFor = file;
        const oldBlocks = this.parsed.blocks;
        let fromDisk = false;
        if (text == null) this.error = "Can't read this file: it is missing, bigger than 1 MiB, or not text.";
        else if (text !== this.base || this.error) {
          fromDisk = !first && !this.dirty();
          this.error = null;
          if (this.dirty()) this.conflict = true;
          else {
            this.base = text;
            if (this.editor && this.editor.value() !== text) this.editor.set_value(text);
            this.draft = this.editor ? text : null;
          }
          if (file === configPath()) await this.reloadConfig(cx);
        }
        this.reparse(cx);
        // Something else rewrote the file (an agent, say): mark what changed.
        if (fromDisk && this.mode === "view") markChanged(this, oldBlocks);
        if (this.showFind) updateMatches(this);
        if (this.pendingLine) this.jumpPending(cx);
        cx.notify();
        try { await watchFolder(dirOf(file)); } catch { return; }
      }
    });
  }

  jumpPending(cx) {
    if (!this.parsed.blocks.length) return;
    const line = this.pendingLine;
    this.pendingLine = null;
    scrollTo(this, blockAtLine(this, line), cx);
  }

  openEditor(cx) {
    if (this.editor) return;
    const t = theme();
    this.editor = EditorState.new({
      language: isMarkdown(this.file ?? ".md") ? "markdown" : extOf(this.file), value: this.text(),
      soft_wrap: true, line_numbers: true, folding: false, font_family: settings().font_family,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, punctuation: t.muted },
    });
    this.draft = this.text();
    this.editor.on("change", (_e, cx) => {
      this.draft = this.editor.value();
      this.reparse(cx);
      this.autosave?.cancel();
      if (!this.dirty()) { if (this.saveState === "unsaved") this.saveState = null; }
      else {
        this.saveState = "unsaved";
        if (this.config.autosave) this.autosave = cx.timer.after(this.config.autosave_delay_ms, (cx) => this.save(cx));
      }
      cx.notify();
    });
  }

  setMode(mode, cx) {
    if (this.config.allow_edit === false) mode = "view";
    this.mode = mode;
    this.showSettings = false;
    if (mode !== "view") { this.openEditor(cx); this.editor?.focus(); }
    cx.notify();
  }

  save(cx) {
    if (!this.file || !this.dirty() || this.conflict || this.saving) return;
    this.autosave?.cancel(); this.autosave = null;
    const file = this.file, text = this.draft, expected = this.base;
    this.saving = true; this.saveState = "saving";
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(file, text, expected);
        if (this.file === file) { this.base = text; this.conflict = false; }
        this.saveState = "saved";
        if (file === configPath()) await this.reloadConfig(cx);
      } catch {
        this.conflict = true; this.saveState = "conflict";
      }
      this.saving = false;
      if (this.config.autosave && this.file === file && this.dirty() && !this.conflict) this.autosave = cx.timer.after(400, (cx) => this.save(cx));
      cx.notify();
    });
  }

  reloadFromDisk(cx) {
    const file = this.file;
    cx.spawn(async (cx) => {
      const text = await readTextFile(file);
      if (text == null || this.file !== file) return;
      this.base = text; this.conflict = false; this.saveState = null;
      if (this.editor) { this.editor.set_value(text); this.draft = text; }
      this.reparse(cx);
      cx.notify();
    });
  }

  overwrite(cx) {
    const file = this.file;
    cx.spawn(async (cx) => {
      const disk = await readTextFile(file);
      if (disk == null || this.file !== file) return;
      this.base = disk; this.conflict = false; this.saving = false;
      this.save(cx);
    });
  }

  toggleSettings(cx) {
    this.showSettings = !this.showSettings;
    if (this.showSettings) this.keys?.focus();
    cx.notify();
  }

  // Change one setting (a dotted key), apply it here at once and save it for everyone.
  setSetting(key, value, cx) {
    const next = JSON.parse(JSON.stringify(this.config));
    const parts = key.split(".");
    let o = next;
    for (const k of parts.slice(0, -1)) o = o[k] ??= {};
    o[parts.at(-1)] = value;
    this.config = next;
    cx.notify();
    cx.spawn(async (cx) => {
      try { await saveConfig(next); this.configError = null; }
      catch (e) { this.configError = `Could not save settings: ${e?.message ?? e}`; }
      await this.reloadConfig(cx);
    });
  }

  resetSettings(cx) {
    this.config = DEFAULTS;
    cx.spawn(async (cx) => { await saveConfig(DEFAULTS); await this.reloadConfig(cx); });
  }

  // The raw file, for keys the page doesn't show.
  editSettingsFile(cx) {
    cx.spawn(async (cx) => {
      const path = configPath();
      if ((await readTextFile(path)) == null) await writeTextFile(path, starterConfig(), null);
      if (this.dirty()) return;
      this.showSettings = false;
      this.open({ path, at: this.at, ...(this.source ?? {}) }, cx);
      this.setMode("edit", cx);
    });
  }

  // ---------- sending lines back ----------
  target() {
    if (this.source?.pane && panes().some((p) => p.pane === this.source.pane)) return this.source;
    // The terminal is gone, or the panel was opened without a click: use one in this tab.
    const mine = panes().find((p) => p.mod === "md-view" && (this.tab ? p.tab === this.tab : true));
    const term = panes().find((p) => p.terminal && (!mine || p.tab === mine.tab));
    return term ? (this.source = { pane: term.pane, terminal: term.terminal, machine: null }) : null;
  }

  send(start, end, text, cx) {
    const to = this.target();
    if (!to) { notify({ title: "md-view", body: "No terminal in this tab to send to.", level: "warning" }); return; }
    const range = end - start > 1 ? `${start + 1}-${end}` : `${start + 1}`;
    const body = this.config.send.format === "plain" ? text : `${this.file}:${range}\n${text.split("\n").map((l) => `> ${l}`).join("\n")}`;
    if (this.config.send.mode === "submit") {
      const address = to.machine ? `${to.machine}/${to.terminal}` : to.terminal;
      hc(["send", address, body]).then((r) => { if (r.code !== 0) notify({ title: "md-view", body: r.stderr.trim() || "send failed", level: "error" }); });
      if (this.config.send.focus_terminal) run("pane.focus", { pane: to.pane });
      return;
    }
    const keep = this.config.send.keep_clipboard;
    cx.spawn(async (cx) => {
      const before = keep ? await readClipboard(cx) : undefined;
      cx.write_to_clipboard(`${body}\n`);
      // Herdr takes a moment to see its own clipboard change; paste after that.
      cx.timer.after(500, (cx) => {
        run("pane.focus", { pane: to.pane });
        run("terminal.paste");
        if (before !== undefined) cx.timer.after(1500, (cx) => { restoreClipboard(before, cx); });
      });
    });
  }

  sendSelection(cx) {
    const ed = this.editor;
    if (!ed) return;
    const { start, end } = ed.selected_range();
    const value = ed.value();
    const a = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    let b = value.indexOf("\n", Math.max(start, end - (end > start ? 1 : 0)));
    if (b < 0) b = value.length;
    const first = value.slice(0, a).split("\n").length - 1;
    const text = value.slice(a, b);
    this.send(first, first + text.split("\n").length, text, cx);
  }

  link(url, cx) {
    if (url.startsWith("#")) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("file:")) { cx.open_url(url); return; }
    let path = decodeURI(url.replace(/^file:\/\//, "").replace(/#.*$/, ""));
    if (!path.startsWith("/") && !/^[A-Za-z]:/.test(path)) path = `${dirOf(this.file)}/${path}`;
    if (!isMarkdown(path)) { cx.open_url(`file://${path}`); return; }
    const want = { path, at: Date.now(), ...(this.source ?? {}) };
    if (this.key()) setShared(this.key(), want);
    else if (!this.dirty()) this.open(want, cx);
  }

  // ---------- parsing and media ----------
  // Runs from tasks and handlers only: EditorState.new is not allowed during render.
  reparse(cx) {
    const text = this.text();
    if (this.parsed.text === text) return;
    const blocks = this.file && !isMarkdown(this.file)
      ? [{ kind: "code", lang: extOf(this.file), code: text.replace(/\n$/, ""), start: 0, end: text.split("\n").length, source: text }]
      : parseBlocks(text);
    this.parsed = { text, blocks };
    const used = new Set();
    for (const b of blocks) {
      if (b.kind === "code") this.codeState(b.lang, b.code, used);
      if (b.kind === "image" && (this.config.remote_images || !/^https?:/i.test(b.src))) this.loadMedia(this.imageKey(b.src), () => cacheImage(this.imageKey(b.src)), cx);
      if ((b.kind === "mermaid" && this.config.renderers.mermaid) || (b.kind === "math" && this.config.renderers.math)) {
        const { key, text: src, color } = this.diagramKey(b);
        this.loadMedia(key, () => renderDiagram(b.kind, src, color, this.config), cx);
      }
    }
    for (const [k, st] of this.codeStates) if (!used.has(k)) { st.release(); this.codeStates.delete(k); }
  }

  imageKey(src) {
    if (/^https?:/i.test(src)) return src;
    const p = decodeURI(src.replace(/^file:\/\//, ""));
    return p.startsWith("/") || /^[A-Za-z]:/.test(p) ? p : `${dirOf(this.file)}/${p}`;
  }

  diagramKey(b) {
    const text = b.kind === "math" ? b.tex : b.code;
    const color = b.kind === "math" ? theme().foreground : (settings().dark === false ? "light" : "dark");
    return { key: `${b.kind}\u0000${color}\u0000${text}`, text, color };
  }

  loadMedia(key, make, cx) {
    if (this.media.has(key)) return;
    const entry = { state: "loading" };
    this.media.set(key, entry);
    cx.spawn(async (cx) => {
      try { Object.assign(entry, await make(), { state: "ok" }); }
      catch (e) { entry.state = "error"; entry.why = String(e?.message ?? e); }
      cx.notify();
    });
  }

  codeState(lang, code, used) {
    const k = `${lang}\u0000${code}`;
    used.add(k);
    if (!this.codeStates.has(k)) {
      const t = theme();
      this.codeStates.set(k, EditorState.new({
        language: lang || "text", value: code, readonly: true, line_numbers: false, folding: false, soft_wrap: false,
        font_family: settings().font_family, font_size: Math.max(11, this.config.text_size - 1),
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
      }));
    }
  }

  // ---------- rendering ----------
  inline(id, s, t, size = this.config.text_size, color = t.foreground) {
    return div().text_size(size).text_color(color).min_w(0).child(
      TextView.markdown(id, tidyInline(s)).selectable(true).on_link_click((url, cx) => this.link(url, cx)));
  }

  // One row: a send button in the gutter, shown on hover, and the content.
  row(id, start, end, text, content, t) {
    const on = this.hover === id;
    return h_flex().id(`row-${id}`).w_full().items_start()
      .on_hover((h, cx) => { if (h) this.hover = id; else if (this.hover === id) this.hover = null; cx.notify(); })
      .child(div().id(`send-${id}`).w(22).h(22).flex_none().flex().items_center().cursor_pointer()
        .text_color(t.dim).hover((s) => s.text_color(t.accent))
        .on_click((_e, cx) => this.send(start, end, text, cx))
        .when(on, (e) => e.child(svg("mods/md-view/send.svg").size(14))))
      .child(div().flex_1().min_w(0).child(content));
  }

  mediaBox(entry, label, fallback, t, centered) {
    if (entry?.state === "ok") {
      const maxW = Math.max(120, Math.min(this.width - 70, this.config.max_width || Infinity));
      const w = Math.min(entry.w, maxW), h = Math.round(w * (entry.h / entry.w));
      const img = image(entry.path).w(w).h(h).rounded(4);
      return centered ? h_flex().my(8).w_full().justify_center().child(img) : div().my(6).child(img);
    }
    const failed = entry?.state === "error", off = entry?.state === "off";
    return v_flex().my(6).rounded(6).border(1).border_color(t.border).bg(t.background)
      .child(div().px(10).py(3).bg(t.raised).text_size(11).text_color(failed ? t.blocked : off ? t.muted : t.dim)
        .child(failed || off ? `${label} · ${entry.why}` : `${label} · loading…`))
      .when(!!fallback, (e) => e.child(div().px(10).py(8).text_size(13).font_family(settings().font_family).text_color(t.muted).child(fallback)));
  }

  block(b, i, t) {
    const id = `b${i}-${b.start}`;
    const size = this.config.text_size;
    const lineText = (s, e) => this.text().split("\n").slice(s, e).join("\n");
    switch (b.kind) {
      case "heading": {
        const hs = [0, size + 10, size + 5, size + 2, size + 1, size, size - 1][b.level] ?? size;
        const el = v_flex().pt(b.level <= 2 ? 14 : 8).pb(4).gap(4)
          .child(div().font_semibold().child(this.inline(id, b.inline, t, hs)))
          .when(b.level <= 2, (e) => e.child(div().h(1).w_full().bg(t.border)));
        return this.row(id, b.start, b.end, b.source, el, t);
      }
      case "paragraph":
        return this.row(id, b.start, b.end, b.source, div().py(4).child(this.inline(id, b.inline, t)), t);
      case "list":
        return v_flex().py(2).children(b.items.map((it, k) => {
          const iid = `${id}-i${k}`;
          const mark = it.task === null
            ? div().w(18).flex_none().text_color(t.dim).child(it.marker)
            : div().w(18).flex_none().pt(3).child(div().size(12).rounded(3).border(1).border_color(it.task ? t.accent : t.dim).bg(it.task ? t.accent : t.surface)
                .text_size(10).text_color(t.accent_foreground).flex().items_center().justify_center().child(it.task ? "✓" : ""));
          const el = h_flex().pl(it.depth * 18).py(1).items_start().child(mark)
            .child(div().flex_1().min_w(0).child(this.inline(iid, it.inline, t, size, it.task ? t.muted : t.foreground)));
          return this.row(iid, it.start, it.end, lineText(it.start, it.end), el, t);
        }));
      case "quote":
        return this.row(id, b.start, b.end, b.source,
          div().my(4).pl(12).border_l(3).border_color(t.border).child(this.inline(id, b.inner, t, size, t.muted)), t);
      case "alert": {
        const color = { note: t.accent, tip: t.ansi2, important: t.ansi5, warning: t.blocked, caution: t.ansi1 }[b.type] ?? t.accent;
        return this.row(id, b.start, b.end, b.source,
          v_flex().my(6).px(12).py(8).gap(4).rounded(6).border_l(3).border_color(color).bg(t.raised)
            .child(div().text_size(12).font_semibold().text_color(color).child(b.title))
            .child(this.inline(id, b.inner, t)), t);
      }
      case "code": {
        const lines = b.code.split("\n").length;
        const state = this.codeStates.get(`${b.lang}\u0000${b.code}`);
        const lineH = Math.round(this.config.text_size * 1.45);
        const el = v_flex().my(6).rounded(6).border(1).border_color(t.border).bg(t.background).overflow_hidden()
          .child(h_flex().px(10).py(3).justify_between().bg(t.raised)
            .child(div().text_size(11).text_color(t.dim).child(b.lang || "text"))
            .child(div().id(`copy-${id}`).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => cx.write_to_clipboard(b.code)).child("Copy")))
          .child(state
            ? div().h(Math.min(lines, 60) * lineH + 12).px(6).py(6).child(Editor.new(state))
            : div().px(10).py(8).text_size(13).font_family(settings().font_family).child(b.code));
        return this.row(id, b.start, b.end, b.source, el, t);
      }
      case "table": {
        const cell = (cid, s, a) => h_flex().flex_1().min_w(0).px(10).py(6)
          .when(a === "right", (e) => e.justify_end()).when(a === "center", (e) => e.justify_center())
          .child(this.inline(cid, s, t, size - 1));
        const el = v_flex().my(6).rounded(6).border(1).border_color(t.border).overflow_hidden()
          .child(h_flex().bg(t.raised).font_semibold().children(b.header.map((h, c) => cell(`${id}-h${c}`, h, b.align[c]))))
          .children(b.rows.map((r, ri) => h_flex().border_t(1).border_color(t.border).when(ri % 2 === 1, (e) => e.bg(t.canvas ?? t.surface))
            .children(b.header.map((_h, c) => cell(`${id}-r${ri}c${c}`, r[c] ?? "", b.align[c])))));
        return this.row(id, b.start, b.end, b.source, el, t);
      }
      case "chart":
        return this.row(id, b.start, b.end, b.source, this.chart(id, parseChart(b.code), t), t);
      case "image":
        return this.row(id, b.start, b.end, b.source,
          v_flex().gap(4)
            .child(this.mediaBox(/^https?:/i.test(b.src) && !this.config.remote_images
              ? { state: "off", why: "images from the web are off in Settings" }
              : this.media.get(this.imageKey(b.src)), `image ${b.src}`, null, t, false))
            .when(!!b.alt, (e) => e.child(div().text_size(12).text_color(t.dim).child(b.alt))), t);
      case "mermaid":
      case "math": {
        const on = b.kind === "mermaid" ? this.config.renderers.mermaid : this.config.renderers.math;
        const entry = on ? this.media.get(this.diagramKey(b).key) : { state: "off", why: `${b.kind === "mermaid" ? "Mermaid" : "maths"} rendering is off in Settings` };
        return this.row(id, b.start, b.end, b.source, this.mediaBox(entry, b.kind, b.kind === "math" ? b.tex : b.code, t, true), t);
      }
      case "hr":
        return this.row(id, b.start, b.end, b.source, div().my(10).h(1).w_full().bg(t.border), t);
      case "front":
        return this.row(id, b.start, b.end, b.source,
          div().my(4).px(10).py(6).rounded(6).bg(t.raised).text_size(12).font_family(settings().font_family).text_color(t.dim).child(b.text.trim()), t);
      case "footnotes":
        return v_flex().mt(10).pt(6).border_t(1).border_color(t.border).gap(2).children(b.notes.map((n, k) =>
          h_flex().gap(6).items_start().pl(22)
            .child(div().text_size(12).text_color(t.dim).child(`[${n.label}]`))
            .child(this.inline(`${id}-f${k}`, n.inline, t, size - 2, t.muted))));
      default:
        return div();
    }
  }

  chart(id, c, t) {
    const pts = c.points;
    const title = c.title ? div().text_size(12).font_semibold().text_color(t.muted).child(c.title) : null;
    const box = v_flex().my(6).px(12).py(10).gap(8).rounded(6).border(1).border_color(t.border).bg(t.background);
    if (!pts.length) return box.child(div().text_size(12).text_color(t.dim).child("Empty chart: add lines like `label: 12`."));
    const max = Math.max(...pts.map((p) => p.value), 0) || 1;
    const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
    const palette = [t.accent, t.ansi4, t.ansi2, t.ansi3, t.ansi5, t.ansi6];
    if (c.type === "line") {
      const H = 140;
      const x = (k) => (pts.length === 1 ? 50 : 3 + (k * 94) / (pts.length - 1));
      const y = (v) => 8 + (1 - v / max) * 84;
      // paint_path needs absolute coordinates, so the plot measures itself first.
      const W = this.plotW?.[id] ?? 0;
      // on_size_change reports the width with the app's zoom in it; paint_path wants it without.
      const z = 1 / (settings().zoom ?? 1);
      const px = (k) => (x(k) / 100) * W * z, py = (v) => (y(v) / 100) * H;
      let plot = div().id(`plot-${id}`).relative().w_full().h(H)
        .on_size_change((size, cx) => { (this.plotW ??= {})[id] = size.width; cx.notify(); });
      if (W > 0) {
        let line = PathBuilder.stroke(2);
        pts.forEach((pt, k) => { line = k ? line.line_to(px(k), py(pt.value)) : line.move_to(px(k), py(pt.value)); });
        let area = PathBuilder.fill().move_to(px(0), H);
        pts.forEach((pt, k) => { area = area.line_to(px(k), py(pt.value)); });
        area = area.line_to(px(pts.length - 1), H).close();
        plot = plot.child(div().absolute().left(0).top(0).size_full().child(window.paint_path(area.build(), `${t.accent}22`)))
          .child(div().absolute().left(0).top(0).size_full().child(window.paint_path(line.build(), t.accent)));
      }
      plot = plot.children(pts.map((pt, k) => div().absolute().left(`${x(k)}%`).top(`${y(pt.value)}%`).ml(-3).mt(-3).size(6).rounded(3).bg(t.accent)));
      const labels = h_flex().w_full().justify_between().children(pts.map((pt) =>
        v_flex().items_center().child(div().text_size(11).text_color(t.muted).child(fmt(pt.value))).child(div().text_size(10).text_color(t.dim).child(pt.label))));
      return box.when(!!title, (e) => e.child(title)).child(plot).child(labels);
    }
    const labelW = Math.min(160, Math.max(...pts.map((p) => p.label.length)) * 8 + 8);
    return box.when(!!title, (e) => e.child(title)).children(pts.map((pt, k) =>
      h_flex().gap(8).items_center()
        .child(div().w(labelW).flex_none().text_size(12).text_color(t.muted).truncate().child(pt.label))
        .child(div().flex_1().h(14).child(div().h_full().rounded(3).bg(palette[k % palette.length]).w(`${Math.max(1, (pt.value / max) * 100)}%`)))
        .child(div().w(56).flex_none().text_size(12).text_color(t.foreground).child(fmt(pt.value)))));
  }

  button(id, label, t, onClick, active = false) {
    return div().id(id).px(8).py(3).rounded(5).text_size(12).cursor_pointer()
      .text_color(active ? t.accent_foreground : t.muted).when(active, (s) => s.bg(t.accent))
      .hover((s) => (active ? s : s.bg(t.hover).text_color(t.foreground)))
      .on_click(onClick).child(label);
  }

  render(cx) {
    this.sync(cx);
    const rev = shared("md-view.config-rev") ?? null;
    if (rev !== this.rev) {
      const first = this.rev === undefined;
      this.rev = rev;
      if (!first) cx.spawn(async (cx) => this.reloadConfig(cx));
    }
    const t = theme();
    const file = this.file;
    const dirty = this.dirty();
    const saveLabel = { unsaved: "Unsaved", saving: "Saving…", saved: "Saved", conflict: "Not saved" }[this.saveState];

    // Left: the file and its copy button. Right: the panel's modes, edit actions, then settings.
    const iconButton = (id, icon, tip, onClick, active = false) => div().id(id).size(26).flex_none().flex().items_center().justify_center()
      .rounded(5).cursor_pointer().text_color(active ? t.accent_foreground : t.muted).when(active, (s) => s.bg(t.accent))
      .hover((s) => (active ? s : s.bg(t.hover).text_color(t.foreground))).tooltip(tip)
      .on_click(onClick).child(svg(`mods/md-view/${icon}.svg`).size(15));
    const editing = !this.showSettings && this.mode !== "view";
    this.history ??= []; this.histPos ??= -1; this.changed ??= [];
    const canEdit = this.config.allow_edit !== false;
    const arrow = (id, label, tip, on, step) => div().id(id).px(4).text_size(15).rounded(4)
      .text_color(on ? t.muted : t.border).when(on, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .tooltip(tip).on_click((_e, cx) => goHistory(this, step, cx)).child(label);
    const header = h_flex().w_full().px(10).py(6).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .when(this.history.length > 1, (e) => e.child(h_flex().flex_none()
        .child(arrow("back", "‹", "Back (Alt+Left)", this.histPos > 0, -1))
        .child(arrow("fwd", "›", "Forward (Alt+Right)", this.histPos < this.history.length - 1, 1))))
      .child(v_flex().flex_1().min_w(0)
        .child(h_flex().gap(4).items_center().min_w(0)
          .child(div().text_size(13).font_semibold().text_color(t.foreground).truncate().child(file ? `${nameOf(file)}${dirty ? " ●" : ""}` : "md-view"))
          .when(!!file, (e) => e.child(div().id("copy-path").flex_none().flex().items_center().gap(4).px(4).py(1).rounded(4).cursor_pointer()
            .text_color(this.copied ? t.accent : t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.write_to_clipboard(file); this.copied = true; cx.notify(); cx.timer.after(1500, (cx) => { this.copied = false; cx.notify(); }); })
            .child(svg("mods/md-view/copy.svg").size(13))
            .child(div().text_size(11).child(this.copied ? "Copied" : "Copy path")))))
        .child(div().text_size(11).text_color(t.dim).truncate().child(file ? dirOf(file) : "Ctrl-click a .md path in a terminal")))
      .when(editing && !this.config.autosave && dirty, (e) => e.child(this.button("save", "Save", t, (_e, cx) => this.save(cx), true)))
      .when(editing && !!saveLabel, (e) => e.child(div().text_size(11).text_color(this.saveState === "conflict" ? t.blocked : t.dim).child(saveLabel)))
      .when(editing, (e) => e.child(this.button("send-sel", "Send selection", t, (_e, cx) => this.sendSelection(cx))))
      .when(!editing && this.changed.length > 0, (e) => e.child(div().id("changed").flex_none().px(8).py(3).rounded(10).cursor_pointer()
        .text_size(11).text_color(t.accent_foreground).bg(t.accent).hover((s) => s.opacity(0.85)).tooltip("Jump to the next change (c)")
        .on_click((_e, cx) => nextChanged(this, cx))
        .child(`${this.changed.length} changed ›`)))
      .when(!!file && !editing, (e) => e
        .child(iconButton("tool-outline", "outline", "Outline (o)", (_e, cx) => { this.showOutline = !this.showOutline; cx.notify(); }, !!this.showOutline))
        .child(iconButton("tool-find", "search", "Find (/ or Ctrl+F)", (_e, cx) => (this.showFind ? closeFind(this, cx) : openFind(this, cx)), !!this.showFind)))
      .child(iconButton("tool-files", "terminal-files", "Markdown files the terminal mentioned (f)", (_e, cx) => openPicker(this, cx), !!this.showPicker))
      .when(!!file && canEdit, (el) => el.child(h_flex().gap(2).p(2).rounded(6).bg(t.raised)
        .child(this.button("m-view", "View", t, (_e, cx) => this.setMode("view", cx), !this.showSettings && this.mode === "view"))
        .child(this.button("m-edit", "Edit", t, (_e, cx) => this.setMode("edit", cx), !this.showSettings && this.mode === "edit"))
        .child(this.button("m-split", "Split", t, (_e, cx) => this.setMode("split", cx), !this.showSettings && this.mode === "split"))))
      .child(div().w(1).h(18).bg(t.border))
      .child(iconButton("settings", "gear", "Settings", (_e, cx) => this.toggleSettings(cx), !!this.showSettings));

    const want = this.wanted();
    const pending = dirty && want && want.path !== file;
    const banner = (msg, actions, color = t.blocked) => h_flex().w_full().px(12).py(6).gap(8).items_center().bg(t.raised).border_b(1).border_color(color)
      .child(div().flex_1().text_size(12).text_color(t.foreground).child(msg)).children(actions);

    let preview;
    if (this.error) preview = div().p(16).text_color(t.blocked).child(this.error);
    else if (!file) preview = div().p(16).text_color(t.dim).child("Nothing open. Ctrl-click a .md path in a terminal of this tab.");
    else {
      const matches = new Set(this.showFind ? this.matches ?? [] : []);
      const current = this.showFind ? this.matches?.[this.findPos] : null;
      const changed = new Set(this.changed);
      // Each block is a direct child, so the scroll handle can jump to it.
      const wrap = (el, i) => div().w_full().when(this.config.max_width > 0, (e) => e.max_w(this.config.max_width)).px(4).rounded(4)
        .border_l(2).border_color(changed.has(i) ? t.accent : "#00000000")
        .when(changed.has(i), (e) => e.bg(`${t.accent}10`))
        .when(matches.has(i), (e) => e.bg(t.selection ?? t.hover))
        .when(i === current || i === this.flash, (e) => e.bg(t.selection ?? t.hover).border_color(t.accent))
        .child(el);
      preview = v_flex().id("preview").flex_1().min_h(0).overflow_y_scrollbar().px(14).py(10).items_center().gap(2)
        .when(!!this.scroll, (e) => e.track_scroll(this.scroll))
        .when(!!this.font, (e) => e.font_family(this.font)).text_color(t.foreground)
        .children(this.parsed.blocks.map((b, i) => wrap(this.block(b, i, t), i)))
        .child(div().h(40));
    }

    const editor = this.editor ? div().flex_1().min_h(0).bg(t.background).child(Editor.new(this.editor)) : null;
    if (this.showOutline && !this.error && file) preview = h_flex().flex_1().min_h(0).w_full().child(outline(this, t)).child(preview);
    let body = preview;
    if (this.showSettings) body = settingsPage(this, t, cx).when(!!this.font, (e) => e.font_family(this.font));
    else if (this.mode === "edit" && editor) body = editor;
    else if (this.mode === "split" && editor) body = v_flex().flex_1().min_h(0).child(editor.border_b(1).border_color(t.border)).child(preview);

    return v_flex().id("root").size_full().when(!!this.keys, (e) => e.track_focus(this.keys)).bg(t.surface).text_color(t.foreground)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 4) { this.width = size.width; cx.notify(); } })
      .on_key_down((e, cx) => onKey(this, e, cx))
      .on_mouse_down("left", () => { if (this.mode === "view" && !this.showFind) this.keys?.focus(); })
      .child(header)
      .when(!!this.showFind && !this.showSettings, (e) => e.child(findBar(this, t)))
      .when(!!this.showPicker && !this.showSettings, (e) => e.child(picker(this, t)))
      .when(!!this.configError, (e) => e.child(banner(`${this.configError}. Using the defaults until it is fixed.`, [])))
      .when(this.conflict, (e) => e.child(banner("The file changed on disk while you were editing.", [
        this.button("c-reload", "Reload from disk", t, (_e, cx) => this.reloadFromDisk(cx)),
        this.button("c-over", "Keep mine and save", t, (_e, cx) => this.overwrite(cx), true)])))
      .when(pending && !this.conflict, (e) => e.child(banner(`Unsaved changes. ${nameOf(want.path)} is waiting.`, [
        this.button("p-save", "Save now", t, (_e, cx) => this.save(cx), true),
        this.button("p-drop", "Discard", t, (_e, cx) => { this.draft = this.editor ? this.base : null; if (this.editor) this.editor.set_value(this.base); this.reparse(cx); cx.notify(); })])))
      .child(body);
  }
}
