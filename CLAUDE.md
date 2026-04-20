# Phillies Wire

## Project Overview

Daily Philadelphia Phillies newsletter site built as a static page plus lightweight JSON pipeline plus GitHub Pages deployment target. Free since 2026-03-28; daily cron regenerates a dated issue, an archive entry, a consumer `latest.json` feed, and an iframe-safe ticker embed.

Status: v1.5-preview. Core newsletter is stable on cron. Dashboard + innings surface are the active build targets. Schedule migration (combination plan Phase 1) is the next net-new move.

**Live:** https://davehomeassist.github.io/phillies-wire/
**Dashboard:** https://davehomeassist.github.io/phillies-wire/dashboard/
**Innings:** https://davehomeassist.github.io/phillies-wire/dashboard/innings/

## Stack

- **Runtime:** Node (no `engines` pinned yet — see Issue Tracker 001). Developed on Node 22.x+ 25.x.
- **Frontend:** Vanilla HTML + CSS custom properties (`tokens.css` + `phillies-wire.css`), zero-build
- **Build pipeline:** Node ESM scripts (`crawl.mjs`, `enrich.mjs`, `render.mjs`, `verify.mjs`, `deliver.mjs`) orchestrated by `run.mjs`
- **Data sources:** MLB Stats API (schedule, boxscore, injuries), Open-Meteo (weather)
- **Deploy:** GitHub Actions → GitHub Pages (`.github/workflows/publish.yml`)
- **Consumer surfaces:** `latest.json` feed (schema `latest-1.0.0`), per-issue `data.json` (schema `1.3.0`), iframe-safe ticker embed at `/embed/ticker.html`
- **Verification:** `verify.mjs` asserts per-issue data.json contract, latest.json schema + 26h freshness, ticker four render fns + iframe safety, system-reminder injection guard, mojibake scan, SEO/accessibility tags
- **Dependencies:** Only `nodemailer` (for optional email delivery)

## Key Decisions

- Zero-backend rule: all data sources are public APIs; no database, no auth, no server.
- Pipeline ordering: crawl → enrich → render → verify → deliver. `verify.mjs` is a hard gate before publish.
- Consumer contracts are versioned by schema_version string (`latest-1.0.0`, per-issue `1.3.0`). Breaking changes bump the major.
- Publish workflow deploys BEFORE persisting the archive snapshot commit (push-race fix 2026-04-20, commit `ab0ad55`). Persist step has 3-attempt retry with `pull --rebase --autostash` and `continue-on-error: true`.
- Dashboard lives at `/dashboard/` as a static asset copied via `STATIC_ASSET_DIRS` in `render.mjs`. Same for `/embed/`.
- Anticipatory UX on dashboard: `localStorage` key `philliesWire_prefs`, `save-data` detection, mobile bottom-tab navigation, first-visit hint. All animations gated by `prefers-reduced-motion` and `[data-save-data]`.
- Ticker embed is inline-only (no external script src, no external link href) so third parties can iframe it safely.

## Documentation Maintenance

- **Issue tracker:** This file (`## Issue Tracker` section below)
- **Session log:** `/Users/daverobertson/Desktop/Code/90-governance/docs/today.csv`
- **Full site spec:** [docs/SPEC.md](docs/SPEC.md) — site specification, bumped per release
- **Sprint plans:** [docs/](docs/) (e.g. `SPRINT_2026-W17.md`)
- **Portfolio contract:** `/Users/daverobertson/Desktop/Code/90-governance/docs/DEFINITION_OF_DONE.md`

Last verified: 2026-04-20. Next action: pin `engines.node` to close Issue Tracker 001.

## Definition of Done adoption status

| Rule | Status | Evidence |
|------|--------|----------|
| 1. Runtime selected | partial | Single lockfile (`package-lock.json`). Deploy target named (GitHub Pages). `engines.node` NOT yet pinned. |
| 2. Automated check green | green | `verify.mjs` gates every publish. Latest `node run.mjs` + `node verify.mjs` exit 0 (2026-04-20). CI workflow `publish.yml` runs verify on every push to main. |
| 3. Smoke evidence captured | green | Daily `archive/<date>/` entry + GitHub Actions run artifact per publish. Production cron run 24685694160 (2026-04-20) succeeded. |
| 4. Status doc updated | green | This CLAUDE.md created 2026-04-20 with Issue Tracker. Session rows appended to `today.csv` per change. |

## Issue Tracker

| ID | Severity | Status | Title | Notes |
|----|----------|--------|-------|-------|
| 001 | P2 | open | `engines.node` not pinned in package.json | Rule 1 partial. Pin to `>=22.0.0` once validated. |
| 002 | P2 | open | Schedule migration (combination plan Phase 1) | Three downstream upgrades block on this. Jumps the verification-first queue per Notion DoD page. |
| 003 | P3 | open | L5/L6 streak reviewer disagreement (2026-04-16) | External reviewer claimed L6; archive shows L5 is correct (4/16 was `off_day`). Resolved by shipping streak-strip visualization; flag retained for audit trail. |
| 004 | P3 | open | Injuries endpoint returns 404 | `statsapi.mlb.com/api/v1/teams/143/injuries` returns 404 during crawl. Pipeline handles gracefully; issue noted in logs. Alternate source needed. |
| 005 | P3 | open | Feature branch prune | `feat/latest-json-and-ticker` and sibling branches merged to main; safe to delete once confirmed. |
