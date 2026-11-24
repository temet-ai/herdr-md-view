// Images and rendered diagrams. image() only loads files under ~/.config/herdr-app,
// so everything is copied or rendered into .cache/md-view there first.
import * as fs from "fs/promises";
import { appHome, exec, window } from "herdr";

export const CACHE = ".cache/md-view";
const cacheDir = () => `${appHome()}/${CACHE}`;
export const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };

let made = false;
async function ensureDir() {
  if (made) return;
  await fs.mkdir(cacheDir(), { recursive: true });
  made = true;
}

// Width and height from the file header: PNG, GIF, JPEG, WebP, SVG.
export function imageSize(bytes, ext) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return { w: dv.getUint32(16), h: dv.getUint32(20) };
    if (b[0] === 0x47 && b[1] === 0x49) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
        i += 2 + dv.getUint16(i + 2);
      }
    }
    if (String.fromCharCode(...b.slice(8, 12)) === "WEBP") {
      const kind = String.fromCharCode(...b.slice(12, 16));
      if (kind === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (kind === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
      if (kind === "VP8L") { const v = dv.getUint32(21, true); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    }
    if (ext === "svg") {
      const head = new TextDecoder().decode(b.slice(0, 4000));
      const w = head.match(/<svg[^>]*\swidth="([\d.]+)/)?.[1], h = head.match(/<svg[^>]*\sheight="([\d.]+)/)?.[1];
      if (w && h) return { w: Number(w), h: Number(h) };
      const vb = head.match(/viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/);
      if (vb) return { w: Number(vb[1]), h: Number(vb[2]) };
    }
  } catch { /* fall through */ }
  return { w: 480, h: 300 };
}

// Copy or download an image into the cache; resolves {path, w, h} for image().
export async function cacheImage(src) {
  await ensureDir();
  const ext = (src.match(/\.(png|jpe?g|gif|webp|svg|bmp)(\?|#|$)/i)?.[1] ?? "png").toLowerCase();
  const name = `${hash(src)}.${ext}`;
  const dest = `${cacheDir()}/${name}`;
  let bytes;
  if (/^https?:/i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
    await fs.writeFile(dest, bytes);
  } else {
    try {
      bytes = await fs.readFile(src); // works inside the home folder
      await fs.writeFile(dest, bytes);
    } catch {
      // Outside home the fs module can't read: let the system copy it.
      const r = window().platform === "windows"
        ? await exec("cmd", ["/c", "copy", "/Y", src.replaceAll("/", "\\"), dest.replaceAll("/", "\\")])
        : await exec("cp", ["-f", src, dest]);
      if (r.code !== 0) throw new Error((r.stderr || "not found").trim().split("\n").pop());
      bytes = await fs.readFile(dest);
    }
  }
  return { path: `${CACHE}/${name}`, ...imageSize(bytes, ext) };
}

// Render a Mermaid diagram (PNG) or TeX formula (SVG) with tools/render.mjs.
export async function renderDiagram(kind, text, color, config) {
  await ensureDir();
  const key = `${kind}-${hash(`${kind}\u0000${color}\u0000${text}`)}`;
  const ext = kind === "math" ? "svg" : "png";
  const input = `${cacheDir()}/${key}.in`, out = `${cacheDir()}/${key}.${ext}`;
  await fs.writeFile(input, text);
  const script = `${appHome()}/mods/md-view/tools/render.mjs`;
  const r = await exec(config.renderers.node, [script, kind, input, out, color, config.renderers.browser], { timeout: 120000 });
  const m = r.stdout.match(/(\d+)\s*x\s*(\d+)/);
  if (r.code !== 0 || !m) throw new Error((r.stderr || r.stdout || "render failed").trim().split("\n").slice(-2).join(" "));
  return { path: `${CACHE}/${key}.${ext}`, w: Number(m[1]), h: Number(m[2]) };
}
