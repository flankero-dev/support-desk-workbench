# Portfolio audit — 18 October 2026

This branch addresses S01–S21 against the original main commit `82040360a91730f2f82436cc617fdc6e099e7f71`. It is a review checkpoint, not a deployed release or a claim of defect-free software. See the draft PR and its latest Actions checks for the exact tested head.

## Reproduce

Use Node 24. Run `npm ci`, `npm test`, `npm run format:check`, `npm run lint`, `npm run build`, `npx playwright install --with-deps chromium firefox webkit`, then `npm run test:browser`, `npm run test:audit`, `npm run test:a11y`. Set `AUDIT_BROWSER=firefox` or `AUDIT_BROWSER=webkit` to repeat browser suites. On PowerShell set `$env:AUDIT_BROWSER="firefox"` first. CI runs Chromium on actual Windows and Linux, plus Firefox/WebKit on Linux. `.gitattributes` keeps checked-out text LF on Windows.

The tests generate synthetic screenshots and JSON under `docs/audit/`; Actions uploads them as artifacts. Baseline failures, before/after screenshots, exact runtimes and the Russian cross-project register are in the accompanying QA handoff. Fuzz uses seed `0x20261018`, 400 cases and bounded reduction on failure; it is not exhaustive fuzzing.

## Traceability

Status refers to the scoped finding, not universal coverage. See [decisions](../decisions.md) for compatibility and intentional limits.

| Finding                                                         | Disposition          | Regression entry point                                                                                                         |
| --------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| S01 — persistence truthfulness (P2)                             | confirmed-fixed      | [audit.browser.mjs](../../tests/audit.browser.mjs); [browser-smoke.mjs](../../tests/browser-smoke.mjs)                         |
| S02 — damaged saved workspace recovery (P2 UX-safety candidate) | confirmed-fixed      | [audit.browser.mjs](../../tests/audit.browser.mjs); [browser-smoke.mjs](../../tests/browser-smoke.mjs)                         |
| S03 — imported dates (P2)                                       | confirmed-fixed      | [audit-domain.test.mjs](../../tests/audit-domain.test.mjs); [audit-boundaries.test.mjs](../../tests/audit-boundaries.test.mjs) |
| S04 — IDs, names and invisible input (P2/P3)                    | confirmed-fixed      | [audit-domain.test.mjs](../../tests/audit-domain.test.mjs); [audit-boundaries.test.mjs](../../tests/audit-boundaries.test.mjs) |
| S05 — hidden selection after edit (P2 candidate)                | confirmed-fixed      | [audit.browser.mjs](../../tests/audit.browser.mjs); [browser-smoke.mjs](../../tests/browser-smoke.mjs)                         |
| S06 — destructive server snapshot operations (P2 UX-safety)     | confirmed-fixed      | [audit.browser.mjs](../../tests/audit.browser.mjs); [audit-domain.test.mjs](../../tests/audit-domain.test.mjs)                 |
| S07 — stale snapshot after failed GET (P2 candidate)            | confirmed-fixed      | [audit.browser.mjs](../../tests/audit.browser.mjs); [browser-smoke.mjs](../../tests/browser-smoke.mjs)                         |
| S08 — large history performance (P2–P3)                         | confirmed-fixed      | [audit.browser.mjs](../../tests/audit.browser.mjs); [browser-smoke.mjs](../../tests/browser-smoke.mjs)                         |
| S09 — long generated ID layout (P2–P3)                          | optional enhancement | [audit.browser.mjs](../../tests/audit.browser.mjs); [browser-smoke.mjs](../../tests/browser-smoke.mjs)                         |
| S10 — restore draft wiped (P3)                                  | confirmed-fixed      | [audit.browser.mjs](../../tests/audit.browser.mjs); [browser-smoke.mjs](../../tests/browser-smoke.mjs)                         |
| S11 — unsent note draft on close (P3/intent check)              | confirmed-fixed      | [audit.browser.mjs](../../tests/audit.browser.mjs); [browser-smoke.mjs](../../tests/browser-smoke.mjs)                         |
| S12 — saved views storage unavailable (P3)                      | confirmed-fixed      | [audit.browser.mjs](../../tests/audit.browser.mjs); [browser-smoke.mjs](../../tests/browser-smoke.mjs)                         |
| S13 — accessibility/focus/state (P3)                            | confirmed-fixed      | [audit.browser.mjs](../../tests/audit.browser.mjs); [accessibility.browser.mjs](../../tests/accessibility.browser.mjs)         |
| S14 — URL/reload and years (P3)                                 | confirmed-fixed      | [audit.browser.mjs](../../tests/audit.browser.mjs); [audit-boundaries.test.mjs](../../tests/audit-boundaries.test.mjs)         |
| S15 — Windows local server assets (P2 on Windows)               | confirmed-fixed      | [audit-boundaries.test.mjs](../../tests/audit-boundaries.test.mjs); [audit-server.test.mjs](../../tests/audit-server.test.mjs) |
| S16 — bad percent escapes (P3)                                  | confirmed-fixed      | [audit-server.test.mjs](../../tests/audit-server.test.mjs)                                                                     |
| S17 — symlink containment (P3 conditional security)             | confirmed-fixed      | [audit-server.test.mjs](../../tests/audit-server.test.mjs)                                                                     |
| S18 — malformed UTF-8 HTTP PUT (P3)                             | confirmed-fixed      | [audit-server.test.mjs](../../tests/audit-server.test.mjs); [server-api.test.mjs](../../tests/server-api.test.mjs)             |
| S19 — SQL version-1 drift (P3 conditional)                      | confirmed-fixed      | [audit-server.test.mjs](../../tests/audit-server.test.mjs); [server-api.test.mjs](../../tests/server-api.test.mjs)             |
| S20 — lone UTF-16 surrogate (P3 rare)                           | confirmed-fixed      | [audit-domain.test.mjs](../../tests/audit-domain.test.mjs); [audit-boundaries.test.mjs](../../tests/audit-boundaries.test.mjs) |
| S21 — regression and role journeys (always)                     | not reproduced       | [tickets.test.mjs](../../tests/tickets.test.mjs); [create-request.test.mjs](../../tests/create-request.test.mjs)               |

## Performance and accessibility evidence

Production-build Chromium 153.0.8010.0, Linux, Node 24.19.0; seven fresh-context samples per condition, including CDP 4× CPU throttling. Timing includes driver interaction and two animation frames. p95 is nearest-rank and therefore the maximum of seven samples: exploratory, not a stable service-level estimate.

For a 30,000-entry history, baseline → changed median: **4,061 → 216 ms** (normal CPU), **20,692 → 596 ms** (4× CPU). Rendered entries: **30,000 → 50**, with complete history retained in JSON/SQLite. p95: 4,118 → 296 ms and 24,081 → 870 ms respectively.

Axe scans four key states, keyboard journeys and nine viewport widths supplement existing review tests. CSS `zoom:2/4` captures are observations, **not native browser-zoom certification**; CSS zoom does not adjust media-query viewport like native zoom and can produce horizontal overflow. The 320/640 CSS-pixel viewport checks provide reflow evidence. Axe `incomplete` contrast items remain human-review tasks; zero automated violations is not WCAG certification.

## Limits and release gate

- No real NVDA/VoiceOver/TalkBack, iOS Safari or physical Android test was available. Run those manually before making an accessibility certification claim.
- Native OS clipboard integration is exercised in Chromium; Firefox/WebKit use an explicitly labelled clipboard double plus failure feedback. Firefox mobile coverage is a narrow touch viewport, not unsupported `isMobile` emulation.
- Live demo smoke covers the already published baseline only. No merge or production deployment is authorized by this audit.
- localStorage has no atomic cross-process compare-and-swap; synchronous pre-write comparison closes delayed-event stale writes but cannot promise full collaborative consistency. Export unsaved changes; SQLite snapshots have transactional ETags.
- Dates without an explicit timezone, invalid calendar dates and unsafe identifiers that old code accepted now fail validation. Raw recovery prevents automatic overwrite; no guessed timezone or silent renaming migration is performed.
- No database schema change is introduced by this audit. Back up the SQLite file and JSON before upgrade or rollback; restoring older app code also restores its weaker validation/guards.
- Additional review caught order-sensitive snapshot diff (N03), Windows line endings (N04), engine-specific test assumptions (N05), and a WebKit native-select overflow with a 200-character assignee (N06). Each has a regression or unchanged geometry assertion; the latter is checked in CI.
