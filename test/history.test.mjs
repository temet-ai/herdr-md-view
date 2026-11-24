// Back and forward return to the place you left, in the same file or another.
const { here, remember } = await import(new URL("../mods/md-view/history.js", import.meta.url));
let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) fails++; };
const v = { file: null, hover: null, cursor: 0 };
remember(v, "/a.md", 0); v.file = "/a.md";
v.hover = "b7-30";                       // the mouse is on the block holding the link
remember(v, "/a.md", 12);                 // a #heading link in the same file
ok(v.history[0].block === 7 && v.history[1].block === 12 && v.histPos === 1, "A heading link records the block you left and the one you landed on");
v.hover = "b14-50-i2";
remember(v, "/b.md", 0); v.file = "/b.md";
ok(v.history[1].block === 14 && v.history[2].path === "/b.md", "Opening another file records where you were in the first");
v.histPos = 0; v.file = "/a.md"; v.hover = null; v.cursor = 3;
remember(v, "/c.md", 0);
ok(v.history.length === 2 && v.history[1].path === "/c.md" && v.history[0].block === 3, "A new jump after going back drops the forward entries");
v.hover = null; v.cursor = 9;
ok(here(v) === 9, "Without the mouse on a block, the last block moved to counts");
remember(v, "/c.md", 0); const n = v.history.length; remember(v, "/c.md", 0);
ok(v.history.length === n, "The same place twice is one entry");
process.exit(fails ? 1 : 0);
