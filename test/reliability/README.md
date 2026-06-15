# Reliability suite

Reliability- and correctness-focused tests that sit alongside the existing
`test/*.test.mjs` suite. They run through the unified runner
(`scripts/test-runner.mjs`), which executes every file in its own process and
prints a summary table instead of aborting on the first failure like the old
`&&` chain did.

## Commands

```bash
npm test              # lint + existing + reliability suites (gates CI)
npm run test:reliability   # this suite only
npm run test:all      # alias for npm test
npm run test:legacy   # the original && chain, preserved as a fallback
```

## Guards vs. Pins

Each file mixes two kinds of cases:

- **Guards** assert behavior that already works. They lock it in so a future
  change can't silently regress it. Guards are expected to PASS.
- **Pins** (prefixed `PIN P0`/`PIN P1`) assert the corrected behavior for bugs
  found by the reliability audit. The prefix preserves the original severity
  and audit provenance, but these cases are now expected to PASS.

The suite is part of the default `npm test` gate, so these regressions block CI
and publish.

## Regression pins

| Pin | Stage | Regression guarded |
|-----|-------|-----|
| factcheck-boxscore-url (×2) | factcheck | boxscore fetch must use `/api/v1/game/...`, not invalid `/api/v1.1/game/...`. **P0** |
| render-token-resolution (×2) | render | object/array template tokens must fail instead of rendering `[object Object]` or comma-joined output. **P0/P1** |
| crawl-resilience (×1) | crawl | postponed games must not be selected as completed finals. **P1** |
| schedule-integrity (×1) | canonical-schedule | duplicate `game_pk` from overlapping fetches must not inflate `summary.total_games`. **P1** |
| deliver-failure-isolation (×1) | deliver | SMTP failure after publish must be logged without failing the pipeline. **P1** |

See `docs/RELIABILITY_AUDIT_2026-06-13.md` for the full findings and fixes.
