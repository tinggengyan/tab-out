# Product and development requirements audit

Updated: 2026-09-13

This document maps the executable release scope in `PRODUCT_PLAN.md` and
`DEVELOPMENT_PLAN.md` to authoritative implementation and verification evidence.
“Implemented” means the repository contains the behavior and a repeatable check;
it does not replace the clean-profile release journeys or operator configuration.

## Scope decision

- Releases 1–4 and local Pro (M0–M5) are the current executable product scope.
- Release 5 / M6 encrypted sync is intentionally **not activated**. The product
  plan makes its development conditional on retention, paid-demand validation,
  and an independent cryptographic review. The checked-in configuration cannot
  sell Sync, and all local features work without an account.
- IndexedDB in §4.1 of the development plan is a recommendation, not a product
  acceptance requirement. The implementation keeps the zero-dependency
  `chrome.storage.local` baseline and compensates with snapshot fingerprints,
  bounded automatic retention, age pruning, explicit capacity errors, and full
  export. The seven-day write/storage simulation verifies this chosen design.

## Requirements matrix

| Requirement | Status | Implementation evidence | Verification evidence |
|---|---|---|---|
| PRD-101 unified undo | Implemented | `operation-service.js`, persistent operation repository, close/collect callers and 30-second UI action | operation service/repository tests; exact partial-close test; UI contract |
| PRD-102 trash | Implemented | trash repository and Trash UI for collected groups, workspaces, snapshots, later items and shortcuts | trash repository tests; immediate asset-undo UI contract |
| PRD-103 safety/migration | Implemented | sanitizer, v2 schema, non-destructive migration backup, bounded validated portable backup/import preview | sanitizer, schema, migration and backup tests |
| PRD-104 onboarding/permissions | Implemented | three-step onboarding, local-data/permission explanation and first close/collect previews | UI contract plus runtime clean-install journey required below |
| PRD-201 complete session | Implemented | session domain and Chrome adapter capture windows, order, active/pinned state, native groups, source, device and notes | session/adapter tests; 100-tab integration scenario |
| PRD-202 automatic snapshots | Implemented | background structural-event listeners, debounce/serialization, baseline capture, alarms, manual save, history diff and three restore modes | snapshot service/repository tests; seven-day hourly simulation |
| PRD-203 conflict recovery | Implemented | restore planner, durable restore jobs, duplicate/unsupported preview, partial report, resume and group-only retry | planner/job/adapter tests, including retry without reopening tabs |
| PRD-301 workspaces | Implemented | repository and UI CRUD, metadata, pin/order, window/group/selection capture, open all/missing/selected | workspace tests and UI contract |
| PRD-302 drag/bulk | Implemented | workspace and collected bridge with move/copy drag controls, multi-select, delete/open and keyboard controls | collection-transfer/workspace transaction tests |
| PRD-303 rules | Implemented | domain/URL-pattern rule engine, suggestion/auto modes, exclusions, match preview | rule engine/repository tests |
| PRD-304 templates | Implemented | blank/development/research/morning templates, save/instantiate, opt-in private URLs | template tests |
| PRD-401 global search | Implemented | local bilingual index across open/workspace/collected/history/later assets, filters, command palette and actions | search unit and 100/1,000/10,000 scale tests |
| PRD-402 omnibox/commands | Implemented | omnibox plus open, search, snapshot and safe collect-window commands | manifest/background UI contract |
| PRD-403 cleanup | Implemented | duplicate/stale/overload analysis, preview, domain whitelist and pinned protection | cleanup analyzer tests |
| Free/Pro gates | Implemented | centralized entitlement service limits/capabilities; existing data remains readable/exportable after downgrade | entitlement tests |
| Commerce service | Implemented; configuration required | signed offline tokens, provider product/variant/instance validation, daily refresh, signed revocation webhook and minimal KV state | license Worker integration tests |
| Privacy/observability | Implemented locally | allowlisted bounded event/error rings, toggle and privacy documentation; no browsing-content upload | telemetry tests; remote-code/permission UI contract |
| Packaging/CI | Implemented | Node checks, test workflow, manifest/security scan and ZIP task | `npm test`, `npm run check`, `npm run package`, ZIP integrity check |
| PRD-501–503 encrypted sync | Conditional, deferred | UI states it is not enabled; checkout configuration is empty | guard test prevents the checked-in release from selling Sync |

## Cross-cutting acceptance evidence

- All English and Simplified Chinese runtime dictionary keys are kept in parity.
- Every modal declares an accessible dialog name, contains a focusable control,
  and participates in the global focus trap and focus-return behavior.
- Manifest permissions are limited to `tabs`, `storage`, `favicon`, and `alarms`;
  the only host permission is the license endpoint. `activeTab` is absent.
- There is no remotely loaded executable script, `eval`, or `new Function` in
  the extension release surface.
- The large-session fixture covers 100 tabs, 10 windows and 20 native groups.

## Remaining release gates outside repository-only verification

These do not authorize testing against a user's live browsing data:

1. All six §9.3 journeys now run through `npm run e2e:chrome` against a
   Chrome-for-Testing instance exposing CDP on port 9333. The suite also verifies
   a multi-window automatic snapshot, persistent restore-job resume after the
   extension page reloads, injected partial failure, report display, and retry.
   Cryptographic activation remains covered separately by unit/integration tests;
   the browser journey uses an isolated in-memory paid entitlement substitute.
2. Run a production-provider purchase, activation, invalid/disabled license,
   refund, subscription-expiry, offline grace and webhook-signature exercise.
3. Supply seller identity, reviewed legal text, real support contact, checkout
   privacy links, store copy and screenshots without private browsing content.
4. Publish to beta, complete target-user validation, and only then decide whether
   Release 5 encrypted sync satisfies its explicit entry gates.

## Isolated Chrome runner

Launch Chrome for Testing with a disposable profile, the unpacked extension, and
remote debugging enabled, then run the repository script:

```bash
"$CHROME_FOR_TESTING" --headless=new \
  --user-data-dir=/tmp/tabout-cft-e2e \
  --disable-extensions-except="$PWD/extension" \
  --load-extension="$PWD/extension" \
  --remote-debugging-port=9333 about:blank >/tmp/tabout-cft.log 2>&1 &
TAB_OUT_CDP_PID=$!
trap 'kill "$TAB_OUT_CDP_PID" 2>/dev/null || true' EXIT
npm run e2e:chrome
```

The runner clears only that extension's storage inside the disposable profile,
serves its own local test pages, and never operates on a normal Chrome profile.
It covers onboarding → collect → undo, automatic snapshot → close auxiliary
window → restore, workspace → search, backup → clear → import, Free limit →
simulated purchase → immediate unlock, and partial restore → report → retry.
