// md-view's renderer: one diagram or formula to a file the panel can show.
//   node render.mjs math    <in.tex> <out.svg> <text colour>
//   node render.mjs mermaid <in.mmd> <out.png> <dark|light> [browser path|auto]
// Prints "<width> x <height>" in logical px. Needs `npm install` in this folder.
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [kind, input, out, color = "#e6e6e6", browser = "auto"] = process.argv.slice(2);

const fail = (msg) => { console.error(msg); process.exit(1); };
const pngSize = (buf) => `${Math.round(buf.readUInt32BE(16) / 2)} x ${Math.round(buf.readUInt32BE(20) / 2)}`;
const svgSize = (svg) => `${Math.round(svg.match(/width="([\d.]+)"/)?.[1] ?? 300)} x ${Math.round(svg.match(/height="([\d.]+)"/)?.[1] ?? 60)}`;

// The output name is a hash of kind, text and colour: if it exists, it is current.
if (fs.existsSync(out) && fs.statSync(out).size > 0) {
  console.log(out.endsWith(".png") ? pngSize(fs.readFileSync(out)) : svgSize(fs.readFileSync(out, "utf8")));
  process.exit(0);
}

const missing = (pkg) => fail(`${pkg} is not installed: run \`npm install\` in ${here}`);

if (kind === "math") {
  let mj;
  try {
    mj = {
      ...(await import("mathjax-full/js/mathjax.js")),
      ...(await import("mathjax-full/js/input/tex.js")),
      ...(await import("mathjax-full/js/output/svg.js")),
      ...(await import("mathjax-full/js/adaptors/liteAdaptor.js")),
      ...(await import("mathjax-full/js/handlers/html.js")),
      ...(await import("mathjax-full/js/input/tex/AllPackages.js")),
    };
  } catch { missing("mathjax-full"); }
  const adaptor = mj.liteAdaptor();
  mj.RegisterHTMLHandler(adaptor);
  const doc = mj.mathjax.document("", { InputJax: new mj.TeX({ packages: mj.AllPackages }), OutputJax: new mj.SVG({ fontCache: "none" }) });
  const node = doc.convert(fs.readFileSync(input, "utf8"), { display: true });
  // ex units to px (1ex is about 8.5 px at 16 px text); currentColor to the text colour.
  const svg = adaptor.innerHTML(node)
    .replace(/(width|height)="([\d.]+)ex"/g, (_m, k, v) => `${k}="${(Number(v) * 8.5).toFixed(1)}"`)
    .replace(/currentColor/g, color)
    .replace(/style="[^"]*"/, "");
  fs.writeFileSync(out, svg);
  console.log(svgSize(svg));
} else if (kind === "mermaid") {
  const mmdc = path.join(here, "node_modules", ".bin", process.platform === "win32" ? "mmdc.cmd" : "mmdc");
  if (!fs.existsSync(mmdc)) missing("@mermaid-js/mermaid-cli");
  const exe = browser !== "auto" ? browser : findBrowser();
  const cfg = path.join(os.tmpdir(), `md-view-puppeteer-${process.pid}.json`);
  fs.writeFileSync(cfg, JSON.stringify({ ...(exe ? { executablePath: exe } : {}), args: ["--no-sandbox", "--headless=new"] }));
  try {
    execFileSync(mmdc, ["-p", cfg, "-i", input, "-o", out, "-t", color === "light" ? "default" : "dark", "-b", "transparent", "-s", "2", "-q"],
      { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    fail(String(e.stderr || e.message).trim().split("\n").slice(-3).join(" ") || "mmdc failed");
  } finally {
    fs.rmSync(cfg, { force: true });
  }
  console.log(pngSize(fs.readFileSync(out)));
} else {
  fail("kind must be math or mermaid");
}

// A Chromium-based browser already on the machine, so npm need not download one.
function findBrowser() {
  const candidates = {
    linux: ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome",
      "/usr/bin/brave-browser", "/usr/bin/microsoft-edge", "/snap/bin/chromium"],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
    win32: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
  }[process.platform] ?? [];
  return candidates.find((p) => fs.existsSync(p)) ?? null; // null: puppeteer's own download, if any
}
