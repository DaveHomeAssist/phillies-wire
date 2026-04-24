# Phillies Wire

## Project Overview

Daily Philadelphia Phillies newsletter site built as a static page plus lightweight JSON pipeline plus GitHub Pages deployment target. Free since 2026-03-28; daily cron regenerates a dated issue, an archive entry, a canonical Phillies schedule JSON artifact, a consumer `latest.json` feed, an iframe-safe ticker embed, and a season ICS calendar.

Status: v1.6-preview. Core newsletter is stable on cron. The merged dashboard, innings surface, and schedule tracker now live in `phillies-wire` with a repo-owned canonical schedule layer and Ballparks Quest cutover stub.

**Live:** https://davehomeassist.github.io/phillies-wire/
**Dashboard:** https://davehomeassist.github.io/phillies-wire/dashboard/
**Innings:** https://davehomeassist.github.io/phillies-wire/dashboard/innings/
**Schedule:** https://davehomeassist.github.io/phillies-wire/schedule/

## Stack

- **Runtime:** Node 22.x+ 25.x (`engines.node >=22.0.0`)
- **Frontend:** Vanilla HTML + CSS custom properties (`tokens.css` + `phillies-wire.css`), zero-build
- **Build pipeline:** Node ESM scripts (`crawl.mjs`, `enrich.mjs`, `render.mjs`, `verify.mjs`, `deliver.mjs`) orchestrated by `run.mjs`
- **Data sources:** MLB Stats API (schedule, boxscore, injuries), Open-Meteo (weather)
- **Deploy:** GitHub Actions → GitHub Pages (`.github/workflows/publish.yml`)
- **Consumer surfaces:** `latest.json` feed (schema `latest-1.0.0`), per-issue `data.json` (schema `1.3.0`), canonical season schedule at `data/phillies-2026.json`, season ICS at `calendar/phillies-2026-all.ics`, iframe-safe ticker embed at `/embed/ticker.html`, merged schedule tracker at `/schedule/`
- **Verification:** `verify.mjs` asserts per-issue data.json contract, canonical schedule JSON, season calendar copy, latest.json schema + 26h freshness, ticker four render fns + iframe safety, system-reminder injection guard, mojibake scan, SEO/accessibility tags
- **Dependencies:** Only `nodemailer` (for optional email delivery)

## Key Decisions

- Zero-backend rule: all data sources are public APIs; no database, no auth, no server.
- Pipeline ordering: crawl → enrich → render → verify → deliver. `verify.mjs` is a hard gate before publish.
- Consumer contracts are versioned by schema_version string (`latest-1.0.0`, per-issue `1.3.0`, canonical schedule `1.0.0`). Breaking changes bump the major.
- Publish workflow deploys BEFORE persisting the archive snapshot commit (push-race fix 2026-04-20, commit `ab0ad55`). Persist step has 3-attempt retry with `pull --rebase --autostash` and `continue-on-error: true`.
- Dashboard lives at `/dashboard/` as a static asset copied via `STATIC_ASSET_DIRS` in `render.mjs`. Same for `/embed/`, `/schedule/`, `/calendar/`, and `/shared/`.
- `data/phillies-2026.json` is the canonical Phillies schedule source. Dashboard, schedule tracker, innings view, calendar, and latest feed all resolve current and next game state from that artifact.
- Legacy Phillies schedule state from Ballparks Quest uses the `phillies2026` browser key and is imported once into the new schedule tracker.
- Anticipatory UX on dashboard: `localStorage` key `philliesWire_prefs`, `save-data` detection, mobile bottom-tab navigation, first-visit hint. All animations gated by `prefers-reduced-motion` and `[data-save-data]`.
- Ticker embed is inline-only (no external script src, no external link href) so third parties can iframe it safely.

## Documentation Maintenance

- **Issue tracker:** This file (`## Issue Tracker` section below)
- **Session log:** `/Users/daverobertson/Desktop/Code/90-governance/docs/today.csv`
- **Runbook:** [RUNBOOK.md](RUNBOOK.md) — operational recovery reference; pipeline stages, failure modes, re-running editions
- **Full site spec:** [docs/SPEC.md](docs/SPEC.md) — site specification, bumped per release
- **Sprint plans:** [docs/](docs/) (e.g. `SPRINT_2026-W17.md`)
- **Portfolio contract:** `/Users/daverobertson/Desktop/Code/90-governance/docs/DEFINITION_OF_DONE.md`

Last verified: 2026-04-22. Next action: enrich the innings timeline with full per play event arrays from live game data instead of the current linescore-first contract.

## Definition of Done adoption status

| Rule | Status | Evidence |
|------|--------|----------|
| 1. Runtime selected | green | Single lockfile (`package-lock.json`). Deploy target named (GitHub Pages). `engines.node >=22.0.0` pinned. |
| 2. Automated check green | green | `verify.mjs` gates every publish. Latest `ISSUE_MODE=live node run.mjs` exits 0 on 2026-04-22. CI workflow `publish.yml` runs verify on every push to main. |
| 3. Smoke evidence captured | green | Daily `archive/<date>/` entry + GitHub Actions run artifact per publish. Production cron run 24685694160 (2026-04-20) succeeded. |
| 4. Status doc updated | green | This CLAUDE.md created 2026-04-20 with Issue Tracker. Session rows appended to `today.csv` per change. |

## Issue Tracker

| ID | Severity | Status | Title | Notes |
|----|----------|--------|-------|-------|
| 001 | P2 | resolved | `engines.node` pinned in package.json | Runtime contract now declares `>=22.0.0`. |
| 002 | P2 | resolved | Schedule migration (combination plan Phase 1) | `/schedule/`, canonical schedule JSON, ICS, dashboard wiring, and Ballparks Quest cutover stub shipped on 2026-04-22. |
| 003 | P3 | open | L5/L6 streak reviewer disagreement (2026-04-16) | External reviewer claimed L6; archive shows L5 is correct (4/16 was `off_day`). Resolved by shipping streak-strip visualization; flag retained for audit trail. |
| 004 | P3 | open | Injuries endpoint returns 404 | `statsapi.mlb.com/api/v1/teams/143/injuries` returns 404 during crawl. Pipeline handles gracefully; issue noted in logs. Alternate source needed. |
| 005 | P3 | resolved | Feature branch prune | Legacy `feat/latest-json-and-ticker` remote branch deleted after merge confirmation. |
