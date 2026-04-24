# samples/

Fixture payloads for each consumer contract Phillies Wire publishes. Committed so `verify.mjs` and tests have a stable shape to assert against, and so schema audits have a reference document for each surface.

These are samples, not JSON Schema specs. They are real-shaped payloads kept current enough to describe the format. If the live pipeline produces a shape that diverges from these samples, either the pipeline regressed or the sample is stale — check both.

## What lives here

| File | Describes | Version | Consumed by |
|---|---|---|---|
| `issue-1.2.0.sample.json` | Per-issue `data.json` (legacy format) | `1.2.0` | `verify.mjs`, `crawl.mjs`, fixture tests |
| `issue-1.3.0.sample.json` | Per-issue `data.json` (current format) | `1.3.0` | Reference only — tests have not migrated yet |
| `latest-1.0.0.sample.json` | Consumer feed at `/latest.json` | `latest-1.0.0` | Reference for iframe / Home Assistant / Stream Deck integrations |

The canonical season schedule `data/phillies-2026.json` (schema `1.0.0`) is its own canonical artifact and does not have a separate sample — read that file directly.

## Version reality check

- `issue-1.2.0.sample.json` is the fixture that fixture-dependent tests (`test/crawl-helpers.test.mjs`, `test/pipeline-smoke.test.mjs`, `test/render-fixture.test.mjs`, `test/schema-text-integrity.test.mjs`) currently load. It represents the pre-`1.3.0` shape where `schema_version` lived under `meta`.
- `issue-1.3.0.sample.json` is the format the pipeline actually produces today (see `issues/<date>/data.json`). `schema_version` moved to top level and several fields were reorganized. Migrating tests to this sample is follow-up work.
- `latest-1.0.0.sample.json` is a snapshot of production `latest.json` taken on 2026-04-24 (edition 26). Drop-in replace if the consumer feed shape changes.

## How to regenerate

```bash
# Per-issue (current)
cp issues/<latest-date>/data.json samples/issue-1.3.0.sample.json

# Consumer feed
curl -fsSL https://davehomeassist.github.io/phillies-wire/latest.json \
  -o samples/latest-1.0.0.sample.json
```

Bump the sample filename when the schema version major/minor changes. Keep the old sample alongside the new one through at least one release cycle so consumers have time to migrate.

## What counts as a breaking change

Any of the following forces a schema major bump and a new sample alongside the old:

- Removing a top-level key
- Changing the type of an existing key
- Renaming a key
- Moving a key between nesting levels (e.g. `meta.schema_version` → top-level `schema_version` was a 1.2.0 → 1.3.0 break)

Additive changes (new optional keys) can stay at the same major version but should still regenerate the sample so it reflects reality.
