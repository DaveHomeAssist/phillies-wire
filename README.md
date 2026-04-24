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
|-- samples/
|   |-- issue-1.2.0.sample.json  ← fixture used by tests + crawl seed
|   |-- issue-1.3.0.sample.json  ← current per-issue format
|   `-- latest-1.0.0.sample.json ← consumer feed shape
|-- crawl.mjs
|-- enrich.mjs
|-- render.mjs
|-- verify.mjs
|-- run.mjs
|-- deliver.mjs
|-- live-feed.js
|-- pregame-preview.js
|-- archive.json
|-- archive/
|-- issues/
|-- overrides/
|-- scripts/
|   |-- lint.mjs           # node --check syntax scan
|   `-- health-check.mjs   # cron-friendly staleness probe
|-- test/
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

## What's new

- Per-issue SEO metadata: canonical URL, Open Graph, Twitter Card, and JSON-LD NewsArticle + SportsEvent blocks; robots.txt, sitemap.xml, Atom feed.xml, manifest.webmanifest, and a generated og-default.svg are produced on every run.
- Game-day lineup section with both starting pitchers (including pitching hand) and the announced 1–9 batting order, sourced from the MLB boxscore endpoint with a PHI-first fallback.
- Live injury report merging the MLB /injuries endpoint with the transactions feed; the fallback baseline is preserved for editorial context.
- Archive page with month grouping, client-side search, canonical URL, and share-ready metadata.
- Prev/Next navigation on dated issue pages plus a share bar (X / Bluesky / email / copy link) on every page.
- Accessibility: semantic landmarks (`<main>`, `<nav>`, `<footer>`, `<aside>`), skip link, live regions, reduced-motion support, theme persistence via localStorage, visually-hidden accordion heading, WCAG AA contrast on the masthead subheader.
- Live polling no longer reloads the page; it refreshes in place, pauses on hidden tabs, backs off after consecutive failures, and pauses cleanly on rain delays / postponements.
- Enrich stage uses prompt caching on the system block, honours a 60-second timeout, and retries 429 / 5xx / network resets up to four times with jittered backoff.
- CSP-friendly event delegation: inline `onclick` handlers replaced with `data-pw-*` attributes and a single delegated listener, so the script-src CSP can be tightened in the future.
- Override merge supports a `"__delete__"` sentinel to retract generated fields, and every override value is length-capped as a defense-in-depth measure.
- `node scripts/lint.mjs` syntax-checks every tracked `.mjs` / `.js` file and runs as the first step of `npm test`.
- `node scripts/health-check.mjs` probes the deployed `status.json` and posts to an optional webhook when the site goes stale.

## Next likely upgrades

- Critical CSS inlining and self-hosted fonts for faster first paint.
- Bullpen availability card driven by rolling reliever usage.
- Head-to-head season history and umpire crew mini-block.
- Playwright end-to-end smoke test for the live-feed pipeline.
- Progressive enhancement to a typed template engine once section density grows.

## Notion references

- LLM Conversation Log: https://www.notion.so/331255fc8f44814483d4d11fd2703f68
- Pipeline Spec page: https://www.notion.so/331255fc8f44818ea2baf23a71c91645
- Code Dashboard LIVE: https://www.notion.so/331255fc8f44819d9d88c8ef21105082
