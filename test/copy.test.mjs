// Ctrl+C on the rendered page: the plain text the view copied maps back to its markdown.
const { markdownFor } = await import(new URL("../mods/md-view/copy.js", import.meta.url));
const src = `# Dark mode plan

A paragraph with **bold**, *italic*, \`code\` and a [link](https://x.y) that
wraps onto a second line.

1. Define colours as CSS custom properties.
2. Add a toggle that saves the choice in \`localStorage\`.
- [x] Done item

> [!NOTE]
> Notes stand out.
`;
const cases = [
 ["Dark mode plan", "# Dark mode plan"],
 ["A paragraph with bold, italic, code and a link that wraps onto a second line.", "A paragraph with **bold**, *italic*, `code` and a [link](https://x.y) that\nwraps onto a second line."],
 ["bold", "**bold**"],
 ["italic, code", "*italic*, `code`"],
 ["link", "[link](https://x.y)"],
 ["Add a toggle that saves the choice in localStorage.", "2. Add a toggle that saves the choice in `localStorage`."],
 ["saves the choice", "saves the choice"],
 ["Done item", "- [x] Done item"],
 ["Notes stand out.", "> Notes stand out."],
 ["not in file", null],
];
let f = 0;
for (const [c, w] of cases) { const g = markdownFor(src, c); if (g !== w) f++; console.log(`${g === w ? "PASS" : "FAIL"}  Copy as markdown: ${JSON.stringify(c)}`); }
process.exit(f?1:0);
