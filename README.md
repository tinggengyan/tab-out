# Tab Out

**Keep tabs on your tabs.**

Tab Out replaces your new tab page with every open tab, grouped by site. Close a whole site, close duplicates, or stash a site away for later — each in one click, each undoable.

100% local: no server, no account, and the page makes no network requests.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/tinggengyan/tab-out
```

The agent will walk you through it. Takes about 1 minute.

---

## Features

- **Every tab at a glance**, one card per site, across all windows
- **Always current**: tabs you open or close in another window show up without reloading
- **Homepages group** pulls Gmail inbox, X home, YouTube, LinkedIn and GitHub homepages into one card
- **One click per site**: close all, stash, close duplicates — one row of buttons on every card
- **One click for everything**: close all duplicates, stash all, close all
- **Undo for 30 seconds** after any close or stash; pages go back to their original window
- **Stash** a site (or everything) and restore it later from the right column; restoring skips pages that are already open
- **Save for later** a single page to a checklist, with an archive
- **Duplicate detection** marks repeated pages with `(2x)`; pinned tabs are never closed
- **Localhost grouping** shows port numbers so you can tell your dev servers apart
- **Click any tab to jump to it**, even in another window
- **Swoosh + confetti** when tabs close

---

## Manual setup

1. Clone the repo: `git clone https://github.com/tinggengyan/tab-out.git`
2. Open `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder
4. Open a new tab

To update: `git pull`, then click reload on Tab Out in `chrome://extensions`.

### Upgrading from 2.x

Reload the extension; do not uninstall it. On first start, 3.0 copies your 2.x projects into stashed groups once and leaves all old data in place. The 2.x build is archived at the git tag `v2.3-workbench-archive`. If you want to look at it again, load it in a **separate Chrome profile**.

### Personal grouping rules

`extension/config.js` can add homepage patterns (`LOCAL_LANDING_PAGE_PATTERNS`) or merge/split sites into custom groups (`LOCAL_CUSTOM_GROUPS`). The rule format is the same as the built-in rules in `extension/lib/grouping.js`.

---

## Development

The extension has no runtime dependencies and no build step. Node.js (22+, `.nvmrc` selects 24) is used only for verification:

```bash
nvm use
npm test            # unit + static contract tests (node --test)
npm run check       # syntax check of every .js/.mjs file
npm run e2e:home    # home guard in headless Chrome for Testing, zh-CN and en
npm run package     # dist/tab-out-3.0.0-store.zip
```

`npm run e2e:home` needs Chrome for Testing in the Puppeteer cache, or `CHROME_FOR_TESTING=<binary>`. It uses a disposable profile, never your own. Set `TAB_OUT_TEST_ARTIFACTS=<dir>` to keep the screenshots.

The home guard is the product's floor. Every change must keep the following true:

- the first card sits at or above 100px;
- the first screen has at most 30 visible controls;
- card buttons stay on one row;
- the page makes no network requests;
- close, stash and dedupe each take one click and can be undone.

## Privacy

See [docs/PRIVACY.md](docs/PRIVACY.md).

## License

MIT

---

Built by [Zara](https://x.com/zarazhangrui), rebuilt by TinggengYan
