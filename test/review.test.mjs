// Notes, reviews, task boxes and front matter: the text each one produces.
const { quote, reviewText, toggleTaskLine, taskCount, frontRows } = await import(new URL("../mods/md-view/review-core.js", import.meta.url));
let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) fails++; };

const f = "/p/plan.md";
ok(quote(f, { start: 4, end: 5, text: "3. Add a toggle" }) === "/p/plan.md:5\n> 3. Add a toggle", "Quote: one line, path and line");
ok(quote(f, { start: 4, end: 6, text: "a\nb" }, "do this first") === "/p/plan.md:5-6\n> a\n> b\ndo this first", "Quote with a note: the note follows the quote");
ok(quote(f, { start: 0, end: 1, text: "x" }, "n", "plain") === "x\nn", "Plain format: the lines and the note only");
ok(reviewText(f, [{ start: 9, end: 10, text: "later", note: "two" }, { start: 2, end: 3, text: "earlier", note: "one" }])
  === "/p/plan.md:3\n> earlier\none\n\n/p/plan.md:10\n> later\ntwo", "Review: notes in file order, a blank line between");

const src = "# Plan\n\n- [ ] one\n- [x] two\n  1. [ ] nested\n> - [ ] quoted\n- plain";
ok(toggleTaskLine(src, 2)?.split("\n")[2] === "- [x] one", "Tick an open box");
ok(toggleTaskLine(src, 3)?.split("\n")[3] === "- [ ] two", "Untick a done box");
ok(toggleTaskLine(src, 4)?.split("\n")[4] === "  1. [x] nested", "Tick a nested numbered box");
ok(toggleTaskLine(src, 5)?.split("\n")[5] === "> - [x] quoted", "Tick a box inside a quote");
ok(toggleTaskLine(src, 6) === null && toggleTaskLine(src, 0) === null, "Lines without a box are left alone");
ok(toggleTaskLine(src, 2).split("\n").length === src.split("\n").length, "Nothing else in the file changes");

const c = taskCount([{ items: [{ task: true }, { task: false }, { task: null }] }, { kind: "paragraph" }, { items: [{ task: true }] }]);
ok(c.done === 2 && c.all === 3, "Task count: 2 of 3, plain items not counted");

const rows = frontRows('title: "Dark mode"\ndate: 2026-11-24\ntags:\n  - ui\n  - theme\nauthors: [a, "b"]\n# a comment\n');
ok(JSON.stringify(rows) === JSON.stringify([["title", "Dark mode"], ["date", "2026-11-24"], ["tags", "ui, theme"], ["authors", "a, b"]]), "Front matter: keys, quotes, lists and inline lists");
ok(JSON.stringify(frontRows("just text")) === JSON.stringify([["", "just text"]]), "Front matter that isn't key: value is still shown");

process.exit(fails ? 1 : 0);
