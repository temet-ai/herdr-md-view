// Links inside a markdown file: where each kind goes, heading anchors, reference and wiki links.
const { slugify, headingAnchors, resolveLink, referenceDefs, expandLinks } = await import(new URL("../mods/md-view/links.js", import.meta.url));
let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) fails++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const dir = "/p/docs";

ok(eq(resolveLink("https://x.y/a", dir), { kind: "url", url: "https://x.y/a" }), "Web link goes to the system");
ok(eq(resolveLink("mailto:a@b.c", dir).kind, "url"), "mailto goes to the system");
ok(eq(resolveLink("#setup", dir), { kind: "here", anchor: "setup" }), "#heading stays in this file");
ok(eq(resolveLink("#L42", dir), { kind: "here", line: 42 }), "#L42 is a line here");
ok(eq(resolveLink("plan.md", dir), { kind: "file", path: "/p/docs/plan.md" }), "Relative file");
ok(eq(resolveLink("../README.md#install", dir), { kind: "file", path: "/p/README.md", anchor: "install" }), "Up a folder, at a heading");
ok(eq(resolveLink("./a/b.md#L10-L20", dir), { kind: "file", path: "/p/docs/a/b.md", line: 10 }), "GitHub line range opens at its first line");
ok(eq(resolveLink("notes.md:7", dir), { kind: "file", path: "/p/docs/notes.md", line: 7 }), "path.md:7 opens at line 7");
ok(eq(resolveLink("/abs/x.md", dir), { kind: "file", path: "/abs/x.md" }), "Absolute path");
ok(eq(resolveLink("file:///abs/x.md", dir), { kind: "file", path: "/abs/x.md" }), "file:// link");
ok(eq(resolveLink("my%20notes.md#a%20b", dir), { kind: "file", path: "/p/docs/my notes.md", anchor: "a b" }), "Encoded spaces in path and anchor");
ok(resolveLink("~/n.md", dir).path === "~/n.md", "~/ is left for the home folder");

ok(slugify("Send to the terminal") === "send-to-the-terminal", "Anchor: spaces to hyphens");
ok(slugify("What's new in 0.2.0?") === "whats-new-in-020", "Anchor: punctuation dropped");
ok(slugify("Ünïcode Heading") === "ünïcode-heading", "Anchor: letters outside ASCII kept");
ok(eq(headingAnchors([{ index: 0, text: "Notes" }, { index: 3, text: "Notes" }, { index: 5, text: "Other" }]).map((a) => a.slug), ["notes", "notes-1", "other"]), "Repeated headings get -1, -2 as on GitHub");

const defs = referenceDefs('Text\n\n[spec]: ./spec.md "The spec"\n[Web Site]: <https://x.y>\n[^1]: a footnote\n');
ok(defs.get("spec") === "./spec.md" && defs.get("web site") === "https://x.y" && !defs.has("^1"), "Reference definitions, not footnotes");
ok(expandLinks("see [the spec][spec] now", defs) === "see [the spec](./spec.md) now", "Full reference link");
ok(expandLinks("see [spec][] now", defs) === "see [spec](./spec.md) now", "Collapsed reference link");
ok(expandLinks("see [Web  site] now", defs) === "see [Web  site](https://x.y) now", "Shortcut reference link, case and spaces ignored");
ok(expandLinks("a [plain](u.md) and [unknown] and ![img](i.png)", defs) === "a [plain](u.md) and [unknown] and ![img](i.png)", "Inline links, unknown names and images untouched");
ok(expandLinks("[[Plan]] and [[sub/Plan v2|the plan]] and [[Plan#Next Steps]]", new Map())
  === "[Plan](Plan.md) and [the plan](sub/Plan%20v2.md) and [Plan](Plan.md#next-steps)", "Wiki links, with a label and a heading");
ok(expandLinks("[[data.csv]]", new Map()) === "[data.csv](data.csv)", "Wiki link with an extension keeps it");

process.exit(fails ? 1 : 0);
