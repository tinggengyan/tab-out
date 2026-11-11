# Tab Out

**Keep tabs on your tabs.**

Tab Out is a local-first Chrome extension for keeping several projects in one browser window. Select the pages that belong together, save a project, put it away safely, and return by opening only missing pages. Your new tab page also shows everything you have open, grouped by domain.

Local by default, with no account required. Optional paid activation is verified offline; checkout opens only when the user explicitly requests it.

Version 2.3 adds **Browsing Memory**: find pages you visited without bookmarking them, search captured text, and optionally use your own OpenAI-compatible Chat Completions service for query expansion, ranking, and cited summaries. Recording starts only when enabled. Model requests go only to the service you configure; sending page excerpts requires an explicit choice for that search. See [setup and data controls](docs/BROWSING_MEMORY_GUIDE.md).

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/tinggengyan/tab-out
```

The agent will walk you through it. Takes about 1 minute.

---

## Features

- **Projects in a mixed window** select pages across websites without treating the entire window as one project
- **Save before closing** preview the exact selection, keep pinned and unrelated pages open, and undo back to the original window
- **Safe project switching** save the source, restore the destination, then put away only the chosen source pages; shared pages stay open
- **Open only missing pages** reuse existing tabs and retry failed restores without duplicating successes
- **Local backup status** export complete project layouts and see when an export was last requested
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
- **One project library** keeps old collected batches and new projects together, with optional names, updates, rename and trash recovery; basic project saving has no count limit
- **Global command search** covers open tabs, projects, history, read-later items and browsing memory
- **Portable backup** exports and validates saved extension assets; Browsing Memory has a separate JSON export/import
- **Local by default** captured browsing memory stays on the device; explicit AI queries go to your configured model, and page excerpts are sent only when you allow them for that search
- **Pure Chrome runtime** no local server or runtime package installation

---

## Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/tinggengyan/tab-out.git
```

**2. Load the Chrome extension**

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Navigate to the `extension/` folder inside the cloned repo and select it

**3. Open a new tab**

You'll see Tab Out.

The dashboard opens on **Tabs**, with open pages and read-later items immediately available. Saved batches live together in **Projects**; **Browsing Memory** opens when needed. The navigation and shared footer stay visible while the middle content area scrolls. Footer tools remain aligned at the bottom across all three views, including when translated labels wrap on narrow screens. Switching preserves each view's content and scroll position; reloading starts on Tabs.

### Interface language

Open **Settings → Language** to choose **English**, **简体中文**, **繁體中文**, or **日本語**. Changes apply immediately, stay on this device, and are remembered in new tabs. Switching preserves the current view, search results, selections, and unsaved model settings. It changes interface labels and dates; your saved titles, page content and model answers keep their original language.

**Follow browser** uses the first supported language in the browser's preference list, then the browser's primary language and Chrome interface language, with English as the fallback. Chinese `Hant` uses Traditional Chinese and `Hans` uses Simplified Chinese; without an explicit script, `TW`, `HK` and `MO` use Traditional Chinese. The extension description shown in Chrome's management page follows Chrome's own language, independently of this setting. Translations are bundled locally and make no translation-service requests. Japanese and Traditional Chinese translations have not yet had native-speaker review.

### Open tabs and saved pages

1. On **Open tabs**, select related pages across cards, then save the selection using the shared action bar. A name is optional. Saving keeps pages open by default; **Save & put away** explicitly closes selected ordinary pages after saving. Pinned pages stay open.
2. **Saved** contains all existing projects and collected batches. Open a name to inspect its complete contents, open one link, or open only missing pages. Opening keeps saved records and leaves unrelated pages alone. Read-later items remain separate.
3. Adding selected open pages to an existing project preserves its earlier pages and saved layout. Replacing saved contents is a separate action with an added/retained/removed preview. Removing a saved link does not close its browser tab.
4. Cancel returns to the view and selection where you started. Saving also keeps that context; use **View** to inspect the result. Advanced project switching stays in secondary controls and requires an explicit source selection. If a destination cannot be fully restored, the source remains open.

See the [Chinese usage and upgrade guide](docs/PROJECT_WORKBENCH_GUIDE.md). Existing unpacked installations should reload the extension and refresh the page; do not uninstall or clear storage. Version 2.2.0 adds the `tabGroups` permission to preserve native group metadata.

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

Everything runs inside the Chrome extension. Saved browsing assets and settings use `chrome.storage.local`; captured page text uses local IndexedDB. Explicit AI requests use your configured model service. A configured external checkout page is opened only after an explicit purchase click; license verification itself is local.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Storage | chrome.storage.local + IndexedDB for Browsing Memory |
| Optional AI | User-configured OpenAI-compatible Chat Completions service |
| Optional licensing backend | Web-standard Worker + Lemon Squeezy License API |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |

## Development

Use `npm run e2e:i18n` with the project Node version and Chrome for Testing to verify language switching, persistence, draft preservation and responsive layouts in a disposable browser profile.

### Unified search

Open **Search** on the dashboard (or press Cmd/Ctrl+K there). Free local search covers open tabs, projects, read-later items and recorded browsing memory. Results identify their source; selecting an already open page reuses its tab. Duplicate URLs show a count and are never automatically closed. AI expansion and summaries remain in Browsing Memory, with explicit model/content controls.

Choose **Search websites** to add a platform's name, optional aliases, domain, and search URL template. Copy a real search URL and replace its query with `{Query}`. For example, a Google template is `https://www.google.com/search?q={Query}`. Names and aliases such as `语雀`, `yuque`, and `yq` can all identify one user-configured platform. Enter `yq 支付接入` to search directly; selecting a knowledge base first is not required. Internal hostnames are supported. Use the explicit test button to verify your own platform URL.

In Chrome's address bar, enter `to`, activate the extension keyword mode, then enter your query. Selecting an open-tab suggestion switches to that tab. Submitting ordinary words without selecting a suggestion opens the dashboard with those words; a platform command opens a new search. After updating this unpacked build, **reload Tab Out in `chrome://extensions` and refresh the dashboard** so both the service worker and page receive the change.

Platform settings are stored locally, support JSON import/export with conflict preview, and are included in configuration backups. Queries are sent only to the selected website when you explicitly search. Advanced filters and snapshot history retain their existing Pro gate; finding saved pages does not require an upgrade. Native address-bar keyword activation was confirmed by the user during earlier acceptance; automated tests cover the extension handlers and isolated dashboard flows.

### Verification

The extension has no runtime dependencies. Node.js is used only for automated verification:

```bash
nvm use
npm test
npm run check
npm run package
```

Development requires Node.js 22+; `.nvmrc` selects Node 24. For repeatable real-browser tests, use an installed Chrome for Testing and run `npm run e2e:isolated`, or `npm run e2e:projects` for just the new project journeys. Set `CHROME_FOR_TESTING` if it is outside the standard Puppeteer cache. Each suite uses a temporary profile and does not access your daily browsing profile.

`npm run e2e:memory` verifies memory capture, real IndexedDB, a simulated logged-in page, a local Chat Completions fixture, citations, cancellation, and backup round trips. Its disposable extension copy pre-grants the optional permissions; native permission prompts and the user's actual model service remain separate manual integration checks.

`node tools/run-chrome-e2e.mjs --layout-only` verifies the default tab view, actual first-screen card positions, view navigation, scroll/focus restoration and retained data. Use `TAB_OUT_TEST_LOCALE=zh-CN` for Chinese layout coverage.

`node tools/run-chrome-e2e.mjs --unified-only` checks old-batch migration, concurrent dashboard writes, rename/update, trash, repeated imports and migration commit failures. `npm run e2e:release` exercises migrated-project restore failures/retries, optional names, Free local memory search and separate memory downloads. `npm run evaluate:retrieval` compares 20 declared lexical queries against the pre-convergence snapshot; its synthetic corpus is a regression check, not a claim about real-user retrieval quality.

Core domain, storage, and Chrome API adapters live under `extension/src/`. Tests use Node's built-in test runner and run in CI on every push and pull request.

Commercial release configuration and license issuance are documented in [docs/COMMERCIAL_RELEASE.md](docs/COMMERCIAL_RELEASE.md). Product and implementation scope are tracked in [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md), [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md), and the requirement-level [docs/REQUIREMENTS_AUDIT.md](docs/REQUIREMENTS_AUDIT.md).

Actual model integration, support details and commercial release prerequisites are tracked in [docs/RELEASE_READINESS.md](docs/RELEASE_READINESS.md).

Feature ideas and supporting market research are collected in [docs/PRODUCT_BACKLOG.md](docs/PRODUCT_BACKLOG.md), with implemented scope distinguished from candidates awaiting discussion.

---

## License

MIT

---

Built by [Zara](https://x.com/zarazhangrui)
