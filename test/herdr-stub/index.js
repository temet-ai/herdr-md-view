import fs from "fs";
export const log = []; export const state = { shared: {}, panes: [], home: process.env.MDHOME };
export const appHome = () => state.home;
export const run = (name, args) => { log.push([name, args]); return null; };
export const panes = () => state.panes;
export const shared = (k) => state.shared[k];
export const setShared = (k, v) => { state.shared[k] = v; log.push(["setShared", k, v]); };
export const readTextFile = async (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
export const writeTextFile = async (p, text, expected) => {
  const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  if (cur !== expected) throw new Error("stale"); fs.writeFileSync(p, text); log.push(["write", p.split("/").pop()]); return null; };
export const exec = async () => ({ code: 1, stdout: "", stderr: "" });
export const window = () => ({ platform: "linux" });
