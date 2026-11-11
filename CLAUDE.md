# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Tab Out (v2.3) is a Chrome Manifest V3 extension that overrides the new tab page. Beyond the original "open tabs grouped by domain" dashboard it now has Projects (named sets of pages with native window/tab-group layout), snapshots/undo/trash, unified search (Cmd/Ctrl+K, omnibox keyword `to`), opt-in Browsing Memory (captured page text in IndexedDB, optional user-configured OpenAI-compatible model), four UI languages, and offline-verified paid entitlements.

The extension itself has **no runtime dependencies, no bundler and no build step** — vanilla JS/CSS/HTML; keep it that way. Node is used only for tests and tooling. `server/worker.mjs` is an optional, separately deployed license Worker (see `server/README.md`), not part of the extension.

## Commands

```bash
nvm use                       # .nvmrc selects Node 24; Node >= 22 required
npm test                      # node --test over tests/**/*.test.js (unit + integration, ~2s)
node --test tests/unit/schema.test.js                                  # one file
node --test --test-name-pattern="backs up legacy" tests/unit/migration-service.test.js  # one test
npm run check                 # node --check syntax pass over extension/, server/, tools/
npm run package               # zip extension/ -> dist/tab-out-<version>-store.zip (dist/ is gitignored)
```

Real-browser e2e (`tools/run-chrome-e2e.mjs`) launches headless Chrome for Testing with a disposable profile and the unpacked extension, then runs one `tools/chrome-*-e2e.mjs` script per suite:

- `npm run e2e:isolated` (regression + projects), `e2e:projects`, `e2e:memory`, `e2e:i18n`, `e2e:release`
- Other suites only via flags: `node tools/run-chrome-e2e.mjs --layout-only | --unified-only | --saved-flow-only | --regression-only`
- Needs Chrome for Testing in `~/.cache/puppeteer/chrome` or `CHROME_FOR_TESTING=<binary>`. Artifacts go to a temp dir or `TAB_OUT_TEST_ARTIFACTS`. `TAB_OUT_TEST_LOCALE=zh-CN` switches layout coverage to Chinese.
- The memory suite pre-grants optional permissions in a temp copy of `extension/`, since headless Chrome can't approve permission prompts.
- `npm run e2e:chrome` runs `chrome-e2e.mjs` directly against an already-running Chrome at `TAB_OUT_CDP_ORIGIN` (default `http://127.0.0.1:9333`); prefer the isolated runner.

There is no CI workflow (`.github/` is empty), so run `npm test` and `npm run check` locally.

Manual testing: load `extension/` unpacked in `chrome://extensions`. Refresh the new tab for page changes; reload the extension for `manifest.json`, `background.js` or content-script changes.

## Architecture

### One module set, two runtimes, no ES modules

- **Dashboard page:** `extension/index.html` loads classic `<script>` tags in dependency order (`config.js`, `entitlement-config.js`, `locales/*.js`, `i18n.js`, `src/**`, then `app.js` last).
- **Service worker:** `extension/background.js` loads a subset of the same `src/` files with `importScripts(...)`.
- **Module pattern:** every `src/` file is an IIFE. It resolves dependencies with `require()` under Node or `globalScope.TabOutCore` in the browser, merges its exports into `globalThis.TabOutCore`, and sets `module.exports` for tests:

  ```js
  (function initX(globalScope) {
    const dep = typeof require === 'function' ? require('../storage/schema.js') : globalScope.TabOutCore;
    const api = { ... };
    globalScope.TabOutCore = Object.assign(globalScope.TabOutCore || {}, api);
    if (typeof module !== 'undefined') module.exports = api;
  })(typeof globalThis !== 'undefined' ? globalThis : self);
  ```

- **Adding a module:** follow this pattern, then add it to `index.html` and/or the `importScripts` list in `background.js`, after the modules it depends on.

### Layers (`extension/src/`)

- `shared/sanitize.js` — `escapeHtml` and `normalizeWebUrl`; use them for any HTML output or stored URL.
- `domain/` — pure session model and rule engine.
- `storage/` — repositories built as `createXRepository(storageArea)`. `storageArea` is any `{get, set}`, so tests pass an in-memory fake. `schema.js` owns `CURRENT_SCHEMA_VERSION` and legacy sanitizing/migration. `browsing-memory-repository.js` uses IndexedDB.
- `api/chrome-session-adapter.js` — wraps `chrome.tabs`/`windows`/`tabGroups` for capturing and restoring sessions.
- `services/` — business logic as `createXService({...deps})` factories.
- `ui/` — feature UIs (project workbench, saved library, browsing memory, search-platform settings, dashboard navigation), each with its own CSS file.
- `content/browsing-memory-content.js` — content script. `browsing-memory-runtime.js` registers it dynamically only after the user opts in (optional `scripting` + host permissions).

The top-level files tie these together:

- `app.js` (~3400 lines) — dashboard orchestration. It instantiates the repositories and services, renders the Tabs/Projects/Memory views, the command palette, overlays (history, trash, cleanup, upgrade, settings, restore, onboarding) and toast/undo.
- `background.js` — maintains the toolbar badge, marks snapshots dirty on tab/window/group events, runs the `tab-out-maintenance` alarm every 6h, and handles the omnibox and the four manifest `commands`. It also hosts the Browsing Memory runtime (`TabOutCore.installBrowsingMemory(chrome)`).

### Cross-context coordination

- Page → service worker: `chrome.runtime.sendMessage({ type: 'browsing-memory', action, payload })`. Service worker → page: `{ type: 'open-command' }`. Content script → service worker: `browsing-memory-capture`.
- Shared state lives in `chrome.storage.local`; the page refreshes via `chrome.storage.onChanged`.
- Project writes can come from several contexts at once (dashboard tabs, background commands). They go through `withProjectStorageLock` (`navigator.locks`, in `storage/project-normalization.js`). Changes that span several keys must be committed in a single `storage.set`.

### Storage

- Keys carry a version suffix (`workspacesV2`, `interfaceLanguageV1`, `entitlementV1`, ...). Don't change an existing key's shape in place. Add a new key plus a migration that writes a backup first.
- `storageMeta.schemaVersion` drives `runStorageMigration` (`services/migration-service.js`), which saves `migrationBackupV1` before rewriting `deferred`, `shortcuts` and `sessionsV2`.
- Projects live in `workspacesV2`. Legacy `tabGroups` batches are normalized into it on read (`normalizeProjectState`), and the originals are kept in `projectMigrationBackupV1`.
- `deferred` is the read-later list.
- Browsing Memory page text is stored in IndexedDB, never in `chrome.storage.local`.

### i18n

- `i18n.js` contains the `en` and `zh-CN` dictionaries plus `t(key, params)` / `tPlural(...)`. `locales/zh-TW.js` and `locales/ja.js` register additional dictionaries on `globalThis.TabOutLocales`.
- `_locales/*/messages.json` holds only the manifest name and description, which follow Chrome's own language.
- All four dictionaries must have identical keys and placeholders, with no English fallback merge. `tests/unit/i18n.test.js` enforces this, so every new UI string needs entries in all four.

### Entitlements

- `services/entitlement-service.js` verifies signed P-256 tokens offline against `TAB_OUT_PUBLIC_KEY_JWK` in `entitlement-config.js`.
- In the repo, the public key is `null` and the checkout/redemption URLs are empty.
- The Free plan allows unlimited basic projects but limits history/snapshots/trash. Rules, templates and advanced filters are gated.
- Private signing keys never go into the extension. See `tools/license-*.mjs` and `docs/COMMERCIAL_RELEASE.md`.

`config.js` ships with the extension and holds optional grouping overrides (`LOCAL_LANDING_PAGE_PATTERNS`, `LOCAL_CUSTOM_GROUPS`). `config.local.js` is no longer loaded.

## Testing Gotchas

- `app.js` and `i18n.js` are not modules. Several tests read them as text, slice out functions with `sourceBetween(startMarker, endMarker)` and run those functions in a `vm` context with stubbed `chrome`/`document`. These include `dashboard-refresh`, `command-focus`, `free-command-palette`, `project-*-ui` and `i18n`. Renaming or reordering functions in `app.js` can break those tests; update the markers to match.
- `tests/integration/ui-contract.test.js` statically checks `index.html`, `app.js`, `background.js` and the manifest. It verifies that element ids are unique, that every literal `getElementById` id exists in the markup, that every page script file exists, and that each manifest command is handled in `background.js`.

## Releases and Docs

- The version appears in three places: `package.json` `version`, the zip filename in its `package` script, and `extension/manifest.json`.
- Unreleased work goes in `CHANGELOG.md` under `## Unreleased — YYYY-MM-DD`.
- The manifest `key` pins the extension ID; the e2e runner derives the ID from it. Don't change or remove it.
- Adding a required permission triggers a re-approval prompt for existing users. Browsing Memory uses optional permissions requested at runtime.
- Network access is limited to:
  - the user-configured model endpoint, only on an explicit AI search;
  - checkout, only on an explicit click;
  - `license.tabout.app`.

  If data flows change, update `docs/PRIVACY.md`.
- `docs/ai-tasks/<date>-<topic>/` records past work: `task.md` (frozen scope and acceptance criteria), `implementation.md`, `acceptance*.md` and `evidence/`. Look here for the reasoning behind existing behavior.
- Current product status is in `docs/PRODUCT_BACKLOG.md` and `docs/RELEASE_READINESS.md`. `PRODUCT_PLAN.md` and `DEVELOPMENT_PLAN.md` are drafts from August 2026.
- `AGENTS.md` is the upstream walkthrough for end users who ask an agent to "install this". Its "no Node.js, no npm" refers to the runtime only.
