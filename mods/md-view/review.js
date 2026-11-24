// Steering an agent from the page: a note sent with a quote, notes collected into one
// review, and task boxes ticked in the file. The text side lives in ./review-core.js.
import { div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { notify } from "herdr";
import { quote, reviewText, toggleTaskLine } from "./review-core.js";

// ---------- a note on one block ----------
// The note box opens under the block whose note icon was clicked. Enter sends the quote
// and the note now; "Add to review" keeps them for one message later.
export function openNote(view, item, cx) {
  view.noteFor = item;
  if (!view.noteInput) {
    view.noteInput = InputState.new({ placeholder: "Your note for the agent (Enter sends)" });
    view.noteInput.on("submit", (_e, cx) => sendNote(view, cx));
  }
  view.noteInput.set_value("");
  view.noteInput.focus();
  cx.notify();
}

export function closeNote(view, cx) {
  view.noteFor = null;
  view.keys?.focus();
  cx.notify();
}

function noteValue(view) { return (view.noteInput?.value() ?? "").trim(); }

export function sendNote(view, cx) {
  const it = view.noteFor;
  if (!it) return;
  view.sendBody(quote(view.file, it, noteValue(view), view.config.send.format), cx);
  closeNote(view, cx);
}

export function addToReview(view, cx) {
  const it = view.noteFor;
  if (!it) return;
  view.review ??= [];
  view.review.push({ ...it, note: noteValue(view) });
  closeNote(view, cx);
}

export function sendReview(view, cx) {
  if (!view.review?.length) return;
  view.sendBody(reviewText(view.file, view.review, view.config.send.format), cx);
  view.review = [];
  cx.notify();
}

export function noteBox(view, t) {
  const small = (id, text, onClick, strong = false) => div().id(id).px(8).py(2).rounded(4).text_size(12).cursor_pointer()
    .text_color(strong ? t.accent_foreground : t.muted).when(strong, (s) => s.bg(t.accent))
    .hover((s) => (strong ? s.opacity(0.85) : s.bg(t.hover).text_color(t.foreground))).on_click(onClick).child(text);
  return h_flex().w_full().pl(22).pr(4).py(4).gap(6).items_center()
    .child(div().flex_1().min_w(0).child(Input.new(view.noteInput)))
    .child(small("note-send", "Send", (_e, cx) => sendNote(view, cx), true))
    .child(small("note-add", "Add to review", (_e, cx) => addToReview(view, cx)))
    .child(small("note-close", "Esc", (_e, cx) => closeNote(view, cx)));
}

// The bar under the header while notes are waiting.
export function reviewBar(view, t) {
  const n = view.review?.length ?? 0;
  const small = (id, text, onClick, strong = false) => div().id(id).px(8).py(2).rounded(4).text_size(12).cursor_pointer()
    .text_color(strong ? t.accent_foreground : t.muted).when(strong, (s) => s.bg(t.accent))
    .hover((s) => (strong ? s.opacity(0.85) : s.bg(t.hover).text_color(t.foreground))).on_click(onClick).child(text);
  return h_flex().w_full().px(12).py(6).gap(8).items_center().bg(t.raised).border_b(1).border_color(t.border)
    .child(div().flex_1().text_size(12).text_color(t.foreground)
      .child(`Review: ${n} note${n === 1 ? "" : "s"} on ${new Set(view.review.map((r) => r.start)).size} place${n === 1 ? "" : "s"}`))
    .child(small("review-send", "Send review", (_e, cx) => sendReview(view, cx), true))
    .child(small("review-clear", "Clear", (_e, cx) => { view.review = []; cx.notify(); }));
}

// ---------- task boxes ----------
// Ticks or unticks the box on `line` (0-based) and saves it the way an edit would: through
// the open editor when there is one, else straight to the file, refusing if it changed.
export function toggleTask(view, line, cx) {
  if (view.config.allow_edit === false || !view.file) return;
  const src = view.text() ?? "";
  const next = toggleTaskLine(src, line);
  if (next === null) return;
  if (view.editor) { view.editor.set_value(next); return; }
  const file = view.file, expected = view.base;
  view.base = next; view.reparse(cx); cx.notify();
  cx.spawn(async (cx) => {
    try { await view.writeFile(file, next, expected); }
    catch {
      view.base = expected; view.reparse(cx); cx.notify();
      notify({ title: "md-view", body: "The file changed on disk; the box was not ticked.", level: "warning" });
    }
  });
}
