# HANDOFF.md — Phillies Wire

**Last updated:** 2026-04-14
**Status:** Production. 33 tests passing, 0 vulnerabilities, publishing on cron.
**Branch:** `main`

---

## Current state

Phillies Wire is a daily static newsletter that:

1. Crawls MLB Stats API + Open-Meteo every day and every 15 minutes during the game window
2. Enriches editorial copy via Claude (pull quote + preview narrative) with a structured fallback
3. Renders into a static HTML template stamped with a custom `{{...}}` engine
4. Verifies the output contract (hero shape, lineup shape, required files)
5. Deploys to GitHub Pages and (optionally) emails subscribers

The original HANDOFF claimed `crawl.mjs`, `enrich.mjs`, `render.mjs` were "not built". That's obsolete — all five pipeline stages are complete and shipping.

## Pipeline files

| File | Lines | Role |
|---|---|---|
| `run.mjs` | ~150 | Orchestrator, child-process spawn, edition number sync |
| `crawl.mjs` | ~1400 | MLB + weather + fixture merge → `phillies-wire-data.json` |
| `enrich.mjs` | ~400 | Claude editorial pass (pull quote + preview narrative), retries + fallback |
| `render.mjs` | ~840 | Template engine + latest/issue/archive/site output |
| `verify.mjs` | ~260 | Output contract assertions |
| `deliver.mjs` | ~100 | Optional SMTP delivery (nodemailer) |
| `live-feed.js` | ~280 | Browser-side live score polling |
| `config.mjs` | ~30 | Centralized constants (TEAM_ID, VENUE, API base, schema version, timeouts) |

## Template engine syntax

`render.mjs` implements a minimal Handlebars-like engine. Supported syntax:

| Syntax | Meaning |
|---|---|
| `{{meta.date}}` | Dot-path interpolation. Values are HTML-escaped. |
| `{{{meta.json_ld}}}` | Triple-brace. Raw HTML output, no escaping. Use only for trusted computed markup (JSON-LD, preformatted snippets). |
| `{{#each items}}...{{/each}}` | Iterate an array. Inside the block, `{{this.field}}` refers to the current item and `{{root.path}}` still resolves from the top. |
| `{{#if flag}}...{{/if}}` | Conditional block. Rendered if the path resolves to a truthy value. |
| Nested blocks | `{{#each ...}}` and `{{#if ...}}` can be nested. Tested in `test/render.test.mjs`. |

### Gotchas

- The engine walks `scope` first, then `root` — `{{this.field}}` inside `{{#each}}` is scoped to the current item.
- `{{undefined.path}}` resolves to an empty string, not an error. Use `{{#if}}` for guarded sections.
- Unresolved `{{tokens}}` in the final output trigger `assertNoUnresolvedTokens` in `verify.mjs` and break the pipeline on purpose.

## Recent work

Three major batches on top of the original pipeline (all merged):

1. **PR #1** — CI lockfile upgrade (v1 → v3) so GitHub Actions' `npm ci` stops failing
2. **PR #2** — Game-day lineup section (starters + 1-9 batting order) with boxscore lineup fetch + schema validation
3. **PR #3** — Review follow-ups: 27 commits, +2,709/-254 lines. Highlights:
   - Correctness: `decisions.winner` for WP/LP, `/injuries` merge, pitchHand from MLB, series label resolution, non-TEX opponent lineup fallback
   - Security: SMTP requireTLS, GitHub Actions pinning, `ANTHROPIC_API_KEY` unset after enrich
   - SEO: meta description, Open Graph, Twitter Card, JSON-LD NewsArticle, canonical URLs, sitemap.xml, robots.txt, RSS feed
   - A11y: aria-live score, skip link, landmarks, aria-controls, reduced-motion, theme persistence
   - Resilience: soft-catch every MLB/weather fetch, doubleheader-aware game picker, enrich retries + timeout + prompt caching
   - Tests: 9 → 33 (render engine, crawl helpers, lineup builder, injury merge, game picker, live feed polling)

## What to run locally

```bash
npm ci
npm test                           # 33 tests, should all pass
npm audit                          # should say 0 vulnerabilities
ANTHROPIC_API_KEY=sk-... node run.mjs   # full pipeline end-to-end
```

Without an `ANTHROPIC_API_KEY`, enrich falls back to a structured message and the pipeline still publishes.

## Environment variables

| Variable | Stage | Required? | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | enrich | optional | Editorial copy via Claude. Omit → structured fallback. |
| `ENRICH_MODEL` | enrich | optional | Override model name (default `claude-sonnet-4-5`) |
| `ENRICH_MAX_TOKENS` | enrich | optional | Override max tokens (default 4000) |
| `ENRICH_STRICT` | enrich | optional | `"true"` → fail pipeline on enrich error instead of falling back |
| `DELIVERY_RECIPIENTS` | deliver | optional | Comma-separated emails. Omit → skip delivery. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | deliver | if delivering | SMTP transport |

## CI workflow

Triggered by:

- Daily cron at 13:00 UTC (~9 AM ET)
- Game-window cron every 15 minutes, 16:00-23:00 UTC and 00:00-05:00 UTC
- Manual `workflow_dispatch`

Job shape: `npm ci` → `npm test` → `node run.mjs` → commit archive snapshot → upload Pages artifact → deploy. Diagnostics (data JSON, output HTML, status.json, error logs) upload on every run.

## Open follow-ups

- **Split `crawl.mjs`** into `crawl/` subdirectory (api/mlb.mjs, api/weather.mjs, build/sections.mjs, build/lineup.mjs, validate.mjs, format.mjs) — it's ~1,400 lines and the next decomposition target
- **Self-host Google Fonts** — template currently loads Barlow Condensed + Inter from fonts.googleapis.com
- **Integration test** — mock MLB fixture + assert full pipeline output shape (smoke coverage beyond the unit tests)
- **Email template hardening** — Outlook and Gmail rendering quirks (from original handoff, still open)

## Notion references

- LLM Conversation Log: https://www.notion.so/331255fc8f44814483d4d11fd2703f68
- Pipeline Spec page: https://www.notion.so/331255fc8f44818ea2baf23a71c91645
- Code Dashboard LIVE: https://www.notion.so/331255fc8f44819d9d88c8ef21105082
