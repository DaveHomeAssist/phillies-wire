# Phillies Wire

A daily Philadelphia Phillies newsletter — standalone web page, Notion-embeddable, and Home Assistant Lovelace compatible.

**Built:** March 28, 2026  
**Version:** 1.0.0  
**Stack:** Vanilla HTML · CSS custom properties · Zero dependencies

---

## Project structure

```
phillies-wire/
├── tokens.css                  ← Design tokens. The only file containing hex values.
├── phillies-wire.css           ← Component styles. All pw- prefixed. Consumes tokens only.
├── phillies-wire-v2.html       ← Template. Links both CSS files. Add {{tokens}} for rendering.
├── phillies-wire-schema.json   ← Data payload shape. Today's real data as reference.
├── README.md                   ← This file.
└── HANDOFF.md                  ← Agent handoff — next steps, open items, pipeline spec.
```

**Not yet built (pipeline scripts — see HANDOFF.md):**
```
├── crawl.mjs      ← Stage 1: MLB Stats API + Open-Meteo → raw JSON
├── enrich.mjs     ← Stage 2: raw JSON + Claude API → enriched JSON
└── render.mjs     ← Stage 3: enriched JSON + template → output HTML
```

---

## Design system

### Fonts
- **Barlow Condensed** — masthead, section labels, UI elements (display layer)
- **Inter** — body copy, info rows, player details (reading layer)
- Loaded via Google Fonts. Email fallback: system sans-serif.

### Color architecture — 3 tiers

```
Primitive tokens          →    Semantic tokens          →    Component usage
--primitive-red-500            --color-brand-red             var(--color-brand-red)
--primitive-navy-500           --color-mast-bg               var(--color-mast-bg)
--primitive-cream-50           --color-bg                    var(--color-bg)
```

- **Primitives** — raw brand values, 5 ramps × 7 stops. Never referenced directly in components.
- **Semantic layer** — maps primitives to roles (`--color-accent`, `--color-il-bg`, etc.).
- **Component layer** — `phillies-wire.css` consumes semantic tokens only. Zero raw hex values.

### Dark mode
- `@media (prefers-color-scheme: dark)` — OS preference (default)
- `[data-theme="dark"]` on `<html>` — manual toggle (wiring not yet implemented)
- All badge colors, surfaces, and text flip correctly in dark mode.

### Spacing
4px base unit. Scale: `--space-1` (4px) through `--space-12` (48px).

### Badge types
| Class | Meaning | Color |
|---|---|---|
| `pw-badge--il` | 15-Day or 60-Day IL | Red |
| `pw-badge--dtd` | Day-to-day / minor IL | Amber |
| `pw-badge--active` | On active roster | Green |
| `pw-badge--new` | New signing / MiLB | Blue |
| `pw-badge--rehab` | On rehab assignment | Amber |

---

## Layout

**Pattern:** Ticker + Accordion  
**Max-width:** 640px (email-safe, Notion-friendly, HA iframe-compatible)  
**Sections:** Game Status · Thursday Recap · Roster & Lineup · Injury Report · Farm System · Preview

### Accordion behavior
- Single-open — clicking a row collapses any open row before expanding the new one.
- Preview text (closed state) hidden when row is open.
- Red dot indicator appears on the active row title.
- `aria-expanded` toggled on `<button>` headers for accessibility.
- Smooth scroll-to on open.

### Ticker
- Infinite scroll loop via duplicated content + CSS animation (`pw-ticker-scroll`, 22s).
- Pauses on hover.
- `pw-ticker-item--highlight` class for white-colored emphasis items.

---

## Embed compatibility

### Notion
Drop the hosted URL into a `/embed` block. No fixed positioning, no overflow issues, clean reflow at any width Notion renders.

### Home Assistant Lovelace
```yaml
type: iframe
url: https://your-netlify-url.netlify.app/phillies-wire-output.html
aspect_ratio: 75%
```

### Netlify deploy
Drag and drop the output folder to Netlify drop, or:
```bash
netlify deploy --dir . --prod
```

---

## Data pipeline (not yet implemented)

See `HANDOFF.md` for full spec. Short version:

```
crawl.mjs → phillies-wire-data.json → enrich.mjs → Claude API → render.mjs → phillies-wire-output.html
```

Data sources:
- `statsapi.mlb.com` — game status, rosters, injuries, transactions (free, no auth)
- `open-meteo.com` — weather at CBP lat/lon 39.906, -75.166 (free, no key)
- `milb.com` — farm system (affiliate endpoint via Stats API)

---

## Open items

- [ ] Add `{{token}}` placeholders to `phillies-wire-v2.html` for render script
- [ ] Write `crawl.mjs`
- [ ] Write `enrich.mjs` (Claude API call, QA checkpoint)
- [ ] Write `render.mjs` (template population + array stamping)
- [ ] Add `.pw-section-label--spaced` utility class to `phillies-wire.css`
- [ ] Add `[data-theme]` toggle button + 2-line JS
- [ ] Set up daily cron (launchd on Mac or GitHub Actions)
- [ ] Return to email newsletter build (table-based layout pass)

---

## Notion references

- **LLM Conversation Log:** https://www.notion.so/331255fc8f44814483d4d11fd2703f68  
- **Pipeline Spec page:** https://www.notion.so/331255fc8f44818ea2baf23a71c91645  
- **Code Dashboard — LIVE:** https://www.notion.so/331255fc8f44819d9d88c8ef21105082
