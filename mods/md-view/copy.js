// Copying markdown. Herdr's text view copies a selection as plain text, so a Ctrl+C on the
// rendered page is followed by markdownFor(): it finds that plain text in the file and gives
// back the markdown it was rendered from. No imports, so the tests can load it in Node.

// The text as the page shows it, with the source offset of every character: line markers
// (headings, list bullets and numbers, task boxes, quote marks) and inline markers (emphasis,
// strikethrough, code ticks, link targets) are dropped, and runs of whitespace become one space.
export function plainMap(src) {
  const plain = [], idx = [];
  const put = (ch, at) => {
    if (/\s/.test(ch)) { if (plain.length && plain[plain.length - 1] !== " ") { plain.push(" "); idx.push(at); } return; }
    plain.push(ch); idx.push(at);
  };
  let i = 0;
  while (i < src.length) {
    const lineEnd = src.indexOf("\n", i) === -1 ? src.length : src.indexOf("\n", i);
    const lead = /^[ \t]*(?:(?:>[ \t]?)+)?(?:#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/.exec(src.slice(i, lineEnd));
    let j = i + (lead ? lead[0].length : 0);
    while (j < lineEnd) {
      const c = src[j], rest = src.slice(j, lineEnd);
      const link = /^!?\[([^\]]*)\]\([^)]*\)/.exec(rest);
      if (link) {
        const textAt = j + rest.indexOf("[") + 1;
        for (let k = 0; k < link[1].length; k++) put(link[1][k], textAt + k);
        j += link[0].length; continue;
      }
      if (c === "*" || c === "~" || c === "`") { j++; continue; }
      if (c === "_" && !(/\w/.test(src[j - 1] ?? "") && /\w/.test(src[j + 1] ?? ""))) { j++; continue; }
      if (c === "\\" && j + 1 < lineEnd) { put(src[j + 1], j + 1); j += 2; continue; }
      put(c, j); j++;
    }
    put(" ", lineEnd);
    i = lineEnd + 1;
  }
  while (plain.length && plain[plain.length - 1] === " ") { plain.pop(); idx.pop(); }
  return { plain: plain.join(""), idx };
}

const squash = (s) => s.replace(/\s+/g, " ").trim();
const MARK = /[*_~`]/;

// The markdown behind `copied`, or null when it isn't text from this file. A selection that
// covers whole lines comes back as those lines, bullets and all; part of a line comes back
// with the emphasis, code ticks and link around it closed.
export function markdownFor(src, copied, near = 0) {
  const want = squash(copied ?? "");
  if (!want) return null;
  const { plain, idx } = plainMap(src);
  let at = -1;
  for (let k = plain.indexOf(want); k !== -1; k = plain.indexOf(want, k + 1)) {
    if (at === -1 || Math.abs(idx[k] - near) < Math.abs(idx[at] - near)) at = k;
  }
  if (at === -1) return null;
  let a = idx[at], b = idx[at + want.length - 1] + 1;
  // Whole lines: the selection starts at a line's first shown character and ends at its last.
  const lineStart = src.lastIndexOf("\n", a - 1) + 1;
  const lineEndAt = (p) => (src.indexOf("\n", p) === -1 ? src.length : src.indexOf("\n", p));
  const firstShown = (s) => { const m = plainMap(src.slice(s, lineEndAt(s))); return m.idx.length ? s + m.idx[0] : s; };
  const lastShown = (e) => { const s = src.lastIndexOf("\n", e - 1) + 1; const m = plainMap(src.slice(s, e)); return m.idx.length ? s + m.idx[m.idx.length - 1] + 1 : e; };
  const endLine = lineEndAt(b - 1 < a ? a : b - 1);
  if (a <= firstShown(lineStart) && b >= lastShown(endLine)) return src.slice(lineStart, endLine);
  // Part of a line: take in the markers that open and close around it.
  while (a > lineStart && MARK.test(src[a - 1])) a--;
  if (src[a - 1] === "[") a--;
  const close = /^\]\([^)]*\)/.exec(src.slice(b));
  if (close) b += close[0].length;
  while (b < endLine && MARK.test(src[b])) b++;
  return src.slice(a, b);
}
