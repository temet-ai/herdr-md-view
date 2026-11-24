// Markdown source -> a flat list of blocks, each with its 0-based source line range
// [start, end). The renderer draws blocks; the line range is what "send" quotes and
// what the editor jumps to.
import { makeParser } from "./vendor/markdown.js";

let parser = null;
const md = () => (parser ??= makeParser());

// Index of the token that closes tokens[i] (same level, nesting -1).
function closeOf(tokens, i) {
  const open = tokens[i];
  if (open.nesting !== 1) return i;
  for (let j = i + 1; j < tokens.length; j++) {
    if (tokens[j].level === open.level && tokens[j].nesting === -1) return j;
  }
  return tokens.length - 1;
}

const TASK = /^\[( |x|X)\]\s+/;

function listItems(tokens, from, to) {
  const items = [];
  const stack = []; // {ordered}
  for (let i = from; i <= to; i++) {
    const t = tokens[i];
    if (t.type === "bullet_list_open") stack.push({ ordered: false });
    else if (t.type === "ordered_list_open") stack.push({ ordered: true });
    else if (t.type === "bullet_list_close" || t.type === "ordered_list_close") stack.pop();
    else if (t.type === "list_item_open") {
      let inline = "";
      for (let j = i + 1; j <= to && tokens[j].type !== "list_item_close"; j++) {
        if (tokens[j].type === "inline") { inline = tokens[j].content; break; }
        if (tokens[j].type === "list_item_open") break;
      }
      let task = null;
      const m = inline.match(TASK);
      if (m) { task = m[1] !== " "; inline = inline.slice(m[0].length); }
      const top = stack[stack.length - 1] ?? { ordered: false };
      items.push({
        depth: Math.max(0, stack.length - 1),
        ordered: top.ordered,
        marker: top.ordered ? `${t.info || "1"}.` : "•",
        task,
        inline,
        start: t.map?.[0] ?? 0,
        end: t.map?.[1] ?? 0,
      });
    }
  }
  return items;
}

function table(tokens, from, to) {
  const align = [], header = [], rows = [];
  let row = null, inHead = false;
  for (let i = from; i <= to; i++) {
    const t = tokens[i];
    if (t.type === "thead_open") inHead = true;
    else if (t.type === "thead_close") inHead = false;
    else if (t.type === "tr_open") row = [];
    else if (t.type === "tr_close") { if (inHead) header.push(...row); else rows.push(row); row = null; }
    else if (t.type === "th_open" || t.type === "td_open") {
      if (inHead) {
        const style = t.attrGet?.("style") ?? "";
        align.push(style.includes("right") ? "right" : style.includes("center") ? "center" : "left");
      }
    } else if (t.type === "inline" && row) row.push(t.content);
  }
  return { align, header, rows };
}

function inlineOf(tokens, from, to) {
  for (let i = from; i <= to; i++) if (tokens[i].type === "inline") return tokens[i];
  return null;
}

function footnotes(tokens, from, to) {
  const notes = [];
  for (let i = from; i <= to; i++) {
    const t = tokens[i];
    if (t.type === "footnote_open") {
      const inl = inlineOf(tokens, i, to);
      notes.push({ label: t.meta?.label ?? String((t.meta?.id ?? 0) + 1), inline: inl?.content ?? "" });
    }
  }
  return notes;
}

export function parseBlocks(source) {
  const lines = source.split("\n");
  const tokens = md().parse(source, {});
  const blocks = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.level !== 0) continue;
    const j = closeOf(tokens, i);
    const start = t.map?.[0] ?? (blocks.at(-1)?.end ?? 0);
    const end = t.map?.[1] ?? start + 1;
    const base = { start, end, source: lines.slice(start, end).join("\n") };
    switch (t.type) {
      case "front_matter":
        blocks.push({ ...base, kind: "front", text: t.meta ?? "" });
        break;
      case "heading_open":
        blocks.push({ ...base, kind: "heading", level: Number(t.tag.slice(1)), inline: inlineOf(tokens, i, j)?.content ?? "" });
        break;
      case "paragraph_open": {
        const inl = inlineOf(tokens, i, j);
        const kids = (inl?.children ?? []).filter((c) => !(c.type === "text" && !c.content.trim()) && c.type !== "softbreak");
        const content = inl?.content ?? "";
        if (kids.length === 1 && kids[0].type === "image") {
          blocks.push({ ...base, kind: "image", src: kids[0].attrGet("src"), alt: kids[0].content });
        } else if (/^\$\$[\s\S]*\$\$$/.test(content.trim())) {
          blocks.push({ ...base, kind: "math", tex: content.trim().slice(2, -2).trim() });
        } else {
          blocks.push({ ...base, kind: "paragraph", inline: content });
        }
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open":
        blocks.push({ ...base, kind: "list", items: listItems(tokens, i, j) });
        break;
      case "blockquote_open":
        blocks.push({ ...base, kind: "quote", inner: lines.slice(start, end).map((l) => l.replace(/^\s*> ?/, "")).join("\n") });
        break;
      case "alert_open": {
        const inner = lines.slice(start + 1, end).map((l) => l.replace(/^\s*> ?/, "")).join("\n");
        blocks.push({ ...base, kind: "alert", type: t.meta?.type ?? "note", title: t.meta?.title ?? "Note", inner });
        break;
      }
      case "fence":
      case "code_block": {
        const lang = (t.info || "").trim().split(/\s+/)[0].toLowerCase();
        blocks.push({ ...base, kind: lang === "chart" ? "chart" : lang === "mermaid" ? "mermaid" : lang === "math" ? "math" : "code", lang, code: t.content.replace(/\n$/, ""), tex: t.content.trim() });
        break;
      }
      case "table_open":
        blocks.push({ ...base, kind: "table", ...table(tokens, i, j) });
        break;
      case "hr":
        blocks.push({ ...base, kind: "hr" });
        break;
      case "footnote_block_open":
        blocks.push({ ...base, kind: "footnotes", notes: footnotes(tokens, i, j) });
        break;
      case "html_block":
        blocks.push({ ...base, kind: "code", lang: "html", code: t.content.replace(/\n$/, "") });
        break;
      default:
        break;
    }
    i = j;
  }
  return blocks;
}

// A ```chart block: "type: bar|line", "title: ...", then "label: number" rows.
export function parseChart(code) {
  const out = { type: "bar", title: "", points: [] };
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const head = line.match(/^(type|title):\s*(.*)$/);
    if (head) { out[head[1]] = head[2].trim(); continue; }
    const cut = line.lastIndexOf(":");
    if (cut < 0) continue;
    const key = line.slice(0, cut).trim(), val = line.slice(cut + 1).trim();
    if (val !== "" && !Number.isNaN(Number(val))) out.points.push({ label: key, value: Number(val) });
  }
  return out;
}

// Inline markdown the built-in renderer can't show: footnote refs and $math$.
export function tidyInline(s) {
  return s
    .replace(/\[\^([^\]]+)\]/g, "[$1]")
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_m, pre, tex) => `${pre}\`${tex}\``);
}
