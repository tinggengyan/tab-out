# Changelog

## Unreleased — 2026-09-14

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
