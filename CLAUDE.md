# Phillies Wire

## Project Overview

Daily Philadelphia Phillies newsletter site built as a static page plus lightweight JSON pipeline plus GitHub Pages deployment target. Free since 2026-03-28; daily cron regenerates a dated issue, an archive entry, a canonical Phillies schedule JSON artifact, a consumer `latest.json` feed, an iframe-safe ticker embed, and a season ICS calendar.

Status: v1.6.1. Core newsletter is stable on cron. The merged dashboard, innings surface, and schedule tracker live in `phillies-wire` with a repo-owned canonical schedule layer and Ballparks Quest cutover stub. v1.6.1 adds the "Liberty Bell / broadsheet" visual enhancement layer, road-game data correctness fixes (Issue 006), and a dedicated inline-styled HTML email.

**Live:** https://davehomeassist.github.io/phillies-wire/
**Dashboard:** https://davehomeassist.github.io/phillies-wire/dashboard/
**Innings:** https://davehomeassist.github.io/phillies-wire/dashboard/innings/
**Preferences:** https://davehomeassist.github.io/phillies-wire/dashboard/preferences/
**Accuracy:** https://davehomeassist.github.io/phillies-wire/dashboard/accuracy/
**Season:** https://davehomeassist.github.io/phillies-wire/dashboard/season/
**Schedule:** https://davehomeassist.github.io/phillies-wire/schedule/

## Stack

- **Runtime:** Node 22.x+ 25.x (`engines.node >=22.0.0`)
- **Frontend:** Vanilla HTML + CSS custom properties (`tokens.css` + `phillies-wire.css`), zero-build
- **Build pipeline:** Node ESM scripts (`crawl.mjs`, `enrich.mjs`, `render.mjs`, `verify.mjs`, `deliver.mjs`) orchestrated by `run.mjs`
- **Data sources:** MLB Stats API (schedule, boxscore, injuries), Open-Meteo (weather)
- **Deploy:** GitHub Actions → GitHub Pages (`.github/workflows/publish.yml`)
- **Consumer surfaces:** `latest.json` feed (schema `latest-1.0.0`), per-issue `data.json` (schema `1.3.0`), canonical season schedule at `data/phillies-2026.json`, season ICS at `calendar/phillies-2026-all.ics`, iframe-safe ticker embed at `/embed/ticker.html`, merged schedule tracker at `/schedule/`, and local preferences at `/dashboard/preferences/`
- **Accuracy dashboard:** `/dashboard/accuracy/` renders a daily fact-check scorecard from `dashboard/accuracy/accuracy.json` (schema `accuracy-1.0.0`): per-claim verdicts (accurate / inaccurate / unverifiable) and timeline relevancy (current / outdated / misleading), checked against authoritative MLB sources
- **Verification:** `verify.mjs` asserts per-issue data.json contract, canonical schedule JSON, season calendar copy, latest.json schema + 26h freshness, ticker four render fns + iframe safety, accuracy scorecard contract (schema + tally reconciliation + site mirror), system-reminder injection guard, mojibake scan, SEO/accessibility tags
- **Dependencies:** Only `nodemailer` (for optional email delivery)

## Key Decisions

- Zero-backend rule: all data sources are public APIs; no database, no auth, no server.
- Pipeline ordering: crawl → enrich → render → verify → deliver. `verify.mjs` is a hard gate before publish.
- Consumer contracts are versioned by schema_version string (`latest-1.0.0`, per-issue `1.3.0`, canonical schedule `1.0.0`). Breaking changes bump the major.
- Publish workflow deploys BEFORE persisting the archive snapshot commit (push-race fix 2026-04-20, commit `ab0ad55`). Persist step has 3-attempt retry with `pull --rebase --autostash` and `continue-on-error: true`.
- Dashboard lives at `/dashboard/` as a static asset copied via `STATIC_ASSET_DIRS` in `render.mjs`. Same for `/embed/`, `/schedule/`, `/calendar/`, and `/shared/`.
- `data/phillies-2026.json` is the canonical Phillies schedule source. Dashboard, schedule tracker, innings view, calendar, and latest feed all resolve current and next game state from that artifact.
- Season at a Glance lives at `/dashboard/season/` (`index.html` + `season.css` + `season.js`). It is a zero-data-file page: every figure is derived **client-side** from `data/phillies-2026.json` — overall record (authoritative `league_record`, which ties out to the source `.pct`), run differential, home/road · NL East · day/night · one-run splits, last-10 form, current & longest W/L streaks, month-by-month W-L, and an "Up Next" card resolved as the first playable game after the last completed one (robust to a postponed game sitting at the schedule frontier). Mirrors the accuracy-page hydration pattern (fetch JSON → build DOM defensively → honour theme/reduced-data prefs). Required files pinned in `verify.mjs`; markup token/mojibake-guarded there too.
- Legacy Phillies schedule state from Ballparks Quest uses the `phillies2026` browser key and is imported once into the new schedule tracker.
- Anticipatory UX on dashboard: `localStorage` key `philliesWire_prefs`, `save-data` detection, mobile bottom-tab navigation, first-visit hint. All animations gated by `prefers-reduced-motion` and `[data-save-data]`.
- Preferences live at `/dashboard/preferences/` and manage browser local theme, reduced-data mode, innings default filter, streak alert threshold, and local export or import of Wire state.
- Ticker embed is inline-only (no external script src, no external link href) so third parties can iframe it safely.
- Visual style is layered: `tokens.css` (primitives + semantic tokens) → `phillies-wire.css` (components) → `pw-enhance.css` (additive "Liberty Bell / broadsheet" enhancement). The enhancement layer is token-only (no raw hex), namespaces its own tokens `--pwx-*`, and is safe to drop without breaking the base. It adds the masthead Liberty Bell + pinstripe, a colonial gazette dateline, a numbered broadsheet section index, keystone hero bullets, a "Ring the Bell" footer motto, and the **Tale of the Tape** pitching-matchup block (ERA / W-L / WHIP for both starters, fed by `fetchPitcherStats`, omitted when either starter is TBD). Fonts are self-hosted (`fonts.css` + `fonts/`), no Google Fonts. The masthead bell animation is CSS-only and respects `prefers-reduced-motion`.
- The delivered email is a dedicated, fully inline-styled, table-based document built by `buildEmailHtml` in `email-render.mjs` (re-exported from `deliver.mjs`, which builds it from the issue data at send time) — NOT the rendered site page. Mail clients (notably the Gmail app) strip `<style>` blocks and do not resolve CSS custom properties, so the email contains zero `<style>`/`var()`, uses web-safe font fallbacks, and carries the Track A correctness (transit shown only on home games, Phillies-side broadcast). The contract is pinned by `test/reliability/email-render.test.mjs`.
- Email-list signup is a Buttondown hosted form. The site Subscribe CTA (nav link + band) and the email footer link all point at `SUBSCRIBE_URL` in `config.mjs` (`https://buttondown.com/phillieswire`) — swap that one constant to change the destination. At send time `deliver.mjs` merges active ("regular") Buttondown subscribers (fetched from `https://api.buttondown.email/v1/subscribers` with the `BUTTONDOWN_API_KEY` secret) into `DELIVERY_RECIPIENTS`, lowercase-deduped, so a new signup gets the next issue with no hand-editing. The fetch is best-effort: a missing key or Buttondown outage falls back to `DELIVERY_RECIPIENTS` and never blocks the send (`test/reliability/buttondown-subscribers.test.mjs`).

## Documentation Maintenance

- **Issue tracker:** This file (`## Issue Tracker` section below)
- **Session log:** `/Users/daverobertson/Desktop/Code/90-governance/docs/today.csv`
- **Full site spec:** [docs/SPEC.md](docs/SPEC.md) — site specification, bumped per release
- **Sprint plans:** [docs/](docs/) (e.g. `SPRINT_2026-W17.md`)
- **Portfolio contract:** `/Users/daverobertson/Desktop/Code/90-governance/docs/DEFINITION_OF_DONE.md`

Last verified: 2026-06-26. Next action: enrich the innings timeline with full per play event arrays from live game data instead of the current linescore-first contract. Latest change: shipped the Season at a Glance page at `/dashboard/season/`.

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
| 006 | P1 | resolved | Road-game editions showed home-venue / opponent data | External fact-check (2026-06-25) of the road series at Washington found: weather pulled from a hardcoded Citizens Bank Park lat/lon (Philadelphia, not the game city); broadcast/Watch showing the opponent's feed (`Nationals.TV` / `WJFK`) instead of the Phillies' (`NBCSP` / `94 WIP`); a "Roster & Lineup Confirmed" chip while lineups were still pending; opponent-first next-game wording (`NYM vs PHI`); and a stale Philadelphia SEPTA `transit` string in the JSON on road games. Fixed in `crawl.mjs` / `config.mjs` / `crawl/api/mlb.mjs`: `extractBroadcast` prefers the Phillies side, weather rebuilds from the hydrated game-venue coordinates, the roster chip is lineup-aware, next-game matchup is Phillies-perspective (`PHI @ NYM`), and `transit` is cleared when `venue_is_home` is false. `verify.mjs` gains transit↔venue and roster-chip↔lineup regression guards. Injuries were audited as correct (García / Keller are Phillies) and left untouched. Local `verify.mjs` exits 0; all 18 test suites pass. |
| 007 | P1 | resolved | Newsletter email rendered as unstyled plain text | The email was the full site page with a `<style>` block built on CSS custom properties; the Gmail app strips `<style>` and never resolves `var()`, so it collapsed to plain text. A first fix (flattening `var()` to concrete values, `0a092056`) was insufficient because the `<style>` block itself is stripped. Final fix: `email-render.mjs` builds a dedicated, fully inline-styled, table-based email (`buildEmailHtml`, re-exported from `deliver.mjs`, built from data at send time); zero `<style>`/`var()`, web-safe fonts. Pinned by `test/reliability/email-render.test.mjs` (6 cases). Delivered styled to 2 recipients on 2026-06-25; CI 19/19 green. |
| 008 | P3 | resolved | Season at a Glance page | New dashboard page at `/dashboard/season/` summarizing the whole 2026 season — record, win %, run differential, home/road · NL East · day/night · one-run splits, last-10 form, current & longest W/L streaks, runs for/against, month-by-month, and Up Next. Fully client-derived from `data/phillies-2026.json` (no new data file or pipeline step); mirrors the accuracy-page hydration pattern and reuses the `--dash-*` token set. Added to the sidebar nav on every dashboard page, pinned in `verify.mjs` required files + token/mojibake guards. Smoke-tested headless (record/splits/streaks/months/next all tie out); lint clean. |
| 009 | P1 | resolved | Live-refresh runs false-failed the verify accuracy gate | Scheduled game-window runs (2026-06-28 00:08 / 02:20 UTC) failed at `verify.mjs` with "Accuracy report contains 1 inaccurate claim(s)". Root cause: every pipeline run calls `factcheck.mjs --export-accuracy`, which runs the live MLB API source checks. On a live refresh `crawl.mjs` deliberately preserves the morning's frozen editorial snapshot (recap, standings); once the prior game went Final overnight the live API moved ahead of that snapshot, so the recap/standings reconciliation logged a `findings.errors` entry. `buildAccuracyReport` maps errors → verdict `inaccurate`, and `verify.mjs` hard-fails when `inaccurate !== 0` — which gates the Pages deploy and, in daily mode, blocks `deliver.mjs` (the newsletter email). Fix: `run.mjs` appends `--live-refresh` to the accuracy export on live runs; `factcheck.mjs` routes the live-API **recap** disagreements to the non-blocking `unverified` bucket on live refreshes (the recap describes the most-recent final, which races factcheck's calendar-"yesterday" at game-final/timezone boundaries). Per Codex review (PR #27), the standings reconciliation is **not** in the carve-out — crawl re-fetches standings live every refresh (not a frozen snapshot), so a standings-vs-API mismatch stays a blocking error in all modes so a degraded crawl can't publish stale NL East records past the gate. The strict daily gate is unchanged. Pinned by `test/reliability/factcheck-live-refresh.test.mjs`; all 21 suites pass, lint clean. |
