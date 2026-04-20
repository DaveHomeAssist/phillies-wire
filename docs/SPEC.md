# Phillies Wire — Site Specification

**Version:** 1.4.0
**Owner:** Dave Robertson
**Last revised:** 2026-04-20
**Status:** Active. v1.4.0 ships per-issue `data.json` contract + live Team Health / Lineup / Player Focus panels on `/dashboard/`.

---

## 1. Purpose

A daily Philadelphia Phillies newsletter delivered as a static site, a JSON archive, an RSS feed, an optional email, and a live-data command dashboard. Zero backend. Public, cache-friendly, deterministic.

### 1.1 Audience

- **Dave + household** (primary) — the site is a personal paper.
- **Family + friends subscribing via email** — delivered mornings.
- **Public readers** (secondary) — RSS/bookmark.
- **Future: dashboards in the house** — kitchen tablet, Stream Deck key, Notion embed.

### 1.2 Non-goals

- No login, no account system, no user-generated content.
- No server-side state. All data is either on disk in the repo or fetched live from MLB Stats API and Open-Meteo.
- No paywall. No analytics tracking beyond GitHub Pages defaults.
- No full Statcast/sabermetric depth. Pitch-level and spin-axis data are out of scope unless the MLB public feed exposes them at no cost.

---

## 2. Information architecture

```
phillies-wire/                                 → GitHub Pages root
│
├── /                                          → Current issue (today's edition)
├── /archive/                                  → Full archive index
├── /issues/<YYYY-MM-DD>/                      → Permalinks per day
├── /dashboard/                                → NEW — live command center
│
├── /archive.json                              → Machine-readable archive manifest
├── /feed.xml                                  → RSS 2.0 for readers
├── /sitemap.xml                               → Search indexing
├── /robots.txt                                → Crawler policy
├── /manifest.webmanifest                      → PWA / install metadata
├── /favicon.svg                               → Brand mark
├── /og-default.svg                            → Social preview fallback
│
└── /status.json                               → Build freshness heartbeat
```

### 2.1 Surfaces

| Surface | Path | Purpose | Audience | Refresh |
|---|---|---|---|---|
| **Latest issue** | `/` | Current edition: hero, ticker, sections, next game | Everyone | Every crawl (13 UTC + in-game every 15 min) |
| **Archive index** | `/archive/` | List of all issues, filterable | Everyone | Every crawl |
| **Dated issue** | `/issues/<date>/` | Permanent per-day record | Search / RSS readers | Immutable after day closes |
| **Dashboard** | `/dashboard/` | Live command center view: hero, activity feed, record, key events | Dave + household | Client-side poll of `archive.json` + `live-feed` data during games |
| **RSS** | `/feed.xml` | Standard feed | RSS clients | Every crawl |
| **JSON archive** | `/archive.json` | Machine-readable index of all editions | Dashboards, scripts | Every crawl |

### 2.2 Proposed future surfaces

| Surface | Path | Status | Notes |
|---|---|---|---|
| **Per-issue JSON** | `/issues/<date>/data.json` | ✅ shipped v1.4.0 | Unlocks Lineup / Injuries / Player Focus on dashboard |
| **Innings timeline** | `/dashboard/innings/` | v1.5 (planned) | Visualizes per-play timeline for live/final editions |
| **Broadcast view** | `/broadcast/` | v1.6 | Heavy-chart aesthetic (Gemini mockup #2), for large displays |
| **Editorial view** | `/editorial/` | v1.6 | Magazine-layout weekly recap (Gemini mockup #3) |
| **Live API proxy** | `/api/now.json` | deferred | Cached live snapshot; only if GitHub Pages latency becomes an issue |
| **Weekly recap** | `/recaps/<week>/` | v1.7 | Aggregated 7-day narrative |

---

## 3. Data contracts

### 3.1 `archive.json` (current, schema_version 1.2.0)

```json
{
  "schema_version": "1.2.0",
  "publication": "Phillies Wire",
  "updated_at": "ISO-8601",
  "latest_date": "YYYY-MM-DD",
  "entries": [
    {
      "date": "YYYY-MM-DD",
      "issue_path": "issues/<date>/",
      "volume": 1,
      "edition": 22,
      "mode": "pregame|live|final|off_day",
      "mode_label": "Pregame|Live|Final|Off Day",
      "hero_label": "Pregame|Live|Final|Off Day",
      "headline": "PHI 2, ATL 4.",
      "dek": "ATL 4, PHI 2 · Grant Holmes · 4.2 IP, 4 H, 2 ER, 4 K",
      "summary": "PHI 2, ATL 4. Final at Citizens Bank Park, Philadelphia. ATL wins 3-0.",
      "off_day": false,
      "enrich_state": "ok|pending|fallback",
      "generated_at": "ISO-8601"
    }
  ]
}
```

### 3.2 Per-issue data (schema_version 1.3.0 — shipped v1.4.0)

Written to `site/issues/<date>/data.json` alongside each `index.html` by `render.mjs::buildIssueDataJson()`. Asserted by `verify.mjs` against a 20 KB budget. Fetched by `/dashboard/` at runtime.

```json
{
  "schema_version": "1.3.0",
  "meta":  { "date", "edition", "volume", "publication", "generated_at", "status" },
  "record": { "wins", "losses", "streak", "division_rank", "division" },
  "hero":   { "mode", "label", "headline", "dek", "summary", "cards", "bullets", "next_label", "next_value" },
  "sections": {
    "lineup":        { "content": { "starters", "batting_order", "first_pitch", "mode_label" } },
    "game_status":   { "content": { "matchup", "first_pitch", "venue", "series", "linescore", "starters" } },
    "injury_report": { "content": { "il_entries": [...] } }
  },
  "next_game": { "label", "matchup", "date", "time", "broadcast", "venue" }
}
```

Fields omitted intentionally: `recap.content` (only needed in HTML render), `roster.content` (too big), `farm_system.content` (low-value for dashboard), `preview.content` (only needed in HTML), `ticker` (derivable from hero).

**Budget**: each `data.json` ≤ 20 KB. Current payload ≈ 7–8 KB on typical game days.

**Consumers**:
- `/dashboard/` — `fetchIssueData(date)` reads this, hydrates Team Health (from `injury_report.il_entries`), Lineup card (from `lineup.batting_order.home`), Player Focus (from `lineup.starters.home` / `next_game`).
- Future `/dashboard/innings/` will consume the same file for the timeline viz (planned v1.5).

### 3.3 Live snapshot (from `live-feed.js`)

Browser-side polling of MLB Stats API directly:
- `https://statsapi.mlb.com/api/v1/game/<pk>/feed/live`
- `https://statsapi.mlb.com/api/v1/game/<pk>/linescore`

Shape documented in `live-feed.js::buildGameSnapshot()`. Returned object:
```json
{
  "inning": 7, "outs": 2, "half": "Top",
  "teams": { "home": {...}, "away": {...} },
  "detailedState": "In Progress",
  "isFinal": false
}
```

### 3.4 Schema stability rules

- `archive.json` `schema_version` bumps only on breaking changes.
- New fields are additive; consumers must ignore unknown keys.
- The dashboard treats missing fields as "unknown" and degrades gracefully (no hard failures).
- Per-issue `data.json` is additive from `archive.json` — consumers fall back to the entry in archive if the JSON 404s.

---

## 4. Pipeline

```
run.mjs
 └─ crawl.mjs            MLB Stats API + Open-Meteo + fixture → phillies-wire-data.json
 └─ edition sync         Increments edition from archive.json
 └─ enrich.mjs           Claude editorial pass (pull quote + preview), with fallback
 └─ render.mjs           Template engine → latest index + issues/<date> + site/ tree
 └─ verify.mjs           Contract assertions (hero shape, lineup shape, required files)
 └─ deliver.mjs?         Optional SMTP delivery, gated on DELIVERY_RECIPIENTS
```

### 4.1 Triggers

| Trigger | Mode | What runs |
|---|---|---|
| Daily cron `0 13 * * *` UTC | `daily` | Full pipeline: crawl + enrich + render + verify + deliver |
| Game-window cron `*/15` during 16–05 UTC (EDT) and 17–06 UTC (EST) | `live` | crawl + render + verify (skips enrich + deliver) |
| `workflow_dispatch` | `daily` | Full pipeline on demand |

Game-window refresh does **not** spend Anthropic tokens and does **not** email subscribers.

### 4.2 Fallback behavior

- **MLB Stats API unreachable** → reuse previous snapshot from `phillies-wire-data.json`.
- **Open-Meteo unreachable** → omit weather line.
- **Enrich (Anthropic) fails** → fallback pull-quote + preview narrative from `pregame-preview.js`; `enrich_state` in archive becomes `"fallback"`.
- **Render fails on required fields** → pipeline breaks on purpose via `verify.mjs::assertNoUnresolvedTokens()`.

### 4.3 Security

- SMTP requires TLS (`requireTLS: true`).
- GitHub Actions pinned by SHA.
- `ANTHROPIC_API_KEY` unset after the enrich step.
- CSP on every HTML page restricts connect-src to `statsapi.mlb.com` and `api.open-meteo.com` only.
- No inline `<script>` tags except for the embedded JSON-LD block.

---

## 5. Design system

### 5.1 Source of truth

`tokens.css` — three layers:

1. **Primitive palette** — raw values. Never referenced from components.
   - Red (10 steps), Navy (10), Cream (10), Gold (10), Ink neutrals (10), status (green/amber/blue).
2. **Semantic layer** — purpose-named aliases (`--color-text`, `--color-accent`, `--color-surface`). Components reference these only.
3. **Component layer** — per-surface custom properties in `phillies-wire.css` and `dashboard/dashboard.css`.

Rule: never reference `--primitive-*` outside `tokens.css`.

### 5.2 Brand palette

| Token | Hex | Role |
|---|---|---|
| `--primitive-red-500` | `#e81828` | Phillies red — primary accent |
| `--primitive-navy-500` | `#002d72` | Phillies navy — secondary accent |
| `--primitive-gold-500` | `#c4973a` | Phillies gold — tertiary accent, "final" state |
| `--primitive-cream-50` | `#fff9f0` | Light background (if ever used) |
| `--primitive-ink-900` | `#0d0f12` | Primary dark text |

### 5.3 Typography

- **Display** — Oswald / Bangers for titles (dashboard hero numbers, headlines).
- **Serif** — Libre Caslon Text / Playfair for editorial headlines (newsletter hero).
- **Body** — Work Sans / Inter for UI and body text.
- **Mono** — IBM Plex Mono / ui-monospace for pill labels, dates, stats.

### 5.4 Components (cross-surface inventory)

| Component | Where used | Contract |
|---|---|---|
| **Hero card** | `/`, `/dashboard/` | `{ headline, dek, mode_label, badge color by mode }` |
| **Ticker** | `/` | Array of `{ text, highlight }` |
| **Score tile** | `/dashboard/` | `{ phi_runs, opp_runs, opp_abbr, opp_name }` |
| **Activity row** | `/dashboard/` | `{ date, headline, dek, mode }` |
| **Record stat** | `/dashboard/` | `{ wins, losses, streak }` |
| **Lineup card** | `/issues/<date>/` | Array of `{ slot, name, position, bats }` |
| **IL entry** | `/`, `/issues/<date>/` | `{ name, position, il_type, injury, target_return }` |
| **Mode pill** | everywhere | `pregame \| live \| final \| off_day` with color mapping |

---

## 6. URL contract

| URL | Canonical | Crawlable | Notes |
|---|---|---|---|
| `https://davehomeassist.github.io/phillies-wire/` | Yes | Yes | Mirrors latest issue |
| `https://davehomeassist.github.io/phillies-wire/archive/` | Yes | Yes | |
| `https://davehomeassist.github.io/phillies-wire/issues/<date>/` | Yes | Yes | Immutable after day closes |
| `https://davehomeassist.github.io/phillies-wire/dashboard/` | Yes | Yes | `robots: noindex` recommended |
| `https://davehomeassist.github.io/phillies-wire/archive.json` | Yes | No | `Cache-Control: no-store` preferred |
| `https://davehomeassist.github.io/phillies-wire/feed.xml` | Yes | Yes | |

### 6.1 Custom domain (deferred)

Optional v1.5: `wire.daverobertson.net` or `phillies.wire.fyi` via Pages custom-domain CNAME. Not needed until delivery volume grows.

---

## 7. Performance budget

| Metric | Target | Measured on |
|---|---|---|
| First Contentful Paint | ≤ 1.2s | `/` and `/dashboard/` |
| Largest Contentful Paint | ≤ 2.0s | `/` |
| Cumulative Layout Shift | ≤ 0.05 | All pages |
| Total JS (gzipped) | ≤ 30 KB | `/dashboard/` |
| Total CSS (gzipped) | ≤ 12 KB | per page |
| `archive.json` size | ≤ 50 KB per 365 days | Monitor as seasons accumulate |
| Lighthouse Perf | ≥ 95 | `/` |
| Lighthouse A11y | ≥ 95 | `/` and `/dashboard/` |

CI check for these lives in `cicd-deployment` skill pattern — to be added to `publish.yml` as a post-deploy smoke step.

---

## 8. Accessibility requirements

- WCAG 2.1 AA contrast on all text + UI.
- Every interactive element keyboard-reachable in a logical tab order.
- Focus visible by default (no `outline: none` without replacement).
- Every icon-only button has an `aria-label`.
- `lang="en-US"` on every `<html>`.
- Semantic HTML: `<article>`, `<header>`, `<footer>`, `<section>`, `<aside>` used correctly.
- Reduced-motion media query respected (no animations > 200ms without it).

---

## 9. Content policy

- **No hot takes, no opinion pieces.** Facts, stats, schedule, injuries.
- **No fabricated quotes.** The Claude pull-quote is generated from a structured fact set with a fallback; verify.mjs rejects editions where the quote can't be sourced.
- **Attribution:** every MLB fact references MLB Stats API; weather references Open-Meteo. Footer on issues and in feed.xml.
- **No images except brand marks.** Reduces rights complexity. Photos of players would require licensing; stay text + SVG.
- **Off-day editions** are explicitly labeled; they show last game's recap + next game preview only.

---

## 10. Delivery

### 10.1 Web (primary)

GitHub Pages → cached at Fastly edge → readers open at their leisure. ~3-minute publish lag between crawl and live URL on average.

### 10.2 Email (optional)

SMTP via nodemailer. One send per `daily` cron per recipient list. Subject line: "Phillies Wire — <headline>". Body: plain-text digest derived from `hero.summary` + `ticker` text + next game. No images, no HTML email (avoids deliverability / rendering issues).

### 10.3 RSS

Standard RSS 2.0. One `<item>` per dated issue, newest first. Limit last 30 issues to keep feed size small.

### 10.4 Future delivery surfaces

- **iOS widget** — read `archive.json` from the web. WidgetKit poll every 30 min.
- **Home Assistant sensor** — scrape `archive.json` into `sensor.phillies_wire_latest`. Surface in the comic-book dashboard.
- **Stream Deck** — one key showing score + mode color; tap → open dashboard.
- **Kitchen tablet kiosk** — fullscreen `/dashboard/` with no chrome.

---

## 11. Metrics (optional)

Single embedded `<script>` writing to Plausible if hosted on dominic (`plausible.daverobertson.net`). Goals:
- Daily unique visitors to `/`
- Dashboard visits vs issue visits ratio
- Archive depth (which older issues get traffic)
- RSS subscriber count via Plausible outbound-link pixel

Strictly zero third-party tracking beyond Plausible if adopted. No GA, no Facebook pixel.

---

## 12. Roadmap

| Version | Surfaces / features | Blocker |
|---|---|---|
| **1.2.0** (current) | Latest issue, archive, dated issues, RSS, email | — |
| **1.3.0** (this sprint) | `/dashboard/` + per-issue `data.json` | ✅ dashboard shipped; data.json next |
| **1.4.0** | Innings timeline view on `/dashboard/innings/` | Needs per-play data from boxscore |
| **1.5.0** | `/broadcast/` (large-display) + `/editorial/` (weekly recap) | Design iteration |
| **1.6.0** | Weekly recap aggregator at `/recaps/<week>/` | Aggregation script |
| **1.7.0** | Custom domain + Plausible | Optional |

---

## 13. File map (v1.3.0)

```
phillies-wire/
├── index.html                  ← published latest issue (generated)
├── archive.json                ← machine-readable archive (generated)
├── archive/index.html          ← public archive page (generated)
├── issues/<date>/index.html    ← dated issue permalinks (generated)
├── issues/<date>/data.json     ← per-issue machine-readable (v1.3 target, generated)
├── feed.xml                    ← RSS (generated)
├── sitemap.xml                 ← (generated)
├── robots.txt                  ← (generated)
├── manifest.webmanifest        ← (generated)
├── status.json                 ← build heartbeat (generated)
├── favicon.svg                 ← brand mark
├── og-default.svg              ← social preview fallback
├── tokens.css                  ← design tokens source of truth
├── phillies-wire.css           ← newsletter styles
├── fonts.css                   ← @font-face declarations
├── fonts/                      ← WOFF2 files
├── live-feed.js                ← browser-side live score poller
├── pregame-preview.js          ← enrich fallback narrator
├── dashboard/
│   ├── index.html              ← Clean SaaS command center
│   ├── dashboard.css           ← dashboard styles (reuses tokens.css)
│   └── dashboard.js            ← reads ../archive.json
├── docs/
│   └── SPEC.md                 ← this file
├── scripts/
│   ├── lint.mjs                ← node --check syntax scan
│   └── health-check.mjs        ← cron-friendly staleness probe
├── test/                       ← render engine + verify tests (33 tests)
├── config.mjs                  ← TEAM_ID, VENUE, API base, CLAUDE_MODEL, etc.
├── crawl.mjs                   ← ~1400 LoC: MLB + weather + fixture
├── enrich.mjs                  ← ~400 LoC: Claude editorial pass
├── render.mjs                  ← ~840 LoC: template engine + site/
├── verify.mjs                  ← ~260 LoC: output contract assertions
├── deliver.mjs                 ← ~100 LoC: SMTP
├── run.mjs                     ← ~150 LoC: orchestrator
├── package.json
├── package-lock.json
├── .github/workflows/publish.yml
├── overrides/                  ← editorial override files (rare)
├── README.md
├── HANDOFF.md
└── phillies-wire-schema.json   ← full example payload (v1.2.0)
```

---

## 14. Open questions / decisions pending

1. **Per-issue `data.json` — include `recap.content` and `preview.content`?** Leaning no (kept in HTML only, not dashboard-useful) but open.
2. **Dashboard polling cadence** — currently none (loads once). Should it poll `archive.json` every 60s + MLB live-feed during game windows?
3. **Custom domain** — `wire.daverobertson.net` vs stay on `*.github.io`?
4. **Plausible** — adopt or stay zero-analytics?
5. **Broadcast view** — real need or nice-to-have? Only build if a tablet or TV display is actually being set up.

Close these in the next planning pass, not now.

---

## 15. References

- `README.md` — how to run locally
- `HANDOFF.md` — operational playbook
- `phillies-wire-schema.json` — full example payload
- [MLB Stats API docs](https://statsapi.mlb.com/docs/)
- [Open-Meteo docs](https://open-meteo.com/en/docs)
- Gemini mockups (in `00-inbox/phillies-ticker-poc/` reference material)
