# Tab Out

**Keep tabs on your tabs.**

Tab Out is a Chrome extension that replaces your new tab page with a dashboard of everything you have open. Tabs are grouped by domain, with homepages (Gmail, X, LinkedIn, etc.) pulled into their own group. Close tabs with a satisfying swoosh + confetti.

Local by default, with no account required. Optional paid activation is verified offline; checkout opens only when the user explicitly requests it.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/zarazhangrui/tab-out
```

The agent will walk you through it. Takes about 1 minute.

---

## Features

- **See all your tabs at a glance** on a clean grid, grouped by domain
- **Homepages group** pulls Gmail inbox, X home, YouTube, LinkedIn, GitHub homepages into one card
- **Close tabs with style** with swoosh sound + confetti burst
- **Duplicate detection** flags when you have the same page open twice, with one-click cleanup
- **Click any tab to jump to it** across windows, no new tab opened
- **Save for later** bookmark tabs to a checklist before closing them
- **Localhost grouping** shows port numbers next to each tab so you can tell your vibe coding projects apart
- **Expandable groups** show the first 8 tabs with a clickable "+N more"
- **Safe close and undo** restores window layout, pinned tabs, and native tab groups
- **Automatic snapshots and history** recover a complete browsing session after mistakes or crashes
- **Project workspaces** support rules, templates, bulk actions, and opening only missing pages
- **Global command search** covers open tabs, workspaces, collected groups, history, and saved items
- **Portable backup** exports and validates the complete user-owned dataset
- **Local by default** browsing content stays on the device unless optional encrypted sync is explicitly enabled in a future release
- **Pure Chrome runtime** no local server or runtime package installation

---

## Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/zarazhangrui/tab-out.git
```

**2. Load the Chrome extension**

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Navigate to the `extension/` folder inside the cloned repo and select it

**3. Open a new tab**

You'll see Tab Out.

---

## How it works

```
You open a new tab
  -> Tab Out shows your open tabs grouped by domain
  -> Homepages (Gmail, X, etc.) get their own group at the top
  -> Click any tab title to jump to it
  -> Close groups you're done with (swoosh + confetti)
  -> Save tabs for later before closing them
```

Everything runs inside the Chrome extension. Browsing assets are stored in `chrome.storage.local`. A configured external checkout page is opened only after an explicit purchase click; license verification itself is local.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Storage | chrome.storage.local |
| Optional licensing backend | Web-standard Worker + Lemon Squeezy License API |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |

## Development

The extension has no runtime dependencies. Node.js is used only for automated verification:

```bash
npm test
npm run check
npm run package
```

Core domain, storage, and Chrome API adapters live under `extension/src/`. Tests use Node's built-in test runner and run in CI on every push and pull request.

Commercial release configuration and license issuance are documented in [docs/COMMERCIAL_RELEASE.md](docs/COMMERCIAL_RELEASE.md). Product and implementation scope are tracked in [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md), [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md), and the requirement-level [docs/REQUIREMENTS_AUDIT.md](docs/REQUIREMENTS_AUDIT.md).

---

## License

MIT

---

Built by [Zara](https://x.com/zarazhangrui)
