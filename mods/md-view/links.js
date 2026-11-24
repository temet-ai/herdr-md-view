// Links inside a markdown file: where a link goes (another file, a heading, a line), the
// heading anchors GitHub would give, and reference and wiki links turned into plain
// [text](target) links before the text view draws them. No imports, so the tests load it.

// GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens.
export function slugify(text) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}

// Every heading's anchor, numbered like GitHub's when two are the same (`a`, `a-1`).
export function headingAnchors(headings) {
  const seen = new Map(), out = [];
  for (const h of headings) {
    const base = slugify(h.text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ index: h.index, slug: n ? `${base}-${n}` : base });
  }
  return out;
}

const dirOf = (p) => p.slice(0, p.lastIndexOf("/")) || "/";

// Where `url` goes from a file in `dir`:
//   { kind: "url", url }                      a web or other link for the system
//   { kind: "here", anchor?, line? }          a place in this file
//   { kind: "file", path, anchor?, line? }    another file, and a place in it
export function resolveLink(url, dir) {
  // `notes.md:7` looks like a URL scheme to the pattern below; a path with a line is a file.
  const fileWithLine = /^[^/:]+\.[A-Za-z0-9]+:\d+(?::\d+)?$/.test(url);
  if (!fileWithLine && /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url)) return { kind: "url", url };
  let rest = url.replace(/^file:\/\//i, "");
  let hash = "";
  const h = rest.indexOf("#");
  if (h !== -1) { hash = rest.slice(h + 1); rest = rest.slice(0, h); }
  let line = null;
  const lm = /^L(\d+)(?:-L?\d+)?$/.exec(hash);
  if (lm) { line = Number(lm[1]); hash = ""; }
  const colon = /:(\d+)(?::\d+)?$/.exec(rest);
  if (colon) { line = Number(colon[1]); rest = rest.slice(0, colon.index); }
  let anchor = null;
  if (hash) { try { anchor = decodeURIComponent(hash); } catch { anchor = hash; } }
  const place = { ...(anchor ? { anchor } : {}), ...(line ? { line } : {}) };
  if (!rest) return { kind: "here", ...place };
  let path;
  try { path = decodeURI(rest); } catch { path = rest; }
  if (path.startsWith("~/")) { /* the caller puts the home folder in */ }
  else if (!path.startsWith("/") && !/^[A-Za-z]:/.test(path)) path = normalize(`${dir}/${path}`);
  return { kind: "file", path, ...place };
}

function normalize(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (part === "..") { if (out.length > 1) out.pop(); }
    else if (part !== ".") out.push(part);
  }
  return out.join("/") || "/";
}

// The file's link reference definitions: `[name]: target "title"`, keyed by lower-case name.
export function referenceDefs(source) {
  const defs = new Map();
  for (const m of source.matchAll(/^ {0,3}\[([^\]^][^\]]*)\]:\s*<?([^\s>]+)>?/gm)) {
    const key = m[1].trim().toLowerCase().replace(/\s+/g, " ");
    if (!defs.has(key)) defs.set(key, m[2]);
  }
  return defs;
}

// Reference links (`[text][name]`, `[name][]`, `[name]`) and wiki links (`[[page]]`,
// `[[page|text]]`, `[[page#heading]]`) as inline links the text view can draw.
export function expandLinks(text, defs) {
  let s = text.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, page, hash = "", label) => {
    const target = /\.[A-Za-z0-9]+$/.test(page.trim()) ? page.trim() : `${page.trim()}.md`;
    return `[${(label ?? page).trim()}](${encodeURI(target)}${hash ? `#${slugify(hash.slice(1))}` : ""})`;
  });
  if (!defs?.size) return s;
  const look = (name) => defs.get(name.trim().toLowerCase().replace(/\s+/g, " "));
  s = s.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m, label, name) => {
    const to = look(name || label);
    return to ? `[${label}](${to})` : m;
  });
  // A shortcut reference: `[name]` alone, when the file defines it and no ( or : follows.
  s = s.replace(/(^|[^\]!\\])\[([^\]^][^\]]*)\](?![(\[:])/g, (m, pre, name) => {
    const to = look(name);
    return to ? `${pre}[${name}](${to})` : m;
  });
  return s;
}

export { dirOf };
