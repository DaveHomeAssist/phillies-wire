# HANDOFF.md — Phillies Wire

**Last updated:** 2026-10-09 (offseason mode on)
**Status:** Production, v1.6.1. Publishing on cron (daily + game-window), latest issue current. `verify.mjs` gates every publish. v1.6.1 adds the Liberty Bell / broadsheet enhancement layer, road-game correctness fixes (Issue 006), and a dedicated inline-styled HTML email (Issue 007).
**Branch:** `main`
**Canonical source of truth:** [`CLAUDE.md`](CLAUDE.md) — read it first. This file is the orientation companion; `CLAUDE.md` holds the live issue tracker, key decisions, and Definition-of-Done status.

---

## Current state

Phillies Wire started as a daily static newsletter and has grown into a small Phillies content surface. Every cron run regenerates:

1. The **daily newsletter** (latest + dated issue + archive)
2. A per-issue **`data.json`** consumer contract (schema `1.3.0`)
3. A consumer **`latest.json`** feed (schema `latest-1.0.0`)
4. The canonical **season schedule** at `data/phillies-2026.json` (schema `1.0.0`)
5. A season **ICS calendar** at `calendar/phillies-2026-all.ics`
6. An iframe-safe **ticker embed** at `/embed/ticker.html`

On top of that, several static surfaces ship from the repo:

- **Dashboard** — `/dashboard/` (real IL/lineup/player-focus panels from per-issue `data.json`)
- **Innings timeline** — `/dashboard/innings/` (per-play event arrays from MLB `feed/live`)
- **Preferences** — `/dashboard/preferences/` (local theme, reduced-data, innings filter, streak alerts, export/import)
- **Accuracy scorecard** — `/dashboard/accuracy/` (daily fact-check verdicts, schema `accuracy-1.0.0`)
- **Schedule tracker** — `/schedule/` (merged from the old Ballparks Quest schedule, now repo-owned)

**Live:** https://davehomeassist.github.io/phillies-wire/

## Pipeline

```text
run.mjs -> crawl.mjs -> edition sync -> enrich.mjs -> render.mjs -> factcheck.mjs --export-accuracy -> verify.mjs -> deliver.mjs?
```

| File | Role |
|---|---|
| `run.mjs` | Orchestrator, child-process spawn, edition number sync; runs `factcheck.mjs --export-accuracy` after render and before the verify gate |
| `crawl.mjs` | MLB + weather + fixture merge → data JSON; freshness gates; per-play `feed/live` pull; injury fallback via transactions feed |
| `enrich.mjs` | Claude editorial pass (pull quote + preview narrative), retries + timeout + structured fallback |
| `render.mjs` | Template engine + latest/issue/archive/site output + per-issue `data.json` + static-asset copy (`STATIC_ASSET_DIRS`) |
| `verify.mjs` | Hard pre-publish gate; runs `runFactcheck({mode:"pre-publish"})`; asserts every consumer contract |
| `deliver.mjs` | Optional SMTP delivery (nodemailer) |
| `factcheck.mjs` | Pre-publish deterministic gate + daily source-verified fact-check; exports the accuracy scorecard |
| `live-feed.js` | Browser-side live score polling |
| `config.mjs` | Centralized constants (TEAM_ID, VENUE, API base, schema versions, timeouts) |

## Fact-check system

Wired into the pipeline (see [`docs/FACTCHECK.md`](docs/FACTCHECK.md)):

- **Pre-publish gate:** `verify.mjs` imports `runFactcheck` and blocks publish on errors / pipeline issues.
- **Accuracy export:** `run.mjs` runs `factcheck.mjs --export-accuracy` after render (so it inspects this run's HTML) and before verify (which gates on the report); it feeds `/dashboard/accuracy/`. A claim is marked accurate only when a source or deterministic check compared it on that run; uncovered claims are listed as unverifiable.
- Deterministic checks run offline in-process; source-verified checks (vs MLB Stats API) run on the daily scheduled run.
- `factcheck-whitelist.json` suppresses intentional editorial accepts.

> Note: `docs/FACTCHECK.md`'s "Production-ready checklist" GAP items for `verify.mjs` / `run.mjs` / `.gitignore` are now **closed**. The only outstanding external dependency is the `NOTION_API_KEY` GitHub secret + email recipients (verify in repo settings).

## Template engine syntax

`render.mjs` implements a minimal Handlebars-like engine. Supported syntax:

| Syntax | Meaning |
|---|---|
| `{{meta.date}}` | Dot-path interpolation. Values are HTML-escaped. |
| `{{{meta.json_ld}}}` | Triple-brace. Raw HTML output, no escaping. Use only for trusted computed markup (JSON-LD, preformatted snippets). |
| `{{#each items}}...{{/each}}` | Iterate an array. Inside the block, `{{this.field}}` refers to the current item and `{{root.path}}` still resolves from the top. |
| `{{#if flag}}...{{/if}}` | Conditional block. Rendered if the path resolves to a truthy value. |
| Nested blocks | `{{#each ...}}` and `{{#if ...}}` can be nested. |

### Gotchas

- The engine walks `scope` first, then `root` — `{{this.field}}` inside `{{#each}}` is scoped to the current item.
- `{{undefined.path}}` resolves to an empty string, not an error. Use `{{#if}}` for guarded sections.
- Unresolved `{{tokens}}` in the final output trigger `assertNoUnresolvedTokens` in `verify.mjs` and break the pipeline on purpose.

## What to run locally

```bash
git pull                                 # main moves on every cron run — pull before working
npm ci
npm test                                 # node scripts/lint.mjs && node scripts/test-runner.mjs test test/reliability
ANTHROPIC_API_KEY=sk-... node run.mjs    # full pipeline end-to-end
```

Without `ANTHROPIC_API_KEY`, enrich falls back to a structured message and the pipeline still publishes.

> The repo publishes from cron many times a day, committing snapshots back to `main`. A local clone goes stale fast — always `git pull` before starting work.

## Environment variables

| Variable | Stage | Required? | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | enrich | optional | Editorial copy via Claude. Omit → structured fallback. |
| `ENRICH_MODEL` | enrich | optional | Override model name |
| `ENRICH_MAX_TOKENS` | enrich | optional | Override max tokens |
| `ENRICH_STRICT` | enrich | optional | `"true"` → fail pipeline on enrich error instead of falling back |
| `DELIVERY_RECIPIENTS` | deliver | optional | Comma-separated emails. Omit → skip delivery. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | deliver | if delivering | SMTP transport |
| `NOTION_API_KEY` | factcheck | for Notion | Integration token for the fact-check report DB |
| `FACTCHECK_RECIPIENTS` | factcheck | for email | Falls back to `DELIVERY_RECIPIENTS` |
| `FACTCHECK_DRY_RUN` | factcheck | optional | `"1"` → skip Notion + email side effects |

## CI workflow

`.github/workflows/publish.yml`. Triggered by:

- Daily cron at 13:00 UTC (~9 AM ET)
- Game-window cron every 15 minutes (afternoon/evening windows)
- Manual `workflow_dispatch` (mode selectable)

Job shape: `npm ci` → `npm test` → `node run.mjs` (crawl→enrich→render→factcheck export→verify→deliver) → deploy Pages → **then** persist archive snapshot commit (deploy-before-persist push-race fix, commit `ab0ad55`; persist step retries with `pull --rebase --autostash`).

## Open follow-ups

See the **Issue Tracker** in [`CLAUDE.md`](CLAUDE.md) for the authoritative list. Currently open:

- **004 (P3)** — `statsapi.mlb.com/.../teams/143/injuries` returns 404. Handled gracefully via the transactions-feed fallback; a stable alternate source is still wanted.
- **003 (P3)** — L5/L6 streak reviewer disagreement retained as an audit-trail flag (resolved in practice by the streak-strip viz).
- Critical-CSS inlining for faster first paint (Google Fonts now self-hosted via the v1.6.1 enhancement layer).
- Playwright end-to-end smoke test for the live-feed pipeline.

## Notion references

- LLM Conversation Log: https://www.notion.so/331255fc8f44814483d4d11fd2703f68
- Pipeline Spec page: https://www.notion.so/331255fc8f44818ea2baf23a71c91645
- Code Dashboard LIVE: https://www.notion.so/331255fc8f44819d9d88c8ef21105082

## Offseason runbook

**Status (2026-10-09): OFFSEASON MODE IS ON.** The 2026 regular season ended Sep 27 (final 88-74).

### What offseason mode does

Switch: `SEASON_PHASE` in `config.mjs` (`DEFAULT_SEASON_PHASE = "offseason"`; the `SEASON_PHASE` env var overrides it). `COMPLETED_SEASON = 2026` picks the season whose final record is shown.

- **Workflow (`publish.yml`):** the daily `0 13 * * *` cron and the `*/15 16-23,0-6 * * *` game-window cron are removed. A single weekly cron `0 14 * * 1` (Mondays 14:00 UTC) runs the pipeline in `daily` mode. `workflow_dispatch` is unchanged.
- **`run.mjs`:** stages are crawl → render → accuracy export → verify. **No `enrich.mjs` (no Claude tokens) and no `deliver.mjs` (no email)** in any ISSUE_MODE. `delivery-status.json` is written as `skipped / required:false`, and `delivery_attempted=false` goes to `GITHUB_OUTPUT`. The "Fail on required delivery failure" step only runs when `delivery_attempted == 'true'`.
- **`crawl.mjs` → `runOffseasonCrawl`:** no game, boxscore, feed/live, weather, or recent-finals fetches. It only pulls the daily MLB bundle (schedule, roster, and a 14-day transactions window for hot-stove items). The final record comes from `data/phillies-2026.json` (`crawl/offseason.mjs` → `computeFinalRecord`, which uses the last final's MLB `league_record` and falls back to counting finals), **never** from the fixture's 0-0.
- **Page:** hero mode `offseason` shows "2026 season complete" with Final Record / Last Game / Next Season cards. The masthead reads "88-74 · 2026 Final". The ticker shows the final record plus hot-stove transactions. Nav hides Dashboard / Schedule / Inning by inning and shows "2026 Results" (→ `/schedule/`). The next-game panels are hidden, `live-feed.js` is not loaded (and it also bails if `data-page-mode="offseason"`), and the subscribe copy pitches weekly hot-stove updates.
- **`verify.mjs`:** for `offseason` pages it requires *no* live-feed module, no game-day nav or next-game panel, and a non-zero final record.

### Flip back to in-season (before spring training 2027, ~mid-Feb)

1. `config.mjs`: set `DEFAULT_SEASON_PHASE = "regular"`. Bump `COMPLETED_SEASON` to 2027 at the end of next season.
2. `publish.yml` `on.schedule`: replace `0 14 * * 1` with the two in-season crons (they're kept as comments in the file):
   `- cron: "0 13 * * *"` and `- cron: "*/15 16-23,0-6 * * *"`. In "Determine issue mode", the `0 14 * * 1` clause can stay or be removed.
3. **Roll the season files:** the pipeline hardcodes `data/phillies-2026.json` and `calendar/phillies-2026-all.ics` in `render.mjs`, `canonical-schedule.mjs`, `verify.mjs`, the persist step in `publish.yml`, and the tests. Search for `phillies-2026` and move everything to 2027 once MLB publishes the schedule. `crawl/api/mlb.mjs fetchStandings` uses the current calendar year, which is right for 2027.
4. **Email:** the Gmail SMTP login has been rejected since late September (secret `SMTP_PASSWORD`, which `run.mjs` reads as `SMTP_PASS`). Generate a new Gmail app password, update the repo secret, then send a scoped test with `workflow_dispatch` (issue_mode=daily, test_recipients=<your address>) before relying on the daily send.
5. Confirm `ANTHROPIC_API_KEY` is still valid (enrich falls back silently if it isn't).
6. Run `npm test`, then dispatch once with `issue_mode=live` and check that the page shows the next game, the Inning by inning nav, and loads `live-feed.js`.

Optional during the offseason: put `overrides/YYYY-MM-DD.json` files in place for one-off editorial notes (e.g. a big signing) before a weekly or manual run.
