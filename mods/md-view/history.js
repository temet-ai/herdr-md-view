// Back and forward: each entry is a place, a file and the block you were at. No imports,
// so the tests load it.

// The block you are at: the one under the mouse, else the last one moved to.
export function here(view) {
  const m = /^b(\d+)-/.exec(view.hover ?? "");
  return m ? Number(m[1]) : (view.cursor ?? 0);
}

export function remember(view, path, block = 0) {
  view.history ??= []; view.histPos ??= -1;
  const cur = view.history[view.histPos];
  if (cur && cur.path === view.file) cur.block = here(view);
  if (cur && cur.path === path && cur.block === block) return;
  view.history = view.history.slice(0, view.histPos + 1).concat({ path, block }).slice(-50);
  view.histPos = view.history.length - 1;
}

