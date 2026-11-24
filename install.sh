#!/bin/sh
# Install md-view into the Herdr app: copies mods/md-view into your Herdr home and,
# unless --no-renderers is given, installs the optional Mermaid and maths renderers.
#   ./install.sh [--no-renderers]
set -eu

here=$(cd "$(dirname "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
dest="$home/mods/md-view"
renderers=1
[ "${1:-}" = "--no-renderers" ] && renderers=0

[ -d "$home" ] || { echo "No Herdr app home at $home (set HERDR_APP_HOME)." >&2; exit 1; }

mkdir -p "$dest"
# Copy the mod; keep an installed tools/node_modules so updates don't reinstall it.
( cd "$here/mods/md-view" && find . -path ./tools/node_modules -prune -o -type f -print ) | while read -r f; do
  mkdir -p "$dest/$(dirname "$f")"
  cp "$here/mods/md-view/$f" "$dest/$f"
done
echo "Copied md-view to $dest"

if [ "$renderers" = 1 ]; then
  if command -v npm >/dev/null 2>&1; then
    # Use a browser already installed for Mermaid when there is one.
    for b in chromium chromium-browser google-chrome-stable google-chrome brave-browser microsoft-edge \
             "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
      if command -v "$b" >/dev/null 2>&1 || [ -x "$b" ]; then export PUPPETEER_SKIP_DOWNLOAD=1; break; fi
    done
    echo "Installing the Mermaid and maths renderers (npm)..."
    ( cd "$dest/tools" && npm install --no-audit --no-fund --silent )
    echo "Renderers installed."
  else
    echo "npm not found: Mermaid and maths will show as source. Install Node.js and run 'npm install' in $dest/tools."
  fi
fi

if command -v herdr-app >/dev/null 2>&1; then herdr-app check "$dest"; fi
echo "Done. Ctrl-click a .md path in a Herdr terminal to open it."
