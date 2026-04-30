# Phillies Wire — Fact-Check System

Daily automated fact-checker for the Wire. Blocks publish on render bugs or factual errors; files a Notion report every run; emails on errors.

## What it does

Three check layers:

1. **Deterministic (offline, sync)** — run in-process by `verify.mjs` as a pre-publish gate.
   - Edition date stale
   - Unresolved `{{template tokens}}` in rendered HTML
   - Duplicate weather/conditions strip
   - NL East standings math reconciliation
   - "opens tonight" / SEPTA time / giveaway date cross-consistency
   - "veteran" label misapplied (<1 yr MLB service)
   - Dashboard empty-slot heuristic (≥5 em-dash data slots)

2. **Source-verified (async, network)** — daily scheduled run only.
   - Previous-day final score vs. MLB Stats API box score
   - Starter pitching line vs. MLB Stats API
   - Standings W/L vs. MLB Stats API
   - Recent IL transactions vs. Wire injury list

3. **Output** — Markdown report in `reports/factcheck-YYYY-MM-DD.md`, upserted Notion row, email on any errors/stale/pipeline findings.

## Files

| File | Purpose |
|------|---------|
| `factcheck.mjs` | Checker script — daily entry point + exportable pre-publish surface |
| `factcheck-whitelist.json` | Editorial accepts (IDs to suppress re-flagging) |
| `reports/` | Generated Markdown reports (gitignored) |
| `docs/FACTCHECK.md` | This file |

## Modes

```bash
# Daily full run (scheduled)
node factcheck.mjs

# Pre-publish gate — deterministic only, exit 1 on errors/pipeline issues
node factcheck.mjs --pre-publish

# Dry run — no Notion, no email
FACTCHECK_DRY_RUN=1 node factcheck.mjs
```

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `NOTION_API_KEY` | for Notion | Integration token with access to `SFT \| Phillies-Wire` page |
| `FACTCHECK_DS_ID` | optional | Override Notion data source (default baked in) |
| `FACTCHECK_RECIPIENTS` | for email | Comma-separated. Falls back to `DELIVERY_RECIPIENTS` |
| `SMTP_USER` / `SMTP_PASS` | for email | Reuses `deliver.mjs` config |
| `SMTP_HOST` / `SMTP_PORT` | optional | Defaults to `smtp.gmail.com:587` |
| `FACTCHECK_DRY_RUN` | optional | Set to `1` to skip side effects |

Notion DB: `DB | Wire Fact-Check Reports` under `SFT | Phillies-Wire` page.
Data source ID: `f67f24d7-9acf-4598-8a8b-6c74a61ae7bb`.

## Integration with verify.mjs (blocks publish)

Add near the bottom of `verify.mjs`, after all existing assertions:

```js
// FILE: verify.mjs (append)
import { runFactcheck } from "./factcheck.mjs";

const fc = await runFactcheck({ mode: "pre-publish" });
if (fc.findings.errors.length > 0 || fc.findings.pipeline.length > 0) {
  console.error(`[VERIFY] factcheck blocked publish: ${fc.findings.errors.length} errors, ${fc.findings.pipeline.length} pipeline issues`);
  for (const f of [...fc.findings.errors, ...fc.findings.pipeline]) {
    console.error(`  - ${f.title}`);
  }
  process.exit(1);
}
if (fc.findings.stale.length > 0) {
  console.warn(`[VERIFY] factcheck warnings: ${fc.findings.stale.length} stale — not blocking`);
}
```

## Integration with run.mjs (post-publish daily log)

Call `factcheck.mjs` as a post-publish step so every edition logs to Notion:

```js
// FILE: run.mjs (append after deliver step)
await runStep("factcheck", () => execNode("factcheck.mjs"));
```

Or invoke directly from GitHub Actions:

```yaml
# .github/workflows/publish.yml
- name: Fact-check
  run: node factcheck.mjs
  env:
    NOTION_API_KEY: ${{ secrets.NOTION_API_KEY }}
    FACTCHECK_RECIPIENTS: daverobertson9353@gmail.com
    SMTP_USER: ${{ secrets.SMTP_USER }}
    SMTP_PASS: ${{ secrets.SMTP_PASS }}
```

## Gitignore

Add to `.gitignore`:

```
reports/
```

## Whitelist editorial decisions

If a finding is valid-but-intentional (e.g. you DO want to call a specific player "veteran" even with <1 yr service), add its `id` to `factcheck-whitelist.json`:

```json
{
  "editorial_accepts": ["veteran-label-JohnDoe"]
}
```

IDs appear in every report — copy them from there.

## Production-ready checklist

- [x] Script handles missing local artifacts gracefully
- [x] SMTP credentials redacted in errors (pattern inherited from deliver.mjs)
- [x] Notion upsert failure does not crash the script
- [x] Email failure does not crash the script
- [x] Dry-run mode for local testing
- [x] Exportable pre-publish surface
- [x] Whitelist mechanism for editorial decisions
- [ ] **GAP:** No GitHub Secret `NOTION_API_KEY` yet — create at github.com/DaveHomeAssist/phillies-wire/settings/secrets/actions
- [ ] **GAP:** `verify.mjs` integration snippet not yet applied (see above)
- [ ] **GAP:** `run.mjs` integration snippet not yet applied (see above)
- [ ] **GAP:** `.gitignore` does not list `reports/` yet
- [ ] **GAP:** Scheduled task is configured in Cowork, not in GitHub Actions — if the scheduled task ever goes offline, add a workflow_dispatch job as backup
