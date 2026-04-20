# Sprint 2026-W17 — Phillies Wire 1.3 → 1.4

**Window:** 2026-04-21 → 2026-04-27 (5 working days + 2 buffer)
**Owner:** Dave (solo)
**Budget:** 15–20 focused hours
**Theme:** Unlock real data on the dashboard, ship a second view surface, fix the pipeline race that bit us twice in the 2026-04-20 session.

---

## Sprint goal

The dashboard's placeholder panels (Team Health, Player Focus, Lineup) show real data from per-issue JSON, a second visual surface (`/dashboard/innings/`) ships next to `/dashboard/`, and `publish.yml` stops losing deploys to a push race.

---

## Day 1 · Mon — Security + pipeline hardening

**~3 hours**

| # | Task | Est | Notes |
|---|---|---|---|
| 1.1 | Rotate exposed Anthropic key | 60 min | Revoke the plaintext key in Notion page `Prompt-Lab-Public` (334255fc…d58ab6e1) + `/Users/daverobertson/Desktop/Code/90-system/api keys.md`. Replace via 1Password CLI vault only. Clear the Notion property + page body. Audit the API Key Tracker DB for other rows with plaintext secrets. |
| 1.2 | Fix `publish.yml` push race | 60 min | Reorder so `Upload Pages artifact` + `Deploy to GitHub Pages` run **before** `Persist archive snapshot`. Deploy no longer depends on the commit-back succeeding. Back-to-back `workflow_dispatch` runs both succeed to verify. |
| 1.3 | Session log + close out | 30 min | today.csv row + Notion Development Log entry. |

**Exit criteria**
- `grep -r "sk-ant-" ~/Desktop/Code/` returns empty
- Notion search for `sk-ant-` returns empty
- Two back-to-back `workflow_dispatch` runs both green

---

## Days 2–3 · Tue + Wed — Per-issue `data.json` contract

**~6 hours — sprint centerpiece**

Current dashboard reads only `archive.json` (summary-level); Team Health, Lineup, Player Focus are placeholders. After this work, they become real.

### 2.1 `render.mjs` emits per-issue JSON (2 hr)

- Add `writeIssueDataFile(data, issueDate, siteDir)` that writes
  `site/issues/<date>/data.json` alongside `index.html`
- Payload subset per `docs/SPEC.md §3.2`:
  - `meta` (date, edition, volume, generated_at, mode, mode_label)
  - `record` (wins, losses, streak, division_rank, division)
  - `hero` (mode, label, headline, dek, summary, cards, bullets)
  - `sections.lineup.content` (starters, batting_order, first_pitch)
  - `sections.game_status.content` (matchup, first_pitch, venue, series, linescore)
  - `sections.injury_report.content` (il_entries array)
  - `next_game` (label, matchup, date, time, broadcast, venue)
- Strip heavy sections: `recap.content`, `roster.content`, `farm_system.content`, `preview.content`
- Bump `schema_version` to `1.3.0` on the data envelope

### 2.2 `verify.mjs` asserts the contract (1 hr)

- New assertion `assertIssueDataJsonPresent(siteDir, date)` — file exists, parses, has required top-level keys
- Regression test in `test/render.test.mjs` — given a mocked full payload, round-trip through `writeIssueDataFile()` and diff the expected key set

### 2.3 Dashboard fetches + hydrates (2 hr)

- In `dashboard.js`: after `archive.json`, fetch `../issues/<latest-date>/data.json`; graceful fallback if 404
- **Team Health panel**: render real `il_entries` — name, position, IL type, injury, target return, retroactive-to date
- **Lineup card (new)**: home starter + 1–9 batting order with position + bats handedness; show only when `mode ∈ {pregame, live}`
- **Player Focus card (new)**: next-start pitcher with last-3-starts stats if present; fallback to static starter info

### 2.4 Motion choreography for new panels (1 hr)

- Lineup rows: stagger-in matching activity rows (50ms apart)
- IL entries: fade-up with 80ms stagger
- Both respect `prefers-reduced-motion` + save-data overrides from v1.3
- Update `docs/SPEC.md §3.2` to reflect the shipped contract

**Exit criteria**
- `curl https://davehomeassist.github.io/phillies-wire/issues/<date>/data.json` returns 200 with the expected keys
- Dashboard Team Health shows Wheeler, Kerkering, Lazar (or whoever is on IL) with real return dates
- Lineup card renders 9 rows when today's edition is pregame

---

## Days 4–5 · Thu + Fri — Innings timeline surface

**~5 hours**

Third Gemini mockup from the design brief. Builds on the per-issue data shipped days 2–3.

### 3.1 Route scaffolding (1 hr)

- New files:
  - `dashboard/innings/index.html`
  - `dashboard/innings/innings.css`
  - `dashboard/innings/innings.js`
- Same sidebar + topbar as main dashboard; active nav indicator shifts to Analytics icon
- Reuse `../tokens.css`, `../dashboard.css` motion tokens, and save-data + reduced-motion guards — zero duplication

### 3.2 Per-play data extraction (1 hr)

- Audit `sections.game_status.content` for a `plays` array; if absent, add one during days 2–3 work
- Minimum shape per play: `{ inning, half, event_type, actor, detail }`
- `event_type ∈ { score_change, key_play, strikeout, home_run }`

### 3.3 Timeline viz (2 hr)

- 9-column CSS grid (INNING 1 → INNING 9), two rows (TOP / BOTTOM)
- Event markers:
  - ○ score change
  - △ key play
  - ✕ strikeout
  - ⭐ home run
- Vertical indicator cones for game-shifting moments (simplified 2D, no 3D gradient yet)
- Hover marker → tooltip with play detail + actor

### 3.4 Key events below timeline + legend (1 hr)

- 4 player-card blocks matching mockup layout (inning, action, player headshot placeholder)
- Legend strip at bottom listing marker types
- "View Filters" toggle → "Score Changes only" vs "All Plays" → persisted in `philliesWire_prefs.inningsFilter`

**Exit criteria**
- `/dashboard/innings/` returns HTTP 200
- Last final edition's play-by-play renders on the 9-inning grid with correct markers
- Filter toggle persists across reload via localStorage

---

## Buffer · Sat + Sun — Review + polish

| Task | Est |
|---|---|
| Lighthouse on `/dashboard/` + `/dashboard/innings/`; tune `lighthouserc.json` thresholds | 30 min |
| Mobile smoke test at 375 px (iPhone SE preset in DevTools); fix any issues | 30 min |
| Update `docs/SPEC.md §2.2` — mark innings timeline shipped, advance v1.5 targets | 15 min |
| Sprint retro via `session-report` skill — Discussion Log + Development Logs entries | 30 min |

---

## Deliverables

- [ ] `publish.yml` deploys unblocked by `Persist archive snapshot`
- [ ] Exposed Anthropic key rotated; vault-only storage enforced
- [ ] `site/issues/<date>/data.json` published every run
- [ ] Dashboard Team Health shows real IL entries
- [ ] Dashboard Lineup card (pregame/live only)
- [ ] Dashboard Player Focus card (next starter)
- [ ] `/dashboard/innings/` live
- [ ] `docs/SPEC.md` updated to v1.4.0

---

## Risk register

| R | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Per-issue JSON file sizes bust budget | Low | Low | Target: `archive.json + 30 × data.json` < 2 MB; cap each `data.json` at 20 KB via strip rules |
| R2 | Per-play data not exposed by current crawl | Medium | Medium | Day 3 morning: confirm shape of `game_status.content`; if missing, pull `/api/v1/game/<pk>/feed/live` in `crawl.mjs` (~30 min add) |
| R3 | Key rotation breaks an active integration | Low | Medium | Check Anthropic usage logs BEFORE revoking; notify running pipelines |
| R4 | Innings viz scope creep from 2D markers into 3D cones | Medium | Low | Hard 2-hour cap on viz work; cones deferred to v1.5 |
| R5 | Pipeline fix introduces new race | Low | High | Day 1 test: two back-to-back runs both succeed before moving on |
| R6 | Dashboard `data.json` fetch 404s during rollout window | Low | Low | Client already has graceful fallback to archive.json-only; no user-visible break |

---

## Out of scope (park for sprint 2026-W18+)

- Broadcast view (Gemini mockup #2) — defer; innings timeline fills the "analytics" slot for now
- Editorial/weekly recap view (Gemini mockup #3) — defer to v1.6
- HA comic-book dashboard token setup — separate project, separate session
- Prompt Lab Notion page rewrites — bigger context switch; schedule a half-day later
- Notion weekly backup cron — infra task, unblock separately
- Raycast install / Codex drop — personal tooling, whenever
- 18 Notion HA Entity row fixes (Echo Spot → Laundry Room, jerry → David's Room) — 20-min task, do at breakfast any day

---

## Definition of done

- [ ] All 8 deliverable checkboxes above ticked
- [ ] `npm test` → all 33+ tests passing
- [ ] Lighthouse ≥ 95 on `/dashboard/` **and** `/dashboard/innings/`
- [ ] `docs/SPEC.md` diff reviewed — no "v1.4 target" annotations remain on shipped items
- [ ] One Notion Discussion Log entry + one Development Logs entry for the sprint
- [ ] `today.csv` has at least 5 sprint rows (one per working day)

---

## Metrics to watch

| Metric | Target | Measured where |
|---|---|---|
| Build success rate | 100% (vs 75% in the 2026-04-20 session due to the push race) | GitHub Actions run list |
| `archive.json + Σ data.json` total | < 500 KB for first 90 days | Pages deploy size diff |
| First Contentful Paint | ≤ 1.2 s | Lighthouse on `/dashboard/` |
| Largest Contentful Paint | ≤ 2.5 s | Lighthouse on `/dashboard/innings/` |
| New workflow steps added | 0 (reorder existing, don't add new) | `publish.yml` diff |

---

## Notes

- The `implementation_plan.txt` in `output/` covers the broader multi-week roadmap; this sprint consumes Phase 1 of that plan.
- If Day 1's pipeline fix surfaces deeper issues, accept a 1-day slip on Day 2's `data.json` work; don't skip the reliability win.
- All new JS stays vanilla; no new dependencies.
- Every new panel must respect the v1.2 `prefers-reduced-motion` guard and the v1.3 `data-save-data` guard — both already shipped.
