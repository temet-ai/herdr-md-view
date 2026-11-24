// The text side of notes, reviews, task boxes and front matter. No imports, so the tests
// load it in Node.

const range = (it) => (it.end - it.start > 1 ? `${it.start + 1}-${it.end}` : `${it.start + 1}`);

// One block as the agent gets it: the path and lines, the lines as a quote, then the note.
export function quote(file, it, note = "", format = "quote") {
  const body = format === "plain" ? it.text : `${file}:${range(it)}\n${it.text.split("\n").map((l) => `> ${l}`).join("\n")}`;
  return note ? `${body}\n${note}` : body;
}

// Several notes as one message, in the order of the file, a blank line between them.
export function reviewText(file, items, format = "quote") {
  return [...items].sort((a, b) => a.start - b.start).map((it) => quote(file, it, it.note, format)).join("\n\n");
}

const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

// The text with the task box on `line` (0-based) flipped, or null when that line has none.
export function toggleTaskLine(src, line) {
  const lines = src.split("\n");
  const m = TASK_LINE.exec(lines[line] ?? "");
  if (!m) return null;
  lines[line] = `${m[1]}[${m[2] === " " ? "x" : " "}]${lines[line].slice(m[0].length)}`;
  return lines.join("\n");
}

// How many task boxes the blocks hold and how many are ticked.
export function taskCount(blocks) {
  let done = 0, all = 0;
  for (const b of blocks) for (const it of b.items ?? []) if (it.task !== null && it.task !== undefined) { all++; if (it.task) done++; }
  return { done, all };
}

// Front matter as rows of [key, value]. Top-level `key: value` lines become rows; indented
// lines and `- item` lines under a key join its value with commas. Anything else is kept
// as a row with an empty key, so nothing is hidden.
export function frontRows(text) {
  const rows = [];
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (top) { rows.push([top[1], unquote(top[2])]); continue; }
    const more = /^\s+(?:-\s+)?(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (more && rows.length) {
      const last = rows[rows.length - 1];
      last[1] = last[1] ? `${last[1]}, ${unquote(more[1])}` : unquote(more[1]);
      continue;
    }
    rows.push(["", line.trim()]);
  }
  return rows;
}

function unquote(v) {
  const s = v.trim();
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(",").map((x) => unquote(x)).filter(Boolean).join(", ");
  return /^(["']).*\1$/.test(s) ? s.slice(1, -1) : s;
}
