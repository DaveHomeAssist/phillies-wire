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

## Audit map

Every finding from `docs/RELIABILITY_AUDIT_2026-06-13.md` has a passing guard
or pin in this suite. `P1-FC-2/3` are grouped because the timeout/unverified
classification and alert-surfacing behavior are one source-check contract.

| Audit id | Guard file | Regression guarded |
|-----|-----|-----|
| P0-FC-1 | `factcheck-boxscore-url` | Recap box-score fetch uses `/api/v1/game/.../boxscore`, not invalid `/api/v1.1`. |
| P0-CRAWL-1 | `crawl-resilience` | Partial MLB game shapes normalize to safe Phillies/opponent defaults. |
| P0-CRAWL-2 | `crawl-resilience` | Malformed overrides and missing schema fall back instead of killing crawl. |
| P0-RENDER-1 | `render-token-resolution` | Object/array tokens fail instead of rendering `[object Object]` or comma soup. |
| P0-RENDER-2 | `render-token-resolution` | `site/` artifact is staged before replacement. |
| P1-CRAWL-3 | `crawl-resilience` | Postponed games are not selected as completed finals. |
| P1-CRAWL-4 | `crawl-resilience` | Missing source responses mark crawl degraded; weather numerics stay finite. |
| P1-RENDER-3 | `render-token-resolution` | Archive escaping accepts null/numeric legacy fields. |
| P1-RENDER-4 | `render-token-resolution` | Undated archive entries are skipped safely. |
| P1-RENDER-5 | `render-token-resolution` | Render input fails fast on missing required keys. |
| P1-SCHED-1 | `schedule-integrity` | Duplicate `game_pk` rows do not inflate schedule summary. |
| P1-SCHED-2 | `schedule-integrity` | Fallback/cached schedule paths recompute summary from games. |
| P1-DELIVER-1 | `deliver-failure-isolation` | SMTP failure after publish logs but does not fail the pipeline. |
| P1-FC-2/3 | `factcheck-boxscore-url` | Source checks time out, classify fetch gaps as unverified, and surface alert status. |
| P2-SCHED-3 | `schedule-integrity` | Fallback game times use date-aware ET offsets and calendar `DTSTART` wall-clock output. |
| P2-FC-4 | `factcheck-boxscore-url` | Standings leader is selected by record, not fragile `gb` text. |
| P2-RENDER-6 | `render-token-resolution` | Raw triple-brace tokens are allowlisted. |
| P2-CRAWL-5 | `crawl-resilience` | Invalid times and missing live scores render safe sentinels. |
| P2-DELIVER-2 | `deliver-failure-isolation` | Per-recipient delivery isolates one bad address and retries transient failures. |
| G4 | `health-signal` | Post-deploy health fails on schema gaps, unresolved tokens, and failed delivery status. |

See `docs/RELIABILITY_AUDIT_2026-06-13.md` for the full findings and fixes.
