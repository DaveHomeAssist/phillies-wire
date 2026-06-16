# GOAL — Phillies Wire to a reliable state

**Status:** 🟡 AMBER · **Opened:** 2026-06-16 · **Source of truth:** repo source + `npm test` exit code

## Outcome
Phillies Wire publishes a correct daily issue unattended and fails loud, not silent. Bad scores, postponed games, dead APIs, or one SMTP error degrade gracefully or block publish — never ship garbage, never crash the run over a non-critical stage.

## Done when
1. `npm test` (existing + reliability suites) runs green and gates publish.
2. All 19 audit findings (5 P0 · 9 P1 · 5 P2) map to a passing pin/guard.
3. Partial upstream data never emits `NaN` / `[object Object]` / "Invalid Date".
4. Wrong recap score is caught by the box-score gate (live, not swallowed).
5. Delivery failures isolated — site ships even if email fails.
6. No host file lock blocks the daily run or the test gate.

## State (2026-06-16)
All 19 findings fixed and source-verified; Codex closed the unpinned P0s too. **Not execution-verified** — core `.mjs` files are locked by an active host process (`errno -35`, git "Resource deadlock avoided"), blocking `npm test`.

## Gaps
- **G0 (blocker):** clear host lock; `npm test` + `git status` run clean.
- **G1:** execution-verify suites green; record exit codes here.
- **G2:** seal residuals — `canonical-schedule.mjs:159` `T23:05:00Z` default time; `crawl/format.mjs:122` unguarded `formatGameTime`.
- **G3:** add pins for unpinned fixes (P0-CRAWL-1/2, P0-RENDER-2) so regressions can't reopen silently.
- **G4:** daily health signal (crawl schema gaps, leftover `{{tokens}}`, delivery check).

## Milestones
M1 Unblocked & green (G0+G1) → GREEN baseline · M2 Edges sealed (G2+G3) · M3 Self-monitoring (G4)
