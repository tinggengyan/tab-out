# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Tab Out is a **pure Chrome Manifest V3 extension** that replaces the new tab page with a dashboard showing open tabs grouped by domain. No server, no npm, no build step, no dependencies.

## Development

**There are no build, lint, or test commands.** All files load directly into Chrome.

To develop:
1. Load `extension/` as an unpacked extension in `chrome://extensions` (Developer mode on)
2. Edit files in `extension/`
3. Refresh the new tab page (or reload the extension for `manifest.json`/`background.js` changes)

## Architecture

All code lives in `extension/`:

- **`manifest.json`** — Manifest V3 config. Permissions: `tabs`, `activeTab`, `storage`. Overrides `newtab` with `index.html`.
- **`app.js`** (~1500 lines) — All dashboard logic: tab fetching, domain grouping, save-for-later, UI rendering, sound effects, confetti, search. Entry point is `renderDashboard()` called on load.
- **`background.js`** (~90 lines) — Service worker that keeps the toolbar badge updated with the current tab count (color-coded green/amber/red).
- **`style.css`** — CSS variables for theming (ink/paper/warm-gray palette), CSS Grid layout for tab cards, bento layout support.
- **`index.html`** — Template with two-column layout: open tabs (left) + saved-for-later sidebar (right). Loads optional `config.local.js` for personal configuration.

## Key Patterns

- **No frameworks** — vanilla JS, CSS, HTML throughout. Keep it that way.
- **Chrome APIs only** — `chrome.tabs.query()` for fetching tabs, `chrome.storage.local` for persistence (saved tabs stored under `deferred` key), `chrome.tabs.onCreated/onRemoved/onUpdated` for live updates.
- **Domain grouping** — tabs are grouped by hostname. "Landing pages" (Gmail, X, LinkedIn, YouTube, GitHub homepages) get their own special group.
- **Sound** — synthesized via Web Audio API (no audio files).
- **`config.local.js`** — optional personal config file, gitignored. Loaded by index.html if present.

## Storage Schema

```js
// chrome.storage.local key: "deferred"
{
  deferred: [{
    id: "timestamp-string",
    url: "https://...",
    title: "Page Title",
    savedAt: "ISO-string",
    completed: false,    // true = archived
    dismissed: false,
    dismissedAt?: "ISO-string"
  }]
}
```
