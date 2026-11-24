// Ctrl-click (Cmd-click on macOS) on a markdown path in a terminal: show it in md-view,
// where the settings say. The panel remembers the terminal so it can send lines back.
import { panes, run, setShared } from "herdr";
import { loadConfig } from "./config.js";

const nameOf = (p) => p.slice(p.lastIndexOf("/") + 1);

export async function handleLink(click) {
  const path = click.link.path;
  const { tab, pane, terminal, machine, space } = click.source;
  if (!path || !tab) return "pass"; // remote or unresolved: let the next handler or the opener try
  const { config } = await loadConfig();
  const source = { pane, terminal, machine };
  // `plan.md:42` and `plan.md:42:7`: Herdr strips the line from the path but keeps it in raw.
  const line = Number(click.link.raw?.match(/:(\d+)(?::\d+)?\W*$/)?.[1]) || null;

  if (config.placement === "tab" || config.placement === "background") {
    run("tab.new", { name: nameOf(path), space, mod: "md-view", props: { file: path, source, line }, focus: config.placement === "tab" });
    return "handled";
  }

  const direction = config.placement === "down" ? "down" : "right";
  const open = panes().find((p) => p.tab === tab && p.mod === "md-view");
  if (config.reuse_panel && open) {
    // The tab's panel follows the click; it stays where it is.
    setShared(`md-view.file.${tab}`, { path, ...source, line, at: Date.now() });
    if (config.focus_panel) run("pane.focus", { pane: open.pane });
    return "handled";
  }
  if (config.reuse_panel) {
    setShared(`md-view.file.${tab}`, { path, ...source, line, at: Date.now() });
    run("pane.split", { direction, pane, mod: "md-view", props: { tab } });
  } else {
    // A panel of its own for this file.
    run("pane.split", { direction, pane, mod: "md-view", props: { file: path, source, line } });
  }
  // A new pane takes the keyboard; hand it back unless the settings say otherwise.
  if (!config.focus_panel) run("pane.focus", { pane });
  return "handled";
}
