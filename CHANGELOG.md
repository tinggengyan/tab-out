# Changelog

## 3.0.0 — 2026-11-11

Back to the soul: open tabs grouped by site, closed, deduplicated or stashed in one click.

- Rebuilt from the original domain-grouped dashboard (`40579ec`). The 2.x workbench is archived at tag `v2.3-workbench-archive`; projects, snapshots, trash, unified search, browsing memory and AI, rules and templates, licensing, telemetry, keyboard commands and the omnibox keyword are gone.
- Every site card has one row of buttons: close all, stash, and close duplicates (only when there are any). The header adds close all duplicates, stash all and close all, across every window. Row buttons appear on hover or keyboard focus.
- The page follows tabs in every window while it is open: pages opened, retitled or closed elsewhere show up without a reload. A Tab Out tab in the background catches up when you switch to it.
- Closing, deduplicating, stashing and saving for later can be undone for 30 seconds; pages return to their original window and position. Pinned tabs are never closed or stashed. "Close all" asks once, the first time.
- Stashed groups sit above Saved for later in the right column. "Restore all" reopens the pages that are not already open and removes the group; a single page can be restored on its own.
- On first start, 2.x projects are copied into stashed groups once. Old data is left untouched. Import also accepts the original fork's file and the 2.x backup.
- No network requests: icons use Chrome's local favicon cache (no more Google favicon service) and DM Sans / Newsreader are bundled. Tab titles and addresses are escaped before display.
- Permissions reduced to `tabs`, `storage` and `favicon`. Interface languages: English and Simplified Chinese.

## Unreleased — 2026-11-06

- Unified old collected tab batches and saved workspaces into Projects, replacing the separate batch list and temporary-collection section. Existing names, timestamps and native session layouts are retained with a local migration backup and retry-safe, coordinated storage writes.
- Routed save and put-away actions through one explicit project preview. Added rename, update, delete/recovery and View project actions; Undo restores pages while retaining the project.
- Preserved the former unlimited collection capability as unlimited basic project saving on Free. Rules, templates and other advanced entitlements remain separate. Updated all four interface languages.
- Kept safe missing-page continuation and complex native-group retry behavior on the unified project path. Historical imports and trash restoration normalize into the same project library.

## Unreleased — 2026-11-05

- Restored Projects as a distinct navigation item and primary list, with its own count and empty state. Temporary collections and read-later items remain in separate expandable sections, with archives and advanced rules/templates accessible. No stored data is migrated; project names remain optional.
- Kept existing tab-home shortcuts, with compact save/put-away actions. Continuing a legacy collection retains the saved source, reuses existing pages and allows partial restore retries without duplicating successful pages.
- Opened basic local command search across open, saved and remembered pages on Free, with source labels and stale-query protection. Existing quotas and advanced automation entitlements remain.
- Fixed incidental short-word matches such as AI in baidu/paid/trail; cleaned legacy reading fragments at query time, limited snippets to 240 characters and added safe highlighting. New extraction groups reading blocks while preserving forum replies and excluding inputs/drafts.
- Corrected paused/ready memory states, showed content-upload disclosure only in AI mode, and linked model controls plus separate memory export from Settings. Configuration backup copy explicitly excludes memory bodies.
- Hid unimplemented sync offers and unconfigured checkout offers while retaining existing-license management. Added release prerequisites, four-language regression checks and a declared synthetic retrieval corpus; real provider integration and public commercial release remain pending.

## Unreleased — 2026-11-04

- Kept attribution and footer tools at the viewport bottom across Tabs, Projects and Browsing Memory. Content now scrolls independently between the navigation and footer, preserving each view's position and allowing translated footer labels to wrap without covering content.
- Added English, Simplified Chinese, Traditional Chinese and Japanese interface selection in Settings, with an ordered browser-language fallback and persistent local preference.
- Language changes update labels, accessible names and dates immediately while preserving the active view, searches, selections and unsaved model/platform/project inputs. Unified search-platform copy with the shared language service.
- Bundled complete Traditional Chinese and Japanese dictionaries and extension descriptions; added language, placeholder, failure-recovery and isolated Chrome checks. Native-speaker translation review remains pending.
- Restored tab management as the default new-tab view. Projects and Browsing Memory now open through compact navigation instead of pushing current tabs below the fold.
- Preserved each view's content, selection and scroll position while keeping reloads on Tabs; retained existing project, memory and command-search dialogs.

## 2.3.0 — 2026-11-02

- Added opt-in Browsing Memory for loaded public, signed-in and internal HTTP/HTTPS pages, with local IndexedDB storage and a separate 30-day browser-history metadata import.
- Added configurable OpenAI-compatible Chat Completions search-term expansion, optional bounded content ranking and summaries with validated source IDs and original quotations. Local search remains available when the model fails.
- Added per-search content consent, cancellation, masked model credentials, site exclusions, pause/delete controls, retention and capacity limits, and separate validated memory backup/import.
- Added result reuse/save actions, Chinese/English UI and responsive layouts. Model calls never start from recording alone; optional permissions are requested when used.
- Verified local protocol fixtures and isolated real-Chrome journeys. The user's actual model service, private-site extraction and retrieval quality require subsequent integration testing.

## 2.2.0 — 2026-11-01

- Added the project workbench for multiple projects in one window: explicit page selection, save-only, safe put-away, missing-page resume and source-aware switching.
- Added clear previews, progress, partial-failure results, failed-page retry, original-window Undo, and local backup export status in English and Chinese.
- Preserved shared destination pages, pinned pages, unrelated project pages and other windows during project switching.
- Fixed native tab-group permissions, original-window/index restoration, failed window creation fallback, partial Undo retry and stale project-layout invalidation.
- Added disposable-profile Chrome for Testing orchestration, real mouse journeys, screenshots, responsive checks and Node version guidance.

## 2.1.0 — 2026-09-15

- Made dashboard and omnibox open-tab search available on Free, retaining Pro gates for advanced saved assets.
- Added configurable website names and aliases, encoded `{Query}` templates, direct platform search, and explicit test search.
- Added local platform management with validated import previews, full backup support, and concurrent edit protection.
- Preserved exact tab identity when selecting duplicate URLs across windows; added stale-tab feedback, asynchronous suggestion guards, and Chinese IME protection.
- Ordinary omnibox queries now open the dashboard with their query instead of silently returning. No new permissions or runtime dependencies.
- Added unit coverage and isolated Chrome journeys for Free search, platform configuration, query encoding, exact duplicate selection, and platform backup restoration.

## 2.0.0 — 2026-08-10

- Added persistent 30-second undo, stepwise recent undo, trash, destructive-action previews, and safe full-data import/export.
- Added complete multi-window session capture, automatic/manual snapshots, native tab-group restoration, restore conflict planning, reports, interrupted-job resume, and group-only retry that never reopens successfully restored tabs.
- Added snapshot source, optional notes and history differences; explicit manual saves are retained even when identical to the latest automatic snapshot.
- Added domain/window views, project workspaces, selected/group/window capture, bulk workspace actions, rules, exclusions, suggestions, and privacy-safe templates.
- Added open-all workspace behavior and bidirectional workspace/collected-group drag, move and copy controls with safe invalidation of edited session layouts.
- Added Chinese/English global search with type/time filters, contextual actions, command palette, omnibox, Chrome commands, and cleanup recommendations.
- Added the configurable “collect current window” command and immediate trash undo for deleted groups, workspaces, snapshots, shortcuts, and saved-later items.
- Added exact partial-close accounting so undo restores only tabs that were actually closed.
- Added Free/Pro entitlement gates, offline ECDSA verification, Lemon Squeezy license exchange/refresh Worker, signed refund/subscription-expiry webhooks with minimal revocation state, checkout UI, expiry handling, and commercial release documentation.
- Added a unified settings surface, keyboard focus handling, responsive dialogs, system fonts, local favicons, schema migration, modular services, CI packaging, security checks, and 100/1,000/10,000 asset tests.
- Added a disposable-profile Chrome E2E runner covering onboarding, collect/undo, manual snapshots, workspace search, and full backup/import consistency without touching live browsing data.

Encrypted sync remains intentionally deferred until the product-plan validation and independent security-review gates are met.
