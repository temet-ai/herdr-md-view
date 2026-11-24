// The Settings page inside the panel. Every control saves at once to
// ~/.config/herdr-app/md-view.json and every open panel picks the change up.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

const FILE_TYPES = [["md", ".md"], ["markdown", ".markdown"], ["mdx", ".mdx"], ["txt", ".txt"]];
const WIDTHS = [[680, "Narrow"], [860, "Medium"], [1100, "Wide"], [0, "Full"]];
const DELAYS = [[300, "Fast"], [800, "Normal"], [2000, "Slow"]];
const SIGN_OFFS = [
  "Made at temet.ai, one side quest at a time.",
  "Made at temet.ai. No markdown was harmed.",
  "Made at temet.ai, mostly in this very panel.",
  "Made at temet.ai by someone who reads too many plans.",
  "Made at temet.ai. Ctrl-click responsibly.",
];
let signOff = null;

// A small card at the bottom: who made this, and where to say hello.
function footer(t) {
  signOff ??= SIGN_OFFS[Math.floor(Math.random() * SIGN_OFFS.length)];
  return h_flex().w_full().mt(32).px(14).py(12).gap(12).items_center().rounded(8)
    .border(1).border_color(t.border).bg(t.raised)
    .child(svg("mods/md-view/sparkle.svg").size(18).flex_none().text_color(t.accent).spin(9000))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().text_size(13).text_color(t.foreground).child(signOff))
      .child(div().text_size(12).text_color(t.dim).child("If md-view helps, a hello or a star keeps it going.")))
    .child(div().id("temet-link").flex_none().px(10).py(4).rounded(5).text_size(12).cursor_pointer()
      .text_color(t.accent).border(1).border_color(t.accent)
      .hover((s) => s.bg(t.accent).text_color(t.accent_foreground))
      .on_click((_e, cx) => cx.open_url("https://temet.ai")).child("temet.ai ↗"));
}

export function settingsPage(view, t, _cx) {
  const c = view.config;
  const set = (key, value) => (_e, cx) => view.setSetting(key, value, cx);

  const segmented = (id, options, current, key) => h_flex().gap(2).p(2).rounded(6).bg(t.raised).flex_wrap().children(
    options.map(([value, label]) => {
      const on = value === current;
      return div().id(`${id}-${value}`).px(10).py(4).rounded(5).text_size(12).cursor_pointer()
        .text_color(on ? t.accent_foreground : t.muted).when(on, (s) => s.bg(t.accent))
        .hover((s) => (on ? s : s.bg(t.hover).text_color(t.foreground)))
        .on_click(set(key, value)).child(label);
    }));

  const toggle = (id, on, key) => div().id(id).w(34).h(20).flex_none().rounded(10).p(2).cursor_pointer()
    .bg(on ? t.accent : t.input ?? t.border).flex().when(on, (e) => e.justify_end())
    .on_click(set(key, !on))
    .child(div().size(16).rounded(8).bg(on ? t.accent_foreground : t.surface));

  const stepper = (id, value, key, step, min, max, unit = "") => h_flex().gap(2).items_center().p(2).rounded(6).bg(t.raised)
    .child(div().id(`${id}-dn`).px(10).py(3).rounded(5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(set(key, Math.max(min, value - step))).child("−"))
    .child(div().w(52).flex().justify_center().text_size(12).text_color(t.foreground).child(`${value}${unit}`))
    .child(div().id(`${id}-up`).px(10).py(3).rounded(5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(set(key, Math.min(max, value + step))).child("+"));

  const chips = (id, options, chosen, key) => h_flex().gap(6).flex_wrap().children(options.map(([value, label]) => {
    const on = chosen.includes(value);
    const next = on ? chosen.filter((v) => v !== value) : [...chosen, value];
    return div().id(`${id}-${value}`).px(10).py(4).rounded(12).border(1).text_size(12).cursor_pointer()
      .border_color(on ? t.accent : t.border).text_color(on ? t.foreground : t.muted).when(on, (s) => s.bg(t.selected ?? t.raised))
      .hover((s) => s.border_color(t.accent))
      .on_click(set(key, next.length ? next : chosen)).child(label);
  }));

  // One setting: name and explanation on the left, its control on the right.
  const row = (label, hint, control, enabled = true) => h_flex().w_full().gap(16).py(10).items_center().border_b(1).border_color(t.border)
    .when(!enabled, (e) => e.opacity(0.45))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().text_size(13).font_medium().text_color(t.foreground).child(label))
      .when(!!hint, (e) => e.child(div().text_size(12).text_color(t.dim).child(hint))))
    .child(div().flex_none().child(control));

  const section = (title, rows) => v_flex().w_full().pt(28)
    .child(div().pb(6).text_size(15).font_semibold().text_color(t.foreground).border_b(1).border_color(t.input ?? t.border).child(title))
    .children(rows);

  const split = c.placement === "right" || c.placement === "down";
  const fontChoice = ["auto", "ui", "mono"].includes(c.font) ? c.font : "custom";

  // A bar that stays put while the page scrolls, with the way back.
  const back = view.file ? `← Back to ${view.file.slice(view.file.lastIndexOf("/") + 1)}` : "← Back";
  const bar = h_flex().w_full().px(20).py(8).gap(12).items_center().bg(t.surface).border_b(1).border_color(t.border)
    .child(div().id("settings-back").px(10).py(4).rounded(5).text_size(12).cursor_pointer().bg(t.accent).text_color(t.accent_foreground)
      .on_click((_e, cx) => view.toggleSettings(cx)).child(back))
    .child(div().flex_1().text_size(12).text_color(t.muted).child("Changes save at once and apply to every md-view panel. Esc goes back."));

  const page = v_flex().w_full().max_w(720).pb(40)
    .child(div().pt(10).text_size(18).font_semibold().text_color(t.foreground).child("md-view settings"))

    .child(section("Opening", [
      row("Open a clicked file", "Beside or below the terminal you clicked in, or in a tab of its own.",
        segmented("placement", [["right", "Beside"], ["down", "Below"], ["tab", "New tab"], ["background", "Background tab"]], c.placement, "placement")),
      row("Reuse the panel", "Later clicks in the same tab show the new file in the panel that is already open. Off: one panel per file.",
        toggle("reuse", c.reuse_panel, "reuse_panel"), split),
      row("Move the keyboard to the panel", "Off: the terminal keeps the keyboard, so you can carry on typing.",
        toggle("focus", c.focus_panel, "focus_panel"), split),
      row("Start in", "The mode a new panel opens in.",
        segmented("mode", [["view", "View"], ["edit", "Edit"], ["split", "Split"]], c.mode, "mode")),
      row("File types", "What a Ctrl-click opens. Changing this reloads md-view panels.",
        chips("types", FILE_TYPES, c.file_types ?? ["md", "markdown"], "file_types")),
    ]))

    .child(section("Reading", [
      row("Font", fontChoice === "custom" ? `Custom: ${c.font} (set in the settings file).` : "Auto picks an installed font with real bold and italic.",
        segmented("font", [["auto", "Auto"], ["ui", "Herdr UI"], ["mono", "Monospace"]], fontChoice === "custom" ? null : c.font, "font")),
      row("Text size", null, stepper("size", c.text_size, "text_size", 1, 10, 24, " px")),
      row("Text width", "How wide the text column gets in a wide panel.",
        segmented("width", WIDTHS, c.max_width, "max_width")),
      row("Images from the web", "Load images with http(s) addresses.", toggle("remote", c.remote_images, "remote_images")),
    ]))

    .child(section("Editing", [
      row("Allow editing", "Off: md-view only reads, with no Edit or Split.", toggle("allowedit", c.allow_edit !== false, "allow_edit")),
      row("Auto-save", "Save while you edit. Off: a Save button and Ctrl+S.", toggle("autosave", c.autosave, "autosave"), c.allow_edit !== false),
      row("Save after", "How long after your last keystroke.",
        segmented("delay", DELAYS, c.autosave_delay_ms, "autosave_delay_ms"), c.autosave && c.allow_edit !== false),
    ]))

    .child(section("Sending to the terminal", [
      row("Send as", "Paste types it without Enter so you can add to it. Submit sends it and presses Enter.",
        segmented("send-mode", [["paste", "Paste"], ["submit", "Submit"]], c.send.mode, "send.mode")),
      row("Format", "Quote: the path and line numbers, then the lines with >. Plain: the lines only.",
        segmented("send-format", [["quote", "Quote"], ["plain", "Plain"]], c.send.format, "send.format")),
      row("Put my clipboard back", "Pasting goes through the clipboard; this restores what you had copied.",
        toggle("clip", c.send.keep_clipboard, "send.keep_clipboard"), c.send.mode === "paste"),
      row("Go to the terminal after submitting", null,
        toggle("sendfocus", c.send.focus_terminal, "send.focus_terminal"), c.send.mode === "submit"),
    ]))

    .child(section("Diagrams", [
      row("Mermaid", "Render ```mermaid blocks. Needs the renderers from install.sh.", toggle("mermaid", c.renderers.mermaid, "renderers.mermaid")),
      row("Maths", "Render $$ … $$ and ```math blocks.", toggle("math", c.renderers.math, "renderers.math")),
    ]))

    .child(h_flex().w_full().pt(18).gap(8)
      .child(div().id("settings-file").px(10).py(4).rounded(5).text_size(12).cursor_pointer().text_color(t.muted).bg(t.raised)
        .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => view.editSettingsFile(cx)).child("Edit the settings file"))
      .child(div().id("settings-reset").px(10).py(4).rounded(5).text_size(12).cursor_pointer().text_color(t.muted).bg(t.raised)
        .hover((s) => s.text_color(t.blocked)).on_click((_e, cx) => view.resetSettings(cx)).child("Reset to defaults")))
    .child(footer(t));

  return v_flex().flex_1().min_h(0).w_full()
    .child(bar)
    .child(v_flex().id("settings").flex_1().min_h(0).overflow_y_scrollbar().px(20).py(4).items_center().child(page));
}
