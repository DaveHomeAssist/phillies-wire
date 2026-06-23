# Phillies Wire

A daily Philadelphia Phillies content site: a static newsletter, a set of dashboard surfaces, a lightweight JSON pipeline, and a GitHub Pages deployment target. Zero backend — every data source is a public API.

**Built:** March 28, 2026
**Version:** 1.6-preview
**Stack:** Vanilla HTML, CSS custom properties, Node ESM scripts, GitHub Pages
**Canonical docs:** [`CLAUDE.md`](CLAUDE.md) (source of truth) · [`HANDOFF.md`](HANDOFF.md) (orientation) · [`docs/SPEC.md`](docs/SPEC.md) (site spec)

## Live surfaces

| Surface | URL |
|---|---|
| Newsletter | https://davehomeassist.github.io/phillies-wire/ |
| Dashboard | https://davehomeassist.github.io/phillies-wire/dashboard/ |
| Innings timeline | https://davehomeassist.github.io/phillies-wire/dashboard/innings/ |
| Preferences | https://davehomeassist.github.io/phillies-wire/dashboard/preferences/ |
| Accuracy scorecard | https://davehomeassist.github.io/phillies-wire/dashboard/accuracy/ |
| Schedule tracker | https://davehomeassist.github.io/phillies-wire/schedule/ |

## Project structure

```text
phillies-wire/
|-- tokens.css, phillies-wire.css      # design tokens + styles
|-- crawl.mjs, enrich.mjs, render.mjs  # pipeline stages
|-- verify.mjs, deliver.mjs, run.mjs   # gate, optional email, orchestrator
|-- factcheck.mjs                      # pre-publish gate + daily fact-check + accuracy export
|-- config.mjs                         # centralized constants
|-- live-feed.js                       # browser-side live polling
|-- data/phillies-2026.json            # canonical season schedule (source of truth)
|-- calendar/phillies-2026-all.ics     # season ICS
|-- embed/ticker.html                  # iframe-safe ticker
|-- dashboard/                         # dashboard, innings, preferences, accuracy
|-- schedule/                          # merged schedule tracker
|-- issues/, archive/, archive.json    # generated newsletter output
|-- scripts/                           # lint.mjs, test-runner.mjs, health-check.mjs
|-- test/, test/reliability/           # unit + reliability suites
|-- .github/workflows/publish.yml      # CI publish + deploy
`-- README.md, HANDOFF.md, CLAUDE.md, docs/
```

## Pipeline

```text
run.mjs -> crawl.mjs -> edition sync -> enrich.mjs -> render.mjs -> verify.mjs -> deliver.mjs? -> factcheck.mjs
        -> latest index + dated issue + per-issue data.json + archive.json + archive/index.html
        -> latest.json feed + canonical schedule JSON + ICS calendar + ticker + accuracy scorecard
```

Run locally (pull first — `main` advances on every cron run):

```bash
git pull
node run.mjs
```

Or stage-by-stage:

```bash
node crawl.mjs
ANTHROPIC_API_KEY=sk-... node enrich.mjs
node render.mjs
node verify.mjs
```

## Verification gate

`verify.mjs` is a hard pre-publish gate. It runs the deterministic fact-check (`runFactcheck`) and asserts the per-issue `data.json` contract, canonical schedule JSON, season calendar copy, `latest.json` schema + freshness, ticker render functions + iframe safety, the accuracy scorecard contract, plus SEO/accessibility tags and a mojibake/injection scan. Any failure breaks the publish on purpose.

## Fallback behavior

- `crawl.mjs` still publishes when the MLB injuries endpoint 404s by deriving IL from the season transactions feed plus the fixture baseline.
- `crawl.mjs` supports same-day payload overrides for editorial corrections.
- `enrich.mjs` sends an editorial-only payload to Claude; if `ANTHROPIC_API_KEY` is missing or enrich fails, the site publishes a structured fallback instead of failing the issue.
- `run.mjs` reuses the current day's edition number on reruns and increments only when a new publication date is crawled.

## Fact-check

`factcheck.mjs` runs in two modes (see [`docs/FACTCHECK.md`](docs/FACTCHECK.md)):

- **Pre-publish** (deterministic, offline) — invoked by `verify.mjs`; blocks publish on render bugs or factual contradictions.
- **Daily** (source-verified vs MLB Stats API) — run by `run.mjs` post-publish via `--export-accuracy`, which powers the `/dashboard/accuracy/` scorecard and upserts a Notion report.

## Automated publish

- Workflow: [`.github/workflows/publish.yml`](.github/workflows/publish.yml)
- Triggers: `workflow_dispatch`, daily cron, and game-window refresh cron
- Output: GitHub Pages deploy, then a committed archive snapshot on `main` (deploy runs before the persist commit to avoid a push race)
- Diagnostics: each run uploads rendered HTML, archive manifest/page, data JSON, `status.json`, and any stage error logs

## Data sources

- `statsapi.mlb.com` — schedule, boxscore, injuries, `feed/live` play-by-play
- `open-meteo.com` — weather
- MLB transactions feed — injury/rehab freshness (and IL fallback when `/injuries` 404s)

## Consumer contracts

Versioned by `schema_version` string; breaking changes bump the major:

- Per-issue `data.json` — `1.3.0`
- `latest.json` feed — `latest-1.0.0`
- Canonical schedule `data/phillies-2026.json` — `1.0.0`
- Accuracy scorecard — `accuracy-1.0.0`

## Next likely upgrades

- Critical-CSS inlining and self-hosted fonts for faster first paint.
- Bullpen availability card driven by rolling reliever usage.
- Stable alternate source for the team injuries endpoint (issue 004).
- Playwright end-to-end smoke test for the live-feed pipeline.

## Notion references

- LLM Conversation Log: https://www.notion.so/331255fc8f44814483d4d11fd2703f68
- Pipeline Spec page: https://www.notion.so/331255fc8f44818ea2baf23a71c91645
- Code Dashboard LIVE: https://www.notion.so/331255fc8f44819d9d88c8ef21105082
