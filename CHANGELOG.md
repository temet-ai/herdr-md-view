# Changelog

What changed in each md-view release, for people who use it. Every release has a
section here before it is tagged; the release workflow publishes that section as the
release's notes and refuses a tag without one.

Sections use these headings, leaving out any with nothing in them: **New**,
**Changed**, **Fixed**, **Security**, **Upgrading** (anything to do by hand).

## Unreleased

## 0.1.0 (2026-11-24)

The first release.

**New**

- **Ctrl-click a markdown path to open it beside the terminal.** `.md` and `.markdown` paths, `~/` and `./` paths, `file://` and OSC 8 links, and `path.md:42`, which opens at line 42. Later clicks in the same tab show the new file in the same panel. Settings can open files below, in a new tab or in a background tab.
- **View, Edit and Split.** Edits save 800 ms after you stop typing, or with Ctrl+S. If another program changes the file while you edit, a banner asks whether to reload or keep yours.
- **Send to the terminal.** The arrow beside a block or list item pastes `path:lines` and the lines as a `>` quote into the terminal you clicked from, without Enter.
- **Copy as markdown.** Ctrl+C on the rendered page copies the markdown behind the selection. The header's copy button (or `y`) copies the file, and the icon beside a hovered block copies that block.
- **Reading aids.** Outline, find, back and forward between linked files, changed blocks marked after another program rewrites the file, a list of markdown files the terminal mentioned, and keys for all of them.
- **What it renders.** GitHub callouts, highlighted code, tables, bar and line charts, images, footnotes and front matter, plus Mermaid diagrams and display maths with the optional renderers.
- **Settings page** in the panel, saved to `~/.config/herdr-app/md-view.json`.
