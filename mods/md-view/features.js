// Reading aids on top of the rendered page: jump to a line or block, outline, find,
// back and forward, sections an agent changed, files the terminal mentioned, keys.
// Each function takes the MdView instance; state lives on it.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { exec, hc, home, panes, readTextFile } from "herdr";
import { here, remember } from "./history.js";

export { here, remember };

const nameOf = (p) => p.slice(p.lastIndexOf("/") + 1);

// ---------- scrolling ----------
// ScrollHandle only scrolls as far as needed, which would leave a target at the bottom
// edge. Go to the end first, then back to the target, so it lands at the top.
export function scrollTo(view, index, cx, flash = true) {
  const n = view.parsed.blocks.length;
  if (!view.scroll || index < 0 || index >= n) return;
  view.cursor = index;
  view.scroll.scroll_to_item(n);
  cx.timer.after(16, (cx) => { view.scroll.scroll_to_item(index); cx.notify(); });
  if (flash) {
    view.flash = index;
    cx.timer.after(1400, (cx) => { if (view.flash === index) { view.flash = null; cx.notify(); } });
  }
  cx.notify();
}

export function blockAtLine(view, line) {
  const i = view.parsed.blocks.findIndex((b) => line - 1 >= b.start && line - 1 < b.end);
  if (i >= 0) return i;
  // Between blocks: the next one after the line.
  const next = view.parsed.blocks.findIndex((b) => b.start >= line - 1);
  return next >= 0 ? next : view.parsed.blocks.length - 1;
}

// ---------- history ----------
// Each entry is a place: a file and the block you were at. Following a link records where
// you left (the block holding the link) and where you landed, so Back returns to that spot,
// in the same file or another.

export function goHistory(view, step, cx) {
  const pos = view.histPos + step;
  if (pos < 0 || pos >= view.history.length || view.dirty()) return;
  const cur = view.history[view.histPos];
  if (cur && cur.path === view.file) cur.block = here(view);
  view.histPos = pos;
  const to = view.history[pos];
  if (to.path === view.file) { scrollTo(view, to.block, cx, false); return; }
  view.pendingBlock = to.block;
  view.open({ path: to.path, at: view.at, fromHistory: true }, cx);
}

// ---------- sections an agent changed ----------
// Called after the file changed on disk: blocks whose source is new are marked.
export function markChanged(view, oldBlocks) {
  const before = new Set(oldBlocks.map((b) => b.source));
  const changed = [];
  view.parsed.blocks.forEach((b, i) => { if (!before.has(b.source) && b.source.trim()) changed.push(i); });
  view.changed = changed;
  view.changedPos = -1;
}

export function nextChanged(view, cx) {
  if (!view.changed.length) return;
  view.changedPos = (view.changedPos + 1) % view.changed.length;
  scrollTo(view, view.changed[view.changedPos], cx);
}

// ---------- find ----------
export function openFind(view, cx) {
  view.matches ??= []; view.findPos ??= -1; view.query ??= "";
  if (!view.findInput) {
    view.findInput = InputState.new({ placeholder: "Find in this file" });
    view.findInput.on("change", (_e, cx) => { view.query = view.findInput.value(); view.findPos = -1; updateMatches(view); if (view.matches.length) stepFind(view, 1, cx); cx.notify(); });
    view.findInput.on("submit", (_e, cx) => stepFind(view, 1, cx));
  }
  view.showFind = true;
  view.findInput.focus();
  cx.notify();
}

export function closeFind(view, cx) {
  view.showFind = false;
  view.query = "";
  view.matches = [];
  view.findInput?.set_value("");
  view.keys?.focus();
  cx.notify();
}

export function updateMatches(view) {
  const q = (view.query ?? "").trim().toLowerCase();
  view.matches = q ? view.parsed.blocks.map((b, i) => (b.source.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0) : [];
}

export function stepFind(view, step, cx) {
  if (!view.matches.length) return;
  view.findPos = (view.findPos + step + view.matches.length) % view.matches.length;
  scrollTo(view, view.matches[view.findPos], cx, false);
}

export function findBar(view, t) {
  const n = view.matches?.length ?? 0;
  const label = view.query ? (n ? `${view.findPos + 1} of ${n}` : "No matches") : "";
  const small = (id, text, onClick) => div().id(id).px(8).py(2).rounded(4).text_size(12).cursor_pointer().text_color(t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick).child(text);
  return h_flex().w_full().px(12).py(6).gap(8).items_center().bg(t.raised).border_b(1).border_color(t.border)
    .child(div().flex_1().child(Input.new(view.findInput)))
    .child(div().w(80).text_size(12).text_color(n || !view.query ? t.dim : t.blocked).child(label))
    .child(small("find-prev", "↑", (_e, cx) => stepFind(view, -1, cx)))
    .child(small("find-next", "↓", (_e, cx) => stepFind(view, 1, cx)))
    .child(small("find-close", "Esc", (_e, cx) => closeFind(view, cx)));
}

// ---------- outline ----------
export function outline(view, t) {
  const heads = view.parsed.blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === "heading");
  const current = view.cursor ?? 0;
  let active = -1;
  for (const h of heads) if (h.i <= current) active = h.i;
  return v_flex().id("outline").w(220).flex_none().h_full().overflow_y_scrollbar().py(10).px(8).gap(1)
    .bg(t.chrome).border_r(1).border_color(t.border)
    .child(div().px(8).pb(6).text_size(11).font_semibold().text_color(t.dim).child("OUTLINE"))
    .when(!heads.length, (e) => e.child(div().px(8).text_size(12).text_color(t.dim).child("No headings.")))
    .children(heads.map(({ b, i }) => div().id(`ol-${i}`).pl(8 + (b.level - 1) * 12).pr(6).py(3).rounded(4).cursor_pointer()
      .text_size(b.level <= 2 ? 13 : 12).truncate()
      .text_color(i === active ? t.foreground : t.muted).when(i === active, (s) => s.bg(t.selected ?? t.hover))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { remember(view, view.file, i); scrollTo(view, i, cx); })
      .child(b.inline.replace(/[*_`]/g, ""))));
}

// ---------- files the terminal mentioned ----------
// Herdr doesn't link bare names like `plan.md`; this reads the terminal's recent text
// and finds every markdown name in it, newest first, resolved against its folder.
const MD_NAME = /(?:~\/|\.{1,2}\/|\/)?[\w@%+=,.\/-]*[\w-]\.(?:md|markdown|mdx)(?![\w])/g;

export function openPicker(view, cx) {
  view.showPicker = !view.showPicker;
  if (!view.showPicker) { cx.notify(); return; }
  view.pickerItems = null;
  cx.notify();
  cx.spawn(async (cx) => {
    view.pickerItems = await terminalFiles(view);
    cx.notify();
  });
}

async function exists(p) {
  try { return (await exec("test", ["-f", p])).code === 0; } catch { return (await readTextFile(p)) !== null; }
}

async function terminalFiles(view) {
  const to = view.target();
  if (!to?.terminal) return [];
  const address = to.machine ? `${to.machine}/${to.terminal}` : to.terminal;
  const r = await hc(["read", address, "--lines", "400"]);
  if (r.code !== 0) return [];
  const cwd = panes().find((p) => p.pane === to.pane)?.cwd ?? (view.file ? view.file.slice(0, view.file.lastIndexOf("/")) : home());
  const names = [...r.stdout.matchAll(MD_NAME)].map((m) => m[0].replace(/[.,]+$/, "")).reverse();
  const seen = new Set(), out = [];
  for (const name of names) {
    if (seen.has(name) || out.length >= 20) continue;
    seen.add(name);
    let path = name.startsWith("~/") ? `${home()}/${name.slice(2)}` : name.startsWith("/") ? name : `${cwd}/${name.replace(/^\.\//, "")}`;
    if (!(await exists(path))) {
      if (name.includes("/") || name.startsWith(".")) continue;
      // A bare name: look for it under the terminal's folder.
      try {
        const f = await exec("find", [cwd, "-maxdepth", "6", "-name", name, "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*", "-print", "-quit"], { timeout: 4000 });
        path = f.stdout.trim().split("\n")[0];
      } catch { path = ""; }
      if (!path) continue;
    }
    if (!out.some((o) => o.path === path)) out.push({ name, path });
  }
  return out;
}

export function picker(view, t) {
  const items = view.pickerItems;
  const body = items === null
    ? [div().px(12).py(8).text_size(12).text_color(t.dim).child("Reading the terminal…")]
    : !items.length
      ? [div().px(12).py(8).text_size(12).text_color(t.dim).child("No markdown files mentioned in the terminal's recent output.")]
      : items.map((it, k) => h_flex().id(`pick-${k}`).px(12).py(6).gap(10).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { view.showPicker = false; view.open({ path: it.path, at: view.at, ...(view.source ?? {}) }, cx); })
          .child(svg("mods/md-view/file.svg").size(14).flex_none().text_color(t.accent))
          .child(v_flex().min_w(0)
            .child(div().text_size(13).text_color(t.foreground).truncate().child(nameOf(it.path)))
            .child(div().text_size(11).text_color(t.dim).truncate().child(it.path))));
  return v_flex().w_full().max_h(320).overflow_y_scrollbar().id("picker").bg(t.raised).border_b(1).border_color(t.border)
    .child(div().px(12).pt(8).pb(4).text_size(11).font_semibold().text_color(t.dim).child("MENTIONED IN THE TERMINAL"))
    .children(body);
}

// ---------- keys (view mode) ----------
export function onKey(view, e, cx) {
  const k = e.keystroke;
  if (k === "ctrl-s" || k === "cmd-s") { view.save(cx); return; }
  if (e.key === "escape") {
    if (view.noteFor) { view.noteFor = null; view.keys?.focus(); cx.notify(); }
    else if (view.showFind) closeFind(view, cx);
    else if (view.showPicker) { view.showPicker = false; cx.notify(); }
    else if (view.showSettings) { view.showSettings = false; cx.notify(); }
    else if (view.showOutline) { view.showOutline = false; cx.notify(); }
    return;
  }
  if (k === "ctrl-f" || k === "cmd-f") { openFind(view, cx); return; }
  if ((k === "ctrl-c" || k === "cmd-c") && view.mode === "view" && !view.showSettings && !view.showFind && !view.noteFor) { view.copySelectionAsMarkdown(cx); return; }
  // Back and forward: Alt+arrows everywhere, Cmd+[ and Cmd+] as in macOS browsers,
  // and the keyboard's own Back and Forward keys.
  if (k === "alt-left" || k === "cmd-[" || k === "browserback" || k === "back") { goHistory(view, -1, cx); return; }
  if (k === "alt-right" || k === "cmd-]" || k === "browserforward" || k === "forward") { goHistory(view, 1, cx); return; }
  // Single letters only while reading, not while typing in the editor or the find box.
  if (view.mode !== "view" || view.showSettings || view.showFind || view.noteFor) return;
  const n = view.parsed.blocks.length, at = view.cursor ?? 0;
  const keys = {
    "/": () => openFind(view, cx),
    j: () => scrollTo(view, Math.min(n - 1, at + 1), cx, false),
    down: () => scrollTo(view, Math.min(n - 1, at + 1), cx, false),
    k: () => scrollTo(view, Math.max(0, at - 1), cx, false),
    up: () => scrollTo(view, Math.max(0, at - 1), cx, false),
    g: () => scrollTo(view, 0, cx, false),
    "shift-g": () => scrollTo(view, n - 1, cx, false),
    o: () => { view.showOutline = !view.showOutline; cx.notify(); },
    c: () => nextChanged(view, cx),
    f: () => openPicker(view, cx),
    y: () => view.copyMarkdown(view.text() ?? "", "Copied the file", cx),
    e: () => { if (view.config.allow_edit !== false) view.setMode("edit", cx); },
    "[": () => goHistory(view, -1, cx),
    backspace: () => goHistory(view, -1, cx),
    "shift-backspace": () => goHistory(view, 1, cx),
    "]": () => goHistory(view, 1, cx),
  };
  keys[k]?.();
}
