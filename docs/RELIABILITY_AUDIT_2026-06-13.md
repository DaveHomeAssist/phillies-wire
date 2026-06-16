# Phillies Wire — Reliability & Correctness Audit

**Date:** 2026-06-13
**Scope:** Pipeline reliability/correctness (crawl → enrich → render → verify → factcheck/deliver) plus a hardened test harness.
**Deliverable:** This report + runnable harness in `test/reliability/` and `scripts/test-runner.mjs`.

**Update 2026-06-14:** The seven pinned reliability findings from this audit are fixed and now gate CI through `npm test`. The detailed findings below are retained as the original audit record.

---

## Summary

The pipeline is in good shape. Error handling, prompt-injection hardening, the `verify.mjs` publish gate, and the existing 11-file test suite are all solid, and the suite is **green** (11/11). This audit found one **silently-disabled correctness gate** and a handful of partial-data crash/leak paths worth closing.

Headline finding: **`factcheck.mjs` builds the recap box-score URL against the wrong API version (`/api/v1.1`), so the fetch 404s, the error is swallowed, and the check that exists to catch a wrong final score never runs.** A wrong recap score can publish unchecked. This is a one-line fix.

Counts at audit time: **5 P0**, **9 P1**, **5 P2**. Seven of these were pinned by reliability tests (see [Fix checklist](#fix-checklist)).

---

## Method & baseline

- Read every pipeline stage and all 11 existing test files; confirmed all imports/exports resolve and the CSP/template assertions hold.
- Re-ran the existing suite through the new runner: **11/11 pass** (`npm test`).
- Built a reliability suite of 25 cases (18 guards + 7 pins). The pinned findings now pass after the 2026-06-14 fixes.

> **Environment note.** Several live working files (`phillies-wire-schema.json`, the CSS bundles, the regenerated `*.json` outputs) were held open by an active process during the audit and had to be read via a reconstruction path. Findings reference real source lines; line numbers from the deep read are accurate to the version audited and may shift by a few lines as the files change.

---

## Findings

### P0 — fix first

| ID | Location | Problem | Fix |
|----|----------|---------|-----|
| **P0-FC-1** | `factcheck.mjs:386` (confirmed) | Box-score URL is `` `${MLB_API}.1/game/${gamePk}/boxscore` `` and `MLB_API` already ends in `/v1`, producing `/api/v1.1/game/.../boxscore` — an invalid endpoint (v1.1 serves `feed/live`, not `boxscore`). The fetch throws, `.catch(() => null)` swallows it, `reconcileRecap` never runs. The recap final-score / starter-line check is effectively **off**. | Use `` `${MLB_API}/game/${gamePk}/boxscore` ``. Add a dedicated `MLB_API_V11` constant if a v1.1 call is ever needed. |
| **P0-CRAWL-1** | `crawl.mjs` (~`buildLivePayload`, refs `game.teams.home.team`, `game.venue.name`) | Several `game.*` sub-objects are dereferenced unguarded. A partially-shaped game from MLB (postponed, missing `teams`/`venue`) throws and `fail()` exits 1 — the whole crawl dies instead of degrading. | Guard `game.teams` / `game.venue` (optional chaining + fixture fallback), or validate game shape in `pickActiveGame` before use. |
| **P0-CRAWL-2** | `crawl.mjs:~114` (`loadOverrides`, schema `readFileSync`) | `loadOverrides` parse and the `phillies-wire-schema.json` read sit outside any try/catch. A malformed override file or a missing schema crashes the entire crawl with no fallback. | Wrap both so a bad override degrades to "no overrides" rather than killing the run. |
| **P0-RENDER-1** | `render.mjs:737-744` (confirmed) | `populate()` resolves `{{token}}` as `value == null ? "" : String(value)`. An **object** value renders literal `"[object Object]"`; an **array** renders comma-soup; a missing nested key renders `""` silently. `verify.mjs` only rejects leftover `{{...}}`, never these. A blank/garbage hero field can ship. | Reject non-primitive token values (throw), and add a required-token sentinel that the verify gate rejects. |
| **P0-RENDER-2** | `render.mjs:92-154` (`buildSiteArtifact`) | The root→`site/` mirror does `rmSync(SITE_DIR, {recursive,force})` then rebuilds. A crash mid-copy (disk, transient lock) leaves `site/` half-populated **after** the previous good copy is already gone — a deploy then publishes a broken site. | Build into `site.tmp/` then atomic `rename` over `site/`, or restore the prior `site/` on failure. |

### P1 — fix soon

| ID | Location | Problem | Fix |
|----|----------|---------|-----|
| **P1-CRAWL-3** | `crawl.mjs` `deriveMode` vs `isFinalGame`; `pickActiveGame:490-512` (confirmed) | A postponed game carries `abstractGameState:"Final"` but `detailedState:"Postponed"`. `pickActiveGame` and `deriveMode` key off `abstractGameState`, so a postponed game is treated as a completed final → `buildHero` reads a recap that was never built → undefined headline or "TBD". | Exclude `codedGameState:"D"` / postponed/suspended states from the "final" classification. |
| **P1-CRAWL-4** | `crawl.mjs` standings/weather degradation; weather `Math.round` | Failed standings/weather fetches degrade silently: `crawl_state` stays `"ok"`, and `Math.round(weather.temperature_2m ?? fixture…)` can yield `NaN` into the ticker. A failed schedule fetch is indistinguishable from a real off-day. | Set `crawl_state:"degraded"` when any source returns null; coerce weather numerics with a numeric default. |
| **P1-RENDER-3** | `render.mjs:822-828` `escapeHtml` + archive callers | `escapeHtml(value)` calls `value.replace` directly. `renderArchiveEntry`/`renderArchivePage` pass `entry.headline`/`dek`/`hero_label` unguarded; a numeric or `undefined` legacy archive field throws and kills the render. | `String(value ?? "")` at the top of `escapeHtml` (mirror `escapeXml`). |
| **P1-RENDER-4** | `render.mjs` `upsertArchive` / `formatArchiveDate` | An archive entry missing `date` throws in `localeCompare` sort and `new Date(...)` formatting. | Skip/guard undated entries; give `formatArchiveDate` the same try/catch + empty guard as `formatIssueDateLong`. |
| **P1-RENDER-5** | `render.mjs` `main()` | No required-key contract before the expensive render/mirror. Partial `phillies-wire-data.json` (no `meta.date`) throws an unguarded TypeError mid-run. | Validate a required-key contract at the top of `main()` and fail fast with a clear message. |
| **P1-SCHED-1** | `shared/phillies-schedule.mjs` `buildCanonicalSchedulePayload` | No dedupe by `game_pk`; overlapping date-range fetches can double-count, inflating `summary.total_games`. No minimum-count sanity check (~162). | Dedupe by `game_pk`; recompute summary from the deduped games; assert a plausible season length. |
| **P1-SCHED-2** | `canonical-schedule.mjs:~51-67` fallback paths | `summary.total_games` is only recomputed in the fallback builder; cached/override paths trust `existing.summary`, which can disagree with `games.length`. | Always recompute `summary` from `payload.games`. |
| **P1-DELIVER-1** | `deliver.mjs:8-11` (confirmed) | `run.mjs` runs `deliver.mjs` **last**, after publish. Its top-level `main().catch(() => process.exit(1))` makes any SMTP failure (auth, refused, one bad recipient) fail the whole pipeline run even though the site already shipped. | Treat delivery as non-fatal (log + exit 0), or move delivery before publish. |
| **P1-FC-2** | `factcheck.mjs` `runSourceChecks` / `fetchJSON:~802` | Source checks have no per-request timeout; a hung MLB call stalls the daily run. A successful-but-stale API response can also hard-block publish (lands in `errors`). | Add `AbortController` timeouts; route fetch anomalies to `unverified` (non-blocking), reserve `errors` for confirmed disagreements. |
| **P1-FC-3** | `factcheck.mjs:120` vs `144` | `unverified` findings (e.g. "API unreachable", "IL player missing") never reach the alert threshold, so real gaps go unnoticed. | Surface `unverified` count in the daily alert or a separate digest. |

### P2 — opportunistic

| ID | Location | Problem | Fix |
|----|----------|---------|-----|
| **P2-SCHED-3** | `canonical-schedule.mjs:~157/383/433` | Hardcoded `T23:05:00Z` and `-04:00` (EDT year-round); calendar `DTSTART` uses UTC clock digits under `TZID=America/New_York`. April/Sept and DST edges drift an hour. | Derive the offset from the actual date; format calendar times in the named TZ. |
| **P2-FC-4** | `factcheck.mjs:~256` | GB leader selection via `Number(r.gb) === 0` treats the "—" leader as `NaN`; unsorted rows can pick the wrong leader and emit a false blocking GB error. | Pick the leader by max wins / min losses, not the gb string. |
| **P2-RENDER-6** | `render.mjs:730-735` | Triple-brace `{{{...}}}` emits raw HTML; only `meta.json_ld` is pre-escaped. The no-injection invariant relies on author discipline. | Restrict `{{{ }}}` to an allowlist of known-safe paths; throw otherwise. |
| **P2-CRAWL-5** | `crawl/format.mjs` `formatGameTime`; live hero score | `new Date(undefined)` → "Invalid Date" string; missing live score defaults to `0` ("PHI 0, ATL 0"). | Null-guard before formatting; prefer linescore totals or a "—" sentinel. |
| **P2-DELIVER-2** | `deliver.mjs:70` | No retry and no per-recipient handling; one bad address fails the whole batch. (Secrets are correctly redacted — good.) | Send per-recipient or catch+continue; optional one-shot retry. |

---

## Test harness

Added without touching any pipeline source:

- **`scripts/test-runner.mjs`** — unified runner. Replaces the brittle `node a && node b && …` chain (which aborts on the first failure and hides the rest). Runs each test file in its own process, prints a summary table + per-failure detail, exits non-zero if any fail. Takes directory args so suites stay separate.
- **`test/reliability/`** — 5 new test files (25 cases) plus a shared `_harness.mjs` and a `README.md`. **Guards** lock in behavior that already works; **pins** (`PIN P0`/`PIN P1`) assert the correct behavior for the open bugs above and fail until fixed.

### Commands

```bash
npm test              # lint + existing + reliability suites — gates CI
npm run test:reliability   # reliability suite only
npm run test:all      # alias for npm test
npm run test:legacy   # the original && chain, preserved
```

### Verified results

| Command | Result |
|---------|--------|
| `npm test` | 16 files, **16 passed**, exit 0 |
| `npm run test:reliability` | 5 files, **5 passed**, exit 0 |
| `npm run test:all` | 16 files, **16 passed**, exit 0 |

The default `npm test` now includes the reliability suite so these regressions block CI and publish.

---

## Fix checklist

Each pin turns green when its bug is fixed. Recommended order:

1. **DONE 2026-06-14:** **P0-FC-1** `factcheck.mjs:386` — drop the `.1`. → green: `factcheck-boxscore-url`
2. **DONE 2026-06-14:** **P0-RENDER-1** harden `populate()` token resolution. → green: `render-token-resolution`
3. **DONE 2026-06-14:** **P1-CRAWL-3** postponed ≠ final in `pickActiveGame`/`deriveMode`. → green: `crawl-resilience`
4. **DONE 2026-06-14:** **P1-SCHED-1** dedupe `game_pk` + recompute summary. → green: `schedule-integrity`
5. **DONE 2026-06-14:** **P1-DELIVER-1** make delivery failure non-fatal. → green: `deliver-failure-isolation`
6. P0-CRAWL-1/2, P0-RENDER-2 — guard partial-game derefs, wrap override/schema reads, atomic `site/` mirror. (No pin yet — add once the approach is chosen.)

The green pins now run in the default suite through `npm test`.
