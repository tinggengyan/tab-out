# Implementation status

Updated: 2026-09-15

## Unified search — 2.1.0

Implemented free open-tab search in the dashboard and omnibox, exact tab identity across duplicate URLs/windows, configurable platform names and aliases, direct encoded website search, local platform settings with import/export, and full-backup integration. Advanced saved-asset search remains gated. No new extension permissions or runtime dependencies were introduced.

The full Node suite now passes 163 tests. Validation includes unit tests for parsing, invalid templates, normalization, concurrent settings edits, stale tabs, IME submission, omnibox handlers and backup compatibility. The isolated Chrome runner additionally covers Free search, settings persistence, alias commands, encoded queries, selected duplicate activation and full platform backup restoration. Native desktop automation was unavailable during development; the user subsequently confirmed acceptance including actual `to` usage. Version 2.1.0 packages this increment.

## Delivered in this repository

| Scope | Status | Main implementation |
|---|---|---|
| PRD-101–104 Trust | Implemented | Persistent operation log, 30-second undo for closes and deleted assets, trash, safe rendering, v2 migration, validated full backup, onboarding and first destructive-action previews |
| PRD-201–203 Recovery | Implemented for local release | Full multi-window session capture, source/notes, pinned/active/order/native-group restoration, debounced automatic and explicit manual snapshots, history differences, retention alarms, duplicate preview, three restore modes, partial-failure report and retry |
| PRD-301–304 Workspace | Implemented | Workspace CRUD/metadata/order/pinning, all/missing/selected open, bulk move/copy/delete, bidirectional workspace↔collected transfer with drag and keyboard controls, stale-session invalidation, rules with preview/exclusions, privacy-safe templates |
| PRD-401–403 Find & Automate | Implemented | Local Chinese/English search, command palette, omnibox, four configurable Chrome commands including safe current-window collection, duplicate/stale/overload cleanup preview and whitelist |
| M5 local Pro | Implemented | Upgrade UI, signed ECDSA offline entitlement, Free/Pro gates, expiry/grace/refund behavior, key generation and beta license issuance tools |
| M5 commerce service | Implemented, operator configuration required | License-key redemption/validation worker, provider instance binding, exact product/variant checks, daily refresh, signed webhook verification and privacy-minimal refund/subscription revocation markers |
| Portable data | Implemented | Version 2 complete backup plus legacy import compatibility; entitlement and migration safety backups are deliberately excluded |
| Privacy-safe metrics | Implemented locally | Bounded allowlisted event/error rings use only coarse counts and operation dimensions; URLs, titles, queries and raw error messages are never recorded or uploaded |
| Release packaging | Implemented | Manifest/package version 2.0.0, changelog, CI package job and store-ready ZIP generation |

## Deliberately not activated

- PRD-501–503 encrypted sync remains deferred exactly as required by the product plan: it starts only after Release 2–4 retention and paid-demand validation and an independent cryptographic design review.
- Production checkout and webhook credentials are environment/operator configuration, not repository secrets. Follow `COMMERCIAL_RELEASE.md`; the checked-in build intentionally leaves checkout and the public signing key blank.
- Anonymous funnel upload is not enabled. Coarse events remain local and the release sends no browsing content or telemetry to a server.

## Runtime verification

On 2026-09-12 the unpacked 2.0.0 extension was reloaded from this workspace in Google Chrome. The new-tab dashboard rendered real multi-domain data, the revised close/collect count hierarchy was visible, History opened, a manual snapshot with a note was stored and displayed alongside automatic history differences, and the Workspaces view rendered the collected-group bridge with keyboard-selectable entries. Destructive journeys were not run against the user's live browsing profile. On 2026-09-13 the repeatable isolated Chrome for Testing runner completed all six `DEVELOPMENT_PLAN.md` §9.3 journeys using local fixture pages. It additionally verified multi-window automatic snapshot restoration and persistent restore-job resume after page reload before injected partial failure/report/retry. Production provider exercises, reviewed legal/store metadata and real payment configuration remain operator release gates.

## Automated evidence

- The 117-test Node suite covers domain, storage, migration, backup, cleanup, search at 100/1,000/10,000 assets, entitlement, commerce redemption and signed revocation webhooks, local metrics, rules, session capture/restore, retry without reopening tabs, exact partial-close recovery, manual-snapshot semantics, retention, seven-day hourly storage growth, cross-container transfers, workspace transactions, localization parity, accessibility/permission/release guards, static UI contracts, and a 100-tab/10-window/20-native-group integration scenario. See `REQUIREMENTS_AUDIT.md` for the requirement-level evidence map.
- CI validates JavaScript syntax, Manifest JSON, forbidden remote/eval code, and produces an unpacked-extension ZIP artifact.
- The extension has no runtime npm dependency and no remote executable code.
