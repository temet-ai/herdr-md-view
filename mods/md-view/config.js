// md-view settings: defaults, merged with the person's own file at
// ~/.config/herdr-app/md-view.json (outside the mod folder, so updates keep it).
import { appHome, exec, readTextFile, setShared, window, writeTextFile } from "herdr";

export const DEFAULTS = {
  // Where a Ctrl-click opens the file: "right" or "down" of the terminal, "tab" (a new
  // tab you are taken to) or "background" (a new tab that waits until you go to it).
  placement: "right",
  // Beside or below: show later clicks in the tab's existing panel (true) or open a
  // panel per file (false).
  reuse_panel: true,
  // Beside or below: give the panel the keyboard (true) or leave it in the terminal.
  focus_panel: false,
  // Mode a new panel starts in: "view", "edit" or "split".
  mode: "view",
  // Extensions a Ctrl-click opens. Changing them rewrites mod.json.
  file_types: ["md", "markdown"],
  // Text font for the rendered page. "auto" picks an installed font with real bold
  // and italic faces (Herdr's bundled UI font has neither in rendered text), "ui"
  // uses Herdr's UI font, "mono" the terminal font, anything else is a font name.
  font: "auto",
  text_size: 14,
  // Widest the rendered text gets, in px; 0 fills the panel.
  max_width: 860,
  // Load images from http(s) addresses.
  remote_images: true,
  // false: a read-only viewer, with no Edit or Split.
  allow_edit: true,
  autosave: true,
  autosave_delay_ms: 800,
  send: {
    // "paste" types the quote into the terminal without Enter, so you can add to it.
    // "submit" sends it with herdr-core and presses Enter.
    mode: "paste",
    // "quote": `path:12-14` and the lines as a > quote. "plain": the lines only.
    format: "quote",
    // Put back what was on the clipboard after a paste.
    keep_clipboard: true,
    // Go to the terminal after sending (paste mode always does).
    focus_terminal: true,
  },
  renderers: {
    mermaid: true,
    math: true,
    // Program that runs tools/render.mjs.
    node: "node",
    // Browser for Mermaid: "auto" looks for Chrome, Chromium, Edge or Brave.
    browser: "auto",
  },
};

export const configPath = () => `${appHome()}/md-view.json`;

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

// Returns {config, error}: a broken file keeps the defaults and says why.
export async function loadConfig() {
  const text = await readTextFile(configPath());
  if (text == null) return { config: DEFAULTS, error: null };
  try {
    return { config: merge(DEFAULTS, JSON.parse(text)), error: null };
  } catch (e) {
    return { config: DEFAULTS, error: `md-view.json: ${e.message}` };
  }
}

// Save the whole settings object, publish it to every copy, and rewrite mod.json when
// the file types change (that reloads the mod).
export async function saveConfig(config) {
  const path = configPath();
  const text = `${JSON.stringify(config, null, 2)}\n`;
  const current = await readTextFile(path);
  if (current !== text) await writeTextFile(path, text, current);
  setShared("md-view.config-rev", Date.now()); // every open panel reloads the file
  const mod = `${appHome()}/mods/md-view/mod.json`;
  const modText = await readTextFile(mod);
  let base = {};
  try { base = JSON.parse(modText ?? "{}"); } catch { base = {}; }
  const want = modJson(config.file_types, base);
  if (modText !== null && modText !== want) await writeTextFile(mod, want, modText);
}

// Keeps the rest of mod.json (its version above all) and replaces only the link handler.
export function modJson(types, base = {}) {
  const exts = (types?.length ? types : DEFAULTS.file_types).map((t) => t.replace(/[^a-z0-9]/gi, "")).filter(Boolean);
  const pattern = `(?i)\\.(${exts.join("|")})$`;
  return `${JSON.stringify({ ...base, place: base.place ?? "none", link_handlers: [{ kind: "file", pattern }] }, null, 2)}\n`;
}

export function merged(base, over) { return merge(base, over); }

// The file written when someone opens Settings for the first time.
export function starterConfig() {
  return `${JSON.stringify(DEFAULTS, null, 2)}\n`;
}

const FONT_CANDIDATES = {
  linux: ["Inter", "Noto Sans", "Cantarell", "Ubuntu", "DejaVu Sans", "Liberation Sans"],
  macos: ["Helvetica Neue"],
  windows: ["Segoe UI"],
};

let fontGuess = null;
// The font to render text in: the configured one, else the first installed candidate.
export async function resolveFont(config, settingsNow) {
  if (config.font === "ui") return null;
  if (config.font === "mono") return settingsNow?.font_family ?? null;
  if (config.font && config.font !== "auto") return config.font;
  if (fontGuess) return fontGuess;
  const platform = window().platform;
  const list = FONT_CANDIDATES[platform] ?? [];
  if (platform !== "linux") return (fontGuess = list[0] ?? null);
  try {
    const r = await exec("fc-list", [":", "family"]);
    const have = new Set(r.stdout.split("\n").flatMap((l) => l.split(",").map((s) => s.trim())));
    fontGuess = list.find((f) => have.has(f)) ?? null;
  } catch {
    fontGuess = null;
  }
  return fontGuess;
}
