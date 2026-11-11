# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Tab Out 3.0 is a Chrome Manifest V3 extension that overrides the new tab page. Its whole job, which the owner calls its soul, is:

- show open tabs grouped by site;
- close a site, close duplicates, or stash a site in one click;
- restore stashed pages later.

Version 3.0 was rebuilt on 2026-11-11 from the original fork (`40579ec`) after the 2.x line drifted into a "browsing workbench". The 2.x code lives at tag `v2.3-workbench-archive`. Why it was rebuilt, and the decisions taken, are in `docs/product-reviews/2026-11-11-soul-review/` and `docs/ai-tasks/2026-11-11-soul-rebuild/` (`design.md` is the spec).

**Scope guard:** new features do not go on the home page by default. Anything that adds always-visible controls, a network request, or a permission needs the owner's explicit decision. The home guard e2e (below) enforces the floor.

No runtime dependencies, no bundler, no build step — vanilla JS/CSS/HTML. Keep it that way. Node is only for tests and tooling.

## Commands

```bash
nvm use                       # .nvmrc → Node 24; Node >= 22 required
npm test                      # node --test: tests/unit + tests/integration (~0.5s)
node --test tests/unit/close-undo.test.js                          # one file
node --test --test-name-pattern="pinned" tests/unit/grouping.test.js   # one test
npm run check                 # node --check over extension/, tools/, tests/
npm run e2e:home              # home guard in headless Chrome for Testing (zh-CN + en)
npm run package               # dist/tab-out-3.0.0-store.zip
```

`npm run e2e:home` (`tools/run-chrome-e2e.mjs` → `tools/chrome-home-e2e.mjs`) needs Chrome for Testing in `~/.cache/puppeteer/chrome` or `CHROME_FOR_TESTING=<binary>`. It runs each language in a disposable profile. `TAB_OUT_TEST_ARTIFACTS=<dir>` keeps the screenshots. It asserts the design.md §5 checks:

- first card ≤ 100px from the top;
- ≤ 30 visible controls on the first screen;
- card buttons on one row at 1440 and 1366;
- zero http(s) requests from the page;
- each core action takes one click and can be undone;
- titles are escaped;
- the v2.3 → v3 migration works;
- pages opened or closed in another window appear without a reload (scenario 14, a regression guard rather than a §5 check).

CI (`.github/workflows/verify.yml`, every push and PR) runs `npm test`, `npm run check`, a grep for remote scripts and inline handlers, and `npm run package`. It does not run the browser suite, so run `npm run e2e:home` locally before merging UI changes.

Manual testing: load `extension/` unpacked. Refresh the new tab after page changes; reload the extension after `manifest.json` or `background.js` changes.

## Architecture

- `extension/index.html` loads classic scripts in this order: `config.js` → `i18n.js` → `lib/*.js` → `app.js`. There are no ES modules.
- `extension/lib/*.js` holds the pure, testable logic. Each file is an IIFE that merges its exports into `globalThis.TabOutLib`, sets `module.exports` for Node tests, and resolves dependencies via `require()` under Node or `TabOutLib` in the page. Load order in `index.html` must respect those dependencies (`config-io` needs `collected-store`).

  | File | Responsibility |
  |---|---|
  | `sanitize.js` | `escapeHtml`. Every title, URL or label put into `innerHTML` must go through it. |
  | `grouping.js` | `groupTabsBySite` (homepages first, `config.js` overrides), `duplicateTabIds` (keeps a pinned, then the active, then the first copy), `faviconUrl` (Chrome `_favicon`; never Google). |
  | `close-undo.js` | `createUndoController`. All user-tab closes go through `close(tabs, meta)`. It closes by tab id, skips pinned or vanished tabs, and remembers one operation for 30 seconds. `undo()` reopens tabs in their original window and index, or in a new window if that one is gone. |
  | `collected-store.js` | Stash records under `collectedGroupsV3`, restored OneTab-style (restoring removes the record). `migrateLegacy` copies the owner's 2.x `workspacesV2` projects in once, idempotent by `sourceId`. |
  | `live-refresh.js` | `createRefreshScheduler`. Folds bursts of tab events into at most one re-render per 200ms. It waits while an action or a close animation runs, skips while the page is hidden, and catches up on `visibilitychange`. |
  | `config-io.js` | Export format v3. Import also accepts the original v1 file and the 2.x backup. |

- `renderOpenTabs()` in `app.js` redraws the site cards and the header. It runs after actions and, via `live-refresh.js`, whenever `chrome.tabs.onCreated` / `onRemoved` / `onReplaced` / `onUpdated` (url, title or pinned) fire in any window. It keeps expanded "+N more" rows and keyboard focus, and leaves the "inbox zero" state on screen after the last card closes.
- `extension/app.js` renders the page and handles every `data-action` click through document-level event delegation. Close and stash actions run one at a time (`exclusive()`), and an action that closed nothing leaves the current undo toast alone. The actions are:
  - site cards: `close-domain-tabs`, `collect-domain-tabs`, `dedup-keep-one`;
  - header: `dedup-all`, `collect-all-tabs`, `close-all-open-tabs`;
  - right column: stash and save-for-later actions;
  - toast: `undo-last`.
- `extension/background.js` only keeps the toolbar badge (tab count) up to date.
- `tests/integration/static-contract.test.js` guards these invariants:
  - permissions are exactly `tabs, storage, favicon`, and the manifest `key` is unchanged (it fixes the extension ID, so users keep their storage);
  - there are no external resources and no inline handlers;
  - `app.js` calls `chrome.tabs.remove` only in `closeTabOutDupes`;
  - `app.js` never names the legacy `tabGroups` key.

## Data

`chrome.storage.local` keys used by v3:

- `deferred`: save-for-later items, same format as the original.
- `shortcuts`: left sidebar shortcuts.
- `collectedGroupsV3`: stash records, `{ id, savedAt, name?, sourceId?, tabs: [{ url, title }] }`.
- `soulMigrationV1`: marks the one-time 2.x migration as done.
- `closeAllConfirmedV1`: "close all" has been confirmed once.

Keys from 2.x (`workspacesV2`, `tabGroups`, snapshots, browsing-memory IndexedDB…) are deliberately left untouched. v3 never deletes them. The archived 2.x build empties `tabGroups` whenever it runs, which is why v3 stores stashes under its own key. Don't change an existing key's shape; add a new key plus a migration.

## Copy

`extension/i18n.js` has `en` and `zh-CN` dictionaries, which must have identical keys and placeholders (`tests/unit/i18n.test.js`). Use these terms consistently:

| zh-CN | en |
|---|---|
| 站点 | site |
| 收纳 / 已收纳 / 全部收纳 | Stash / Stashed / Stash all |
| 稍后查看 | Saved for later |
| 撤销 | Undo |

`_locales/` only holds the manifest name and description. `AGENTS.md` is the upstream walkthrough for end users who ask an agent to "install this".
