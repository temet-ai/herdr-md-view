#!/bin/sh
# Tests the link handler and settings logic against a stand-in for Herdr's API.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/node_modules/herdr" "$tmp/home/mods/md-view"
cp "$here/herdr-stub/"* "$tmp/node_modules/herdr/"
cp "$here/../mods/md-view/link.js" "$here/../mods/md-view/config.js" "$here/../mods/md-view/mod.json" "$tmp/home/mods/md-view/"
cp "$here/settings.test.mjs" "$tmp/"
cd "$tmp" && MDHOME="$tmp/home" node settings.test.mjs
node "$here/copy.test.mjs"
node "$here/review.test.mjs"
