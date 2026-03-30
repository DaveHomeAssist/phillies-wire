# Phillies Wire

A daily Philadelphia Phillies newsletter site built as a static page, a lightweight JSON pipeline, and a GitHub Pages deployment target.

**Built:** March 28, 2026  
**Version:** 1.2.0  
**Stack:** Vanilla HTML, CSS custom properties, Node scripts, GitHub Pages

## Project structure

```text
phillies-wire/
|-- tokens.css
|-- phillies-wire.css
|-- phillies-wire-v2.html
|-- phillies-wire-schema.json
|-- crawl.mjs
|-- enrich.mjs
|-- render.mjs
|-- verify.mjs
|-- run.mjs
|-- archive.json
|-- archive/
|-- issues/
|-- overrides/
|-- .github/workflows/publish.yml
|-- README.md
`-- HANDOFF.md
```

## Pipeline

```text
run.mjs -> crawl.mjs -> edition sync -> enrich.mjs -> render.mjs -> verify.mjs -> deliver.mjs?
        -> latest index + dated issue + archive.json + archive/index.html + site/
```

Run locally:

```bash
node run.mjs
```

Or stage-by-stage:

```bash
node crawl.mjs
ANTHROPIC_API_KEY=sk-... node enrich.mjs
node render.mjs
node verify.mjs
```

## Fallback behavior

- `crawl.mjs` still publishes when the MLB injuries endpoint is unavailable by using the fixture baseline plus live transactions.
- `crawl.mjs` also supports same-day payload overrides from [`overrides/`](C:/Users/Dave%20RambleOn/Desktop/00-Inbox/Vivaldi%20Downloads/phillies-wire/overrides/README.md).
- `enrich.mjs` now uses an editorial-only payload instead of sending the full issue JSON to Claude.
- If `ANTHROPIC_API_KEY` is missing, or if enrich fails, the site publishes a structured fallback instead of failing the issue.
- `render.mjs` writes the latest issue, dated issue pages, `archive.json`, `archive/index.html`, and `status.json`, and the site surfaces freshness plus fallback notes from `meta.status`.
- `run.mjs` orchestrates the full pipeline, reuses the current day's edition number on reruns, and increments the issue number only when a new publication date is crawled.

## Automated publish

- Workflow: [`.github/workflows/publish.yml`](C:/Users/Dave%20RambleOn/Desktop/00-Inbox/Vivaldi%20Downloads/phillies-wire/.github/workflows/publish.yml)
- Triggers: `workflow_dispatch`, daily cron, and game-window refresh cron
- Output: GitHub Pages artifact plus committed archive snapshots on `main`
- Diagnostics: each run uploads the rendered HTML, archive manifest/page, data JSON, `status.json`, and any stage error logs

## Phase 2 additions

- State-aware hero block for `pregame`, `live`, `final`, and `off_day`
- Stable latest page plus dated issues under `issues/YYYY-MM-DD/`
- Archive index at `archive/index.html`
- `archive.json` manifest for downstream automation or QA
- Override directory for same-day editorial corrections
- Broader contract verification across latest, dated, archive, and `site/` outputs

## Data sources

- `statsapi.mlb.com`
- `open-meteo.com`
- MLB transactions feed for injury/rehab freshness

## Next likely upgrades

- Rotation card stat polish and current-year fallbacks once starters accumulate innings
- Stronger live polling guards for delayed and final-state games
- Email template hardening for Outlook and Gmail rendering quirks
- Template and JSON contract coverage for newer standings/live modules

## Notion references

- LLM Conversation Log: https://www.notion.so/331255fc8f44814483d4d11fd2703f68
- Pipeline Spec page: https://www.notion.so/331255fc8f44818ea2baf23a71c91645
- Code Dashboard LIVE: https://www.notion.so/331255fc8f44819d9d88c8ef21105082
