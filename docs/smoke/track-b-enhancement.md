# Smoke evidence — Track B design enhancement (pw-enhance.css)

**Captured:** 2026-06-25 · edition 86 (pregame, PHI @ WSH)
**Pipeline:** `crawl → factcheck --export-accuracy → render → verify` exit 0; `npm test` 18/18 suites pass.

This file is the durable smoke record for the "Liberty Bell / broadsheet" enhancement
layer. No browser/screenshot tooling is wired in this repo, so the evidence is the
rendered markup pulled from the generated `index.html` plus the dark-mode / reduced-motion
CSS coverage that drives the two themes off one document.

## Masthead — Liberty Bell + gazette dateline

```html
<svg class="pwx-bell" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">
  <rect x="22" y="4" width="4" height="4" rx="1"/>
  <path d="M24 8c-6.5 0-10.5 4.8-11.6 13.2C11.5 27.6 10.4 31 8 33h32c-2.4-2-3.5-5.4-4.4-11.8C34.5 12.8 30.5 8 24 8z"/>
  <path class="pwx-bell-crack" d="M24 13l-3.2 5.5 3.2 3.4-3.2 5.5 2.4 4.1"/>
</svg>
<span class="pw-mast-pub">Phillies Wire</span>
...
<div class="pwx-gazette-items">
  <span class="pwx-gazette-item">Philadelphia</span>
  <span class="pwx-gazette-item pwx-gazette-item--gold">Ring the Bell</span>
  <span class="pwx-gazette-item">Est. 2026</span>
</div>
```

## Hero — Tale of the Tape (live pipeline data)

```
away  PHI · Cristopher Sánchez · LHP · ERA 1.80 · W-L 9-3 · WHIP 1.09
 vs
home  WSH · Cade Cavalli       · RHP · ERA 4.07 · W-L 4-4 · WHIP 1.46
```

Sourced from `sections.game_status.content.matchup_tape` (built by `fetchPitcherStats`).
The whole block is omitted via `{{#if}}` when either starter is TBD; missing stats render
as an em dash.

## Light + dark

One document serves both themes. Light is the default semantic layer; dark activates on
`[data-theme="dark"]` (user toggle, persisted in `localStorage`) and
`@media (prefers-color-scheme: dark)`. `pw-enhance.css` carries explicit dark handling
(e.g. `.pwx-mu-name` flips to `--primitive-navy-100` so the pitcher names stay legible on
the dark surface) and a `prefers-reduced-motion: reduce` guard that disables the bell ring.

## Contract checks (verify.mjs)

- `pw-enhance.css` + `fonts.css` present (root + `site/`) and linked in the render.
- No `fonts.googleapis.com` anywhere (fonts self-hosted, archive sub-page migrated).
- Existing assertions intact: hero/lineup shape, no unresolved `{{tokens}}`, mojibake scan
  (0 hits across the new markup), SEO/a11y tags, accuracy scorecard reconciliation.
- Track A regression guards (transit↔venue, roster-chip↔lineup) still pass.
