# Unified Search Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute the bounded core task and review integration; use checkbox steps to track progress.

**Goal:** Free tab switching and configurable multi-alias platform search in the dashboard and omnibox.

**Architecture:** Shared pure parser and validated storage repository; shared search controller for tab identity and platform actions; existing dashboard and background consume these modules. Platform settings use a separate UI controller to avoid further growing legacy app logic.

**Tech Stack:** Vanilla JavaScript, Manifest V3, chrome.storage.local, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-14-unified-search-design.md`

## Global Constraints

- No runtime dependencies or new permissions.
- Basic open-tab search and platform search are free; other advanced assets remain gated.
- No automatic closing; preserve exact tab IDs and URL identity.
- Platform config and queries stay local until explicit external search.
- HTTP(S) templates only; one `{Query}` in path/query; encode query parameters.
- Names and aliases normalize NFKC and case, reject collisions across platforms.

## Task 1: Parser, repository and portable data

Files: create `extension/src/services/platform-search-service.js`, `extension/src/storage/search-platform-repository.js`, `tests/unit/platform-search.test.js`; modify backup-service and its unit tests.

Interfaces: `validateSearchPlatforms(list)` returns normalized array or throws field error; `parsePlatformQuery(text, platforms)` returns `{kind:'tabs',query}` or `{kind:'platform',platform,query,url}` (empty query has no URL); `findSearchPlatforms(text, platforms)` returns suggestions. Repository exposes `list()`, `save(list)`, `previewImport(payload)` returning `{platforms,added,conflicts}`, and `export()`.

- [x] Add failing tests for aliases, command boundary, longest match, encoding, bad schemes/credentials/host placeholder, limits and cross-platform collisions.
- [x] Run `node --test tests/unit/platform-search.test.js`; confirm missing behavior fails.
- [x] Implement parser using normalized complete-prefix matching and `encodeURIComponent(query)`; repository validates before one write and treats missing key as empty.
- [x] Add backup round-trip, invalid config and conflicting merge tests; integrate `searchPlatformsV1` in allowlist and validation.
- [x] Run focused tests and review core against spec.

Example required assertion:
```js
assert.equal(parsePlatformQuery('yq 中文 & #', platforms).url,
  'https://example.com/search?q=%E4%B8%AD%E6%96%87%20%26%20%23');
assert.equal(parsePlatformQuery('yqdocs', platforms).kind, 'tabs');
```

## Task 2: Free search and omnibox routing

Files: create `extension/src/services/unified-search-service.js`, `tests/unit/unified-search.test.js`; modify background.js and script imports.

Interfaces: shared result records preserve `{type,tabId,windowId,url,title}`; platform commands use parser from Task 1. Explicit suggestion IDs map to records; unknown submitted text routes to dashboard with query in URL hash.

- [x] Test actual search and activation using a fake Chrome API: free results, exact duplicate tab selection, stale tab rejection and new platform search.
- [x] Run the new test file and verify failure before implementation.
- [x] Implement shared result construction and activation; gate only advanced sources in background. Track asynchronous generation numbers to discard stale suggestions.
- [x] Replace raw URL suggestion content with stable action IDs scoped to latest results. Unknown text calls parser, or opens dashboard hash search.
- [x] Run focused tests; confirm no ordinary query silently disappears.

## Task 3: Dashboard and platform editor

Files: app.js, index.html, style.css, i18n.js; create `extension/src/ui/search-platform-settings.js` and UI integration tests.

- [x] Test basic palette access on Free, platform command submission, tab identity and empty platform query.
- [x] Wire existing visible search button and palette to shared service; preserve advanced context actions only when entitled.
- [x] Add platform settings dialog with name, comma-separated aliases, domain, template, explicit test button and field errors. Render via DOM/textContent; preserve focus and Escape handling.
- [x] Add import preview with added/conflict names, explicit confirm/cancel, export and bounded file size. Persist only on confirmation.
- [x] Add English and Chinese copy, pending/error/empty states and actual destination-host preview.
- [x] Verify keyboard navigation, no placeholder live platform URLs and no new permissions.

## Task 4: Full validation and delivery

Files: tools/chrome-e2e.mjs, README.md, CHANGELOG.md, docs/IMPLEMENTATION_STATUS.md.

- [x] Extend isolated browser checks for Free search, aliases, settings persistence and selected duplicate identity.
- [x] Run `npm test`, `npm run check`, `npm run package`; inspect ZIP integrity.
- [x] Run isolated Chrome verification when available; never use real browsing data for destructive tests.
- [x] Request independent whole-change review and fix actionable findings.
- [x] Update documentation with verified behavior, reload instructions and any browser validation limits; commit changes on feature branch.

## Execution notes

Baseline: 117 tests passing. Work occurs on `feat/unified-search` in the existing checkout so the user's unpacked extension path remains valid. Core worker owns only Task 1 files; root owns integration/UI. This avoids shared-file concurrent writes. No merge, push or publication is part of this execution.

## Completion evidence

163 Node tests pass; syntax checks, ZIP generation and integrity pass. Ten isolated Chrome journeys pass, including new free search/platform settings/duplicate identity and backup restoration. Independent review findings fixed and regression-covered. Native desktop automation failed to initialize, so native omnibox keyword activation is explicitly left for manual verification; handler routing is tested. Existing restore E2E wait now waits for persisted partially_failed state instead of the already-populated retry object.
