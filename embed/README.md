# Phillies Wire embeds

Self contained iframe embeds that read from `latest.json` at the root of this site. Landed as Upgrade 4 of the Wire + Schedule + Quest unification plan.

## `ticker.html`
Compact ticker card. Four runtime states: pregame, live, final, off day. One error state. Min width 320px. No external dependencies.

### Query params
- `feed` — override the JSON feed URL. Default `../latest.json`.
- `theme` — `light` or `dark`. Default dark.

### Embed example
```html
<iframe
  src="https://davehomeassist.github.io/phillies-wire/embed/ticker.html"
  width="360" height="120" frameborder="0" scrolling="no"
  title="Phillies Wire ticker"></iframe>
```

### Data contract
Consumes the curated payload produced by `render.mjs -> buildLatestPayload`:
- `mode` (pregame, live, final)
- `off_day`
- `hero.next_label`, `hero.next_value`
- `game.matchup`, `game.first_pitch`, `game.venue`, `game.starters`, `game.score`, `game.inning`, `game.situation`, `game.recap_line`

If the schema changes, the ticker falls back gracefully: missing fields render as empty strings; unknown modes fall back to pregame rendering.
