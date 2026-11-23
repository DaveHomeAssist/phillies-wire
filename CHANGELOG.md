# Changelog

All material Phillies Wire changes are recorded here, newest first.

## 2026-11-23 — Hot Stove splash

- Published the November 23 Hot Stove listen page at `/hot-stove/` and made it the first-visit splash for the homepage (Esc, Continue, and `/?skip` / `/?home` return to `/`).
- The data publish workflow stays paused. A static Pages workflow assembles the existing published tree and deploys it, without crawl, enrich, or email. Removal steps are in HANDOFF.md; take the splash down by February 1, 2027, before the in-season flip.

## 2026-10-09 — Offseason mode

- Added the `SEASON_PHASE` switch (config.mjs), currently `offseason`: weekly cron only, no enrich and no email, no game/weather/live-feed fetches, and a "2026 season complete" page with the final record computed from the canonical schedule (88-74) instead of the fixture's 0-0.
- Workflow: removed the daily and */15 crons and added a weekly `0 14 * * 1` cron. The delivery-failure gate now runs only when delivery was attempted.
- See HANDOFF.md "Offseason runbook" to flip back before spring training.

## 2026-08-26

### Reliability and operations (audit remediation)

- Daily publish now fails when a required newsletter delivery fails, instead of reporting success without sending (H-1); the two refresh cron workflows were merged into one schedule (M-1) (`db678db07`).
- The `user_data` wrapping test assertion now tolerates CRLF checkouts (M-2) (`3e26190f5`).
- The archive commit-back now persists `dashboard/accuracy/accuracy.json`, so a clean checkout carries the same accuracy report the site serves (M-3); the stale June 27 branch copy was synced to the deployed 2026-08-26 report. Also repaired the publish workflow: the H-1 delivery gate had clobbered the `Publish summary` step header, leaving a duplicate `run:` key that made the workflow file invalid and failed every run after `db678db07`.

## 2026-08-12

### Performance and stability

- Consolidated the four render-blocking style layers into one generated site.css while retaining the layered source files as the editing contract.
- Preloaded the primary display and body fonts, switched self-hosted fonts to font-display: optional, and added metric-compatible fallback stacks to prevent late font swaps from shifting the game briefing.
- Updated the renderer, archive, current issue, site-artifact builder, verification gate, and pipeline smoke test so daily publication preserves the optimized delivery path.

### Security and operations

- Added pinned repository scanning for dependency vulnerabilities, exposed secrets, and configuration mistakes.
- Enabled Dependabot vulnerability alerts, automated security fixes, and weekly dependency updates.
