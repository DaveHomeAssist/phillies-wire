# Phillies Wire — Runbook

Operational reference for running the daily pipeline, debugging failures, and recovering from misses. Companion to `CLAUDE.md` (architecture + rules), `HANDOFF.md` (historical context), and `docs/SPEC.md` (site contract). This file is for the moments when something is wrong and you need to fix it.

## Pipeline at a glance

```
┌─ daily (morning publish) ─────────────────────────────────────────┐
│  crawl → enrich → render → verify → deliver                       │
│          (Claude)                  (hard gate)  (opt-in email)    │
└───────────────────────────────────────────────────────────────────┘

┌─ live (game-window refresh, every ~15 min during games) ──────────┐
│  crawl → render → verify                                          │
│  (no enrich — would regenerate editorial and burn tokens)         │
│  (no deliver — would spam subscribers every interval)             │
└───────────────────────────────────────────────────────────────────┘
```

All stages are Node ESM scripts orchestrated by `run.mjs`. Each stage is a separate process; stage exit codes propagate — any non-zero halts the pipeline.

## Running the pipeline

### Daily (default)

```bash
# Full pipeline, includes enrich + (optional) email delivery
node run.mjs
```

Behavior:
- Crawls MLB Stats API + Open-Meteo
- Assigns Vol/No metadata post-crawl (new day → edition+1; new year → volume+1, edition=1; same day re-run → reuses existing Vol/No)
- Calls `enrich.mjs` with `ANTHROPIC_API_KEY` in env
- Renders, verifies
- Delivers email only if `DELIVERY_RECIPIENTS` is set; otherwise skips cleanly

### Live (game-window refresh)

```bash
ISSUE_MODE=live node run.mjs
```

Behavior:
- Crawl only — **does not re-run Claude editorial** (preserves morning copy)
- Renders, verifies
- Delivery is always skipped (live mode does not email)

### Single stage (debugging)

```bash
node crawl.mjs    # or enrich.mjs, render.mjs, verify.mjs, deliver.mjs
```

Stages read/write state files in the repo root; you can run them standalone as long as their inputs exist. Typical chain for targeted debugging:

```bash
node crawl.mjs                    # produces phillies-wire-data.json
node enrich.mjs                   # needs ANTHROPIC_API_KEY
node render.mjs                   # produces phillies-wire-output.html + site/
node verify.mjs                   # throws on contract violations
```

## Stage reference

| Stage | Reads | Writes | Can fail because |
|---|---|---|---|
| `crawl.mjs` | MLB Stats API, Open-Meteo, `overrides/*.json`, `samples/issue-1.2.0.sample.json` (fixture baseline) | `phillies-wire-data.json`, `crawl-error.log` | API timeout, schedule endpoint change, rate limit |
| *(edition sync)* | `phillies-wire-data.json`, `archive.json` | `phillies-wire-data.json` (Vol/No stamped in) | Missing `meta.date` in data |
| `enrich.mjs` | `phillies-wire-data.json`, `ANTHROPIC_API_KEY` env | `phillies-wire-data.json` (editorial copy merged in), `enrich-error.log` | Anthropic rate limit, missing key, quota exhausted |
| `render.mjs` | `phillies-wire-data.json`, `phillies-wire-v2.html` template, static asset dirs | `phillies-wire-output.html`, `site/**`, `latest.json`, `archive.json`, `status.json`, `calendar/phillies-2026-all.ics` | Unresolved template token, mojibake in copy |
| `verify.mjs` | All rendered artifacts | Nothing (assertion-only) | See **Debugging verify.mjs** below |
| `deliver.mjs` | `phillies-wire-output.html`, `tokens.css`, `phillies-wire.css`, SMTP env | Outbound email | Missing `SMTP_USER`/`SMTP_PASS`, SMTP auth failure, TLS handshake |

## Environment variables

| Variable | Stage | Required | Purpose |
|---|---|---|---|
| `ISSUE_MODE` | `run.mjs` | no | `daily` (default) or `live` |
| `ANTHROPIC_API_KEY` | `enrich.mjs` | daily mode | Claude editorial pass |
| `DELIVERY_RECIPIENTS` | `deliver.mjs` | no | Comma-separated recipients; unset = skip delivery |
| `SMTP_USER` | `deliver.mjs` | if delivering | SMTP auth + `From:` address |
| `SMTP_PASS` | `deliver.mjs` | if delivering | SMTP auth password (Gmail: app password) |
| `SMTP_HOST` | `deliver.mjs` | no | Defaults to `smtp.gmail.com` |
| `SMTP_PORT` | `deliver.mjs` | no | Defaults to `587` (STARTTLS). `465` → implicit TLS |

**Secret scoping:** `run.mjs` deletes `ANTHROPIC_API_KEY` from the env before running any stage except `enrich.mjs`, and deletes `SMTP_USER`/`SMTP_PASS` except for `deliver.mjs`. A buggy unrelated stage cannot exfiltrate secrets it doesn't need.

## Debugging verify.mjs failures

`verify.mjs` is the hard gate before publish. It asserts:

- Per-issue `data.json` contract (schema shape + required keys)
- Canonical schedule JSON at `data/phillies-2026.json`
- Season calendar copy (`calendar/phillies-2026-all.ics`)
- `latest.json` schema + **26-hour freshness gate** (cron cadence 24h + 2h grace — see `verify.mjs:414`)
- Ticker embed has all four required render functions + iframe safety (no external `src=`, no top-window access)
- System-reminder injection guard (template tokens cannot resolve to a system-reminder payload)
- Mojibake scan (no `Â·`, `Â°`, `â€"`, etc. in rendered HTML)
- SEO / accessibility tags (title, meta description, `<html lang>`, landmark elements)

### When verify fails, check in this order:

1. **What assertion fired?** `verify.mjs` prints the specific failure. Jump to that file.
2. **`latest.json` freshness gate tripped?** Check `latest.json.generated_at`. If >26h old, the last daily run missed. See **Recovering from a missed cron** below.
3. **Unresolved template token?** Open `phillies-wire-output.html` and grep for `{{`. A token like `{{foo.bar}}` means `data.foo.bar` was undefined. Trace back to `render.mjs` logic or a missing crawl field.
4. **Schema violation?** Check which sample the assertion uses. Currently `samples/issue-1.2.0.sample.json`. If the current per-issue format has moved on (it's at `1.3.0` as of 2026-04-24), the fixture may be stale; see the samples restructure follow-up.
5. **Mojibake?** The source is almost always UTF-8 → Latin-1 round-trip in a copy/paste of editorial text. Re-crawl to restore the API source, or edit the override file in place.

## Common failure modes + recovery

### Cron didn't run this morning

```bash
# Re-run manually from the repo root
node run.mjs

# Confirm it landed
curl -s https://davehomeassist.github.io/phillies-wire/latest.json | jq '.generated_at, .edition, .edition_date'
```

If the edition date is stale in production but the local run succeeded, it's a deploy problem, not a pipeline problem — check the GitHub Actions run for `publish.yml`.

### Anthropic API failed mid-enrich

`enrich.mjs` writes to `enrich-error.log`. If the error is transient (rate limit, brief outage):

```bash
# Retry the failed stage and downstream stages only
node enrich.mjs
node render.mjs
node verify.mjs
# Don't re-crawl — you'd overwrite the morning's snapshot
```

If the error is persistent (quota, bad key), the fallback is **do not enrich this edition**. Skip enrich and let render produce the edition with baseline fixture copy. It's uglier but it ships.

```bash
# Run the daily pipeline minus enrich
ISSUE_MODE=live node run.mjs
```

Caveat: `ISSUE_MODE=live` also skips delivery. If you want the edition to deliver without enrich, call the stages individually.

### verify.mjs trips on freshness, live site is actually fresh

The committed `latest.json` in the repo was deleted in the `chore/ignore-committed-latest-json` PR (2026-04-24). If you're seeing a freshness failure against a tracked copy, you're on a branch that predates the cleanup — rebase on main.

### SMTP delivery failed

`deliver.mjs` prints a redacted error (SMTP user/password are scrubbed from the message before stdout). Common causes:

- Gmail app password rotated or revoked → regenerate in Google Account → Security → App Passwords
- SMTP_USER/SMTP_PASS not in the runtime env (launchd plist, GitHub Actions secret, local shell)
- Gmail "Less Secure Apps" toggled off — use an app password, not the account password
- Email landed but subscriber reports they didn't get it → check spam; Gmail occasionally classes bulk personal mailings as spam

Delivery not sending is **not** a verify failure — the edition still publishes to Pages. Email is opt-in.

### Archive snapshot commit silently failed

Per a 2026-04-20 fix (`ab0ad55`), the publish workflow **deploys first, then persists the archive commit** with `continue-on-error: true` and 3-attempt retry. This means the archive commit can fail silently without blocking the user-facing deploy.

If the archive is drifting behind production (edition in `archive.json` doesn't match edition in live `latest.json`):

```bash
# Pull the archive snapshot that production wrote but the repo didn't
git pull --rebase
# If local modifications conflict, stash them first
git stash
git pull --rebase
git stash pop
```

If the conflict is pathological, manually copy the production archive entry from `davehomeassist.github.io/phillies-wire/archive.json` into the local file, commit, push.

### Schedule import (Ballparks Quest cutover backfill)

Legacy `phillies2026` localStorage state is imported once on first Wire `/schedule/` visit. If an attended-game note went missing:

1. Open the Wire schedule page on the device that originally entered the note
2. Check browser DevTools → Application → Local Storage for `phillies2026` + `philliesWire_*` keys
3. If the legacy key exists but the import didn't run, manually re-trigger via the page's import action (or clear `philliesWire_migration_complete` marker if present)

## Re-running a specific edition

To rebuild the `2026-04-22` edition (as an example):

```bash
# The archive holds the original metadata — restore it into the data file
jq '.entries[] | select(.date == "2026-04-22")' archive.json

# Copy issues/2026-04-22/data.json into phillies-wire-data.json,
# then run render + verify against it:
cp issues/2026-04-22/data.json phillies-wire-data.json
node render.mjs
node verify.mjs
```

Do **not** re-crawl for a past date — MLB Stats API will return today's live state under your historical context and overwrite the data.

## File map (where things live)

| Path | Role | Lifecycle |
|---|---|---|
| `phillies-wire-data.json` | Current per-issue payload | rewritten every crawl |
| `phillies-wire-output.html` | Current rendered edition | regenerated every render; **gitignored** |
| `latest.json` | Consumer feed (`latest-1.0.0`) | regenerated every render; **gitignored**; Pages is source of truth |
| `archive.json` | Season archive index | appended per edition |
| `status.json` | Pipeline status object | rewritten every render |
| `issues/<date>/data.json` | Per-issue snapshot (`1.3.0` format) | persisted after successful render |
| `issues/<date>/index.html` | Per-issue HTML snapshot | persisted after successful render |
| `data/phillies-2026.json` | Canonical season schedule (`1.0.0`) | refreshed by crawl; overrides apply during enrich |
| `data/phillies-2026-overrides.json` | Editorial overrides | hand-edited |
| `calendar/phillies-2026-all.ics` | Season calendar export (RFC 5545) | regenerated every render |
| `site/**` | Static asset mirror for Pages | regenerated every render; **gitignored** |
| `samples/` | Fixture payloads for each schema | hand-curated, see `samples/README.md` |
| `crawl-error.log` | Crawl stage errors | **gitignored**, rotated daily |
| `enrich-error.log` | Enrich stage errors | **gitignored**, rotated daily |

## Emergency: the edition is out, it's wrong, I need to replace it now

```bash
# 1. Fix the source of the problem (override file, template, data key)
# 2. Rebuild just render + verify
node render.mjs
node verify.mjs

# 3. Commit + push — GitHub Actions will re-publish
git add phillies-wire-output.html issues/<today>/ archive.json status.json
git commit -m "fix: correct <thing> in today's edition"
git push
```

If the wrong edition has already shipped via email, a correction email is usually the right call rather than a retroactive send. The edition on the web corrects itself on the next deploy.

## When to escalate scope

This runbook assumes today's pipeline architecture. For changes beyond operational recovery:

- Adding a new pipeline stage → update `run.mjs` `DAILY_STAGES` / `LIVE_STAGES`, add to stage reference above, add the verify contract if it produces artifacts
- Changing a consumer contract (breaking schema change) → bump `schema_version`, add a new `samples/<contract>-<version>.sample.json`, update `verify.mjs` assertions, publish deprecation notice
- New data source → `crawl.mjs` only; keep enrich/render free of direct network access
- New delivery channel (beyond email) → separate stage after `verify.mjs`; never before
