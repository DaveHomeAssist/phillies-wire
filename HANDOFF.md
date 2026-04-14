# HANDOFF.md — Phillies Wire

**Date:** 2026-03-28  
**Phase complete:** CSS design system + JSON schema + pipeline spec  
**Handed to:** Codex (or next Claude session)  
**Notion pipeline spec:** https://www.notion.so/331255fc8f44818ea2baf23a71c91645

**Latest changes:** See the README "What's new" section and the commit log on branch `claude/add-phillies-lineup-*`. This handoff document reflects the initial architecture; the current pipeline ships SEO metadata, a game-day lineup section, live-injury merging, archive search, prev/next navigation, a share bar, theme persistence, reduced-motion support, and an accessibility pass that wraps content in semantic landmarks.

---

## What exists right now

| File | Status | Notes |
|---|---|---|
| `tokens.css` | ✅ Complete | Do not edit manually. Brand primitives → semantic layer → both modes. |
| `phillies-wire.css` | ✅ Complete | One cleanup item: inline `style="margin-top:16px"` on some section labels. |
| `phillies-wire-v2.html` | ✅ Complete (static) | Has real data hardcoded. Needs `{{token}}` placeholders for pipeline. |
| `phillies-wire-schema.json` | ✅ Complete | Today's full data payload. Use as schema reference and test fixture. |
| `crawl.mjs` | ❌ Not built | Stage 1 — see spec below. |
| `enrich.mjs` | ❌ Not built | Stage 2 — see spec below. |
| `render.mjs` | ❌ Not built | Stage 3 — see spec below. |

---

## Immediate next tasks — in order

### Task 1 — Add `{{token}}` placeholders to `phillies-wire-v2.html`

Replace all hardcoded data values in the HTML with `{{json.path}}` tokens. The render script will do a find-and-replace pass on these. Example:

```html
<!-- Before -->
<div class="pw-record-num">1–0</div>

<!-- After -->
<div class="pw-record-num">{{record.wins}}–{{record.losses}}</div>
```

Dynamic list sections (ticker, IL entries, rotation cards, player rows, up-next rows) need fragment templates — a single repeated block stamped per array item. Mark these with `{{#each sections.injury_report.content.il_entries}}...{{/each}}` or equivalent syntax you prefer.

Full token map is at the bottom of this file.

---

### Task 2 — Write `crawl.mjs`

Fetches from MLB Stats API and Open-Meteo. Writes `phillies-wire-data.json`.

**MLB Stats API base:** `https://statsapi.mlb.com/api/v1`  
**PHI team ID:** 143  
**CBP coords:** lat 39.906, lon -75.166

```js
// Endpoints needed
const SCHEDULE     = `/schedule?sportId=1&teamId=143&date=${TODAY}`;
const GAME_BOXSCORE = `/game/${gamePk}/boxscore`;   // run post-game only
const INJURIES     = `/injuries?teamId=143`;
const ROSTER       = `/teams/143/roster?rosterType=active`;
const TRANSACTIONS = `/transactions?teamId=143&startDate=${YESTERDAY}&endDate=${TODAY}`;
const WEATHER      = `https://api.open-meteo.com/v1/forecast?latitude=39.906&longitude=-75.166&current=temperature_2m,wind_speed_10m,wind_gusts_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph`;
```

**QA checkpoint A** (before writing output):
- Required keys present: `meta`, `record`, `ticker`, `sections` (all 6 keys)
- `sections.game_status.content.starters` both non-null
- `sections.injury_report.content.il_entries` is an array (can be empty)
- `meta.date` matches today's date (ISO format)
- If validation fails: write error to `crawl-error.log`, exit with code 1

---

### Task 3 — Write `enrich.mjs`

Reads `phillies-wire-data.json`, sends editorial fields to Claude API, writes enriched JSON back to `phillies-wire-data.json`.

**Model:** `claude-sonnet-4-20250514`  
**Max tokens:** 2000

```js
const SYSTEM = `You are a beat reporter for the Philadelphia Phillies. 
Write in a clear, confident, non-academic voice. 
No hyphens in prose. No em dashes under any circumstances. 
Imperative mood in section previews.

Return ONLY valid JSON matching the exact input schema. 
Do not add keys. Do not wrap in markdown. Do not include preamble.`;

const USER = `Enrich the following fields with editorial copy. 
Leave all structured fields (scores, times, names, badge values) exactly as provided.
Write only to these targets:
- sections.recap.content.pull_quote
- sections.preview.content.narrative (array of 2–3 paragraphs)  
- sections.preview.content.pull_quote
- ticker (reorder or rewrite highlight items for editorial punch)

Raw payload:
${JSON.stringify(data, null, 2)}`;
```

**QA checkpoint B** (before writing output):
- Response parses as valid JSON — if not, log raw response and exit code 1
- Schema keys unchanged — no additions or deletions from the input shape
- `pull_quote` fields are non-empty strings
- `narrative` is array of 2–3 non-empty strings
- Zero em dashes in any string value (regex: `/—/g`)
- Player names and scores match Stage 1 payload (cross-reference before writing)

---

### Task 4 — Write `render.mjs`

Reads enriched `phillies-wire-data.json`, stamps into `phillies-wire-v2.html` template, writes `phillies-wire-output.html`.

```js
import { readFileSync, writeFileSync } from 'fs';

const data     = JSON.parse(readFileSync('./phillies-wire-data.json', 'utf8'));
const template = readFileSync('./phillies-wire-v2.html', 'utf8');

const output = populate(template, data);
writeFileSync('./phillies-wire-output.html', output);
console.log('✅ phillies-wire-output.html written');
```

`populate(template, data)`:
1. Replace all `{{dot.path}}` tokens with resolved values from data object.
2. For each `{{#each array}}...{{/each}}` block, stamp one copy of the inner fragment per array item, substituting `{{this.field}}` within each copy.
3. Return the rendered string.

`phillies-wire-output.html` should be gitignored — it is regenerated daily.

---

### Task 5 — Add `.pw-section-label--spaced` to `phillies-wire.css`

One inline style remains in the HTML:

```html
<div class="pw-section-label" style="margin-top:16px;">
```

Add to `phillies-wire.css`:

```css
.pw-section-label--spaced {
  margin-top: var(--space-4);
}
```

Then replace all instances in the HTML with `class="pw-section-label pw-section-label--spaced"`.

---

### Task 6 — Add dark mode toggle

Add to `phillies-wire-v2.html` near the footer:

```html
<button class="pw-theme-toggle" onclick="toggleTheme()" aria-label="Toggle dark mode">
  Dark
</button>
```

Add to `phillies-wire.css`:

```css
.pw-theme-toggle {
  font-family:    var(--font-display);
  font-weight:    var(--weight-bold);
  font-size:      var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  padding:        var(--space-1) var(--space-3);
  border:         1px solid var(--color-border-mid);
  border-radius:  var(--radius-md);
  background:     transparent;
  color:          var(--color-text-muted);
  cursor:         pointer;
}
```

Add to script block:

```js
function toggleTheme() {
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === 'dark' ? '' : 'dark';
}
```

---

## Token map — `phillies-wire-v2.html` placeholder targets

| HTML location | Token | JSON path |
|---|---|---|
| Masthead pub date | `{{meta.date}}` | `meta.date` |
| Masthead edition | `Vol. {{meta.volume}} · No. {{meta.edition}}` | `meta.volume`, `meta.edition` |
| Record block | `{{record.wins}}–{{record.losses}}` | `record.wins`, `record.losses` |
| Ticker items | `{{#each ticker}}` | `ticker[]` |
| Game Status — matchup | `{{sections.game_status.content.matchup}}` | |
| Game Status — first pitch | `{{sections.game_status.content.first_pitch}}` | |
| Game Status — venue | `{{sections.game_status.content.venue}}` | |
| Game Status — starters | `{{sections.game_status.content.starters.home.name}} vs {{...away.name}}` | |
| Game Status — series | `{{sections.game_status.content.series.label}}` | |
| Game Status — broadcast | `{{...broadcast.tv}} · {{...broadcast.stream}} · {{...broadcast.radio}}` | |
| Game Status — weather | `{{...weather.temp_f}}° · {{...weather.condition}} · {{...weather.wind}}` | |
| Game Status — giveaway | `{{sections.game_status.content.giveaway}}` | |
| Game Status — transit | `{{sections.game_status.content.transit}}` | |
| Recap — result | `{{sections.recap.content.result.home_score}}, TEX {{...away_score}}` | |
| Recap — performers | `{{#each sections.recap.content.key_performers}}` | |
| Recap — pull quote | `{{sections.recap.content.pull_quote}}` | ← Claude writes this |
| Roster — rotation | `{{#each sections.roster.content.rotation}}` | |
| Roster — highlights | `{{#each sections.roster.content.highlights}}` | |
| Injury — entries | `{{#each sections.injury_report.content.il_entries}}` | |
| Injury — footer | `{{sections.injury_report.content.footer_note}}` | |
| Farm — affiliate | `{{sections.farm_system.content.affiliate.name}}` etc | |
| Farm — names | `{{#each sections.farm_system.content.names_to_watch}}` | |
| Preview — narrative | `{{#each sections.preview.content.narrative}}` | ← Claude writes this |
| Preview — pull quote | `{{sections.preview.content.pull_quote}}` | ← Claude writes this |
| Preview — up next | `{{#each sections.preview.content.up_next}}` | |
| Next game strip | `{{next_game.matchup}}`, `{{next_game.date}}`, `{{next_game.time}}`, `{{next_game.broadcast}}` | |
| Footer | `Vol. {{meta.volume}} · No. {{meta.edition}} · {{meta.date}}` | |

---

## CSS class reference — `pw-` prefix

| Class | Role |
|---|---|
| `pw-page` | Outer wrapper, max-width 640px |
| `pw-masthead` | Navy header block |
| `pw-mast-pub` | Publication name (Barlow Condensed 32px) |
| `pw-mast-sub` | Edition/date sub-label |
| `pw-mast-record` | Red record block (top-right) |
| `pw-ticker` | Scrolling ticker bar |
| `pw-ticker-item` | Individual ticker item |
| `pw-ticker-item--highlight` | White-colored ticker emphasis |
| `pw-ticker-sep` | Red diamond separator |
| `pw-red-rule` | 3px red horizontal rule |
| `pw-accordion` | Accordion container |
| `pw-acc-row` | Single accordion section |
| `pw-acc-row--open` | Open state modifier |
| `pw-acc-header` | `<button>` click target |
| `pw-acc-title` | Section label (Barlow Condensed) |
| `pw-acc-dot` | Red dot, visible when open |
| `pw-acc-preview` | One-line preview, hidden when open |
| `pw-acc-chevron` | Arrow, rotates 180° when open |
| `pw-acc-body` | Expandable content area |
| `pw-section-label` | Red all-caps category label |
| `pw-body` | Body paragraph |
| `pw-body--strong` | Bold inline span |
| `pw-pull` | Pull quote (red left border) |
| `pw-info-row` | Key-value row |
| `pw-info-label` | Left label (Barlow Condensed, faint) |
| `pw-info-value` | Right value (Inter, medium) |
| `pw-player-row` | Player entry row |
| `pw-player-name` | Player name (semibold) |
| `pw-player-detail` | Sub-detail (small, muted) |
| `pw-badge` | Base badge class |
| `pw-badge--il` | Red — IL |
| `pw-badge--dtd` | Amber — DTD / minor |
| `pw-badge--active` | Green — active |
| `pw-badge--new` | Blue — new/MiLB |
| `pw-badge--rehab` | Amber — rehab |
| `pw-rotation-grid` | 3-col CSS grid for rotation cards |
| `pw-rot-card` | Single rotation card |
| `pw-next-game` | Navy footer strip |
| `pw-footer` | Bottom meta bar |

---

## Notion references

- **LLM Conversation Log:** https://www.notion.so/331255fc8f44814483d4d11fd2703f68
- **Pipeline Spec (Notion):** https://www.notion.so/331255fc8f44818ea2baf23a71c91645
- **Code Dashboard — LIVE:** https://www.notion.so/331255fc8f44819d9d88c8ef21105082
