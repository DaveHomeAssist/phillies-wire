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

## State (2026-06-18)
All 19 findings are fixed and execution verified. Delivery now emits `delivery-status.json` from `deliver.mjs` with `schema_version`, `generated_at`, `state`, `required`, `delivered`, and numeric `failed`; the local health check can validate the produced `site/` artifact through `PHILLIES_WIRE_HEALTH_DIR=site`.

## Gaps
- **G0:** cleared; reachable repo accepts source edits and commits.
- **G1:** cleared; `npm test` exits 0 with the legacy plus reliability suites.
- **G2:** cleared by reliability guards for schedule fallback and crawl time formatting.
- **G3:** cleared; reliability pins cover the previously unpinned P0 fixes.
- **G4:** cleared; `delivery-status.json` producer and health signal are pinned.

## Verification (2026-06-18)
- `grep -n "delivery-status.json" deliver.mjs` returns the direct `writeFileSync("./delivery-status.json", text, "utf8");` producer line.
- Stubbed local delivery run writes `delivery-status.json` and `site/delivery-status.json` with `state: "sent"` and numeric `failed: 0`.
- `PHILLIES_WIRE_HEALTH_DIR=site PHILLIES_WIRE_MAX_AGE_MIN=10000 node scripts/health-check.mjs` logs `Delivery sent.`
- `npm test` exits 0 with the producer pin included in the reliability suite.

## Milestones
M1 Unblocked & green (G0+G1) → GREEN baseline · M2 Edges sealed (G2+G3) · M3 Self-monitoring (G4)
