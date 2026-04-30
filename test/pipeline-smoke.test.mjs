// Pipeline smoke test: reads the schema fixture and runs render.mjs against
// it end-to-end to verify the template contract, the file system writes, and
// the verify step all agree.
//
// This intentionally does NOT exercise the network (crawl.mjs hits MLB). The
// crawl unit tests already cover the payload builders with mock responses.
// This test covers the render + verify seam that the unit tests miss.

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const work = mkdtempSync(join(tmpdir(), "pw-smoke-"));
try {
  // Copy the minimum files render.mjs needs.
  const files = [
    "phillies-wire-v2.html",
    "phillies-wire-schema.json",
    "tokens.css",
    "phillies-wire.css",
    "live-feed.js",
    "fonts.css",
    "render.mjs",
    "canonical-schedule.mjs",
    "pregame-preview.js",
    "config.mjs",
  ];
  for (const f of files) {
    if (existsSync(join(repoRoot, f))) {
      cpSync(join(repoRoot, f), join(work, f));
    }
  }

  if (existsSync(join(repoRoot, "fonts"))) {
    cpSync(join(repoRoot, "fonts"), join(work, "fonts"), { recursive: true });
  }
  if (existsSync(join(repoRoot, "shared"))) {
    cpSync(join(repoRoot, "shared"), join(work, "shared"), { recursive: true });
  }
  if (existsSync(join(repoRoot, "schedule"))) {
    cpSync(join(repoRoot, "schedule"), join(work, "schedule"), { recursive: true });
  }
  if (existsSync(join(repoRoot, "dashboard"))) {
    cpSync(join(repoRoot, "dashboard"), join(work, "dashboard"), { recursive: true });
  }
  if (existsSync(join(repoRoot, "embed"))) {
    cpSync(join(repoRoot, "embed"), join(work, "embed"), { recursive: true });
  }

  // Seed phillies-wire-data.json from the fixture so render has something to
  // stamp. Fixture ticker/hero/sections are already production-shaped.
  const fixture = JSON.parse(readFileSync(join(repoRoot, "phillies-wire-schema.json"), "utf8"));

  // Align meta.date to "today" so status / archive entry look valid.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  fixture.meta.date = today;
  fixture.meta.generated_at = new Date().toISOString();
  fixture.meta.off_day = false;

  writeFileSync(join(work, "phillies-wire-data.json"), JSON.stringify(fixture, null, 2) + "\n", "utf8");
  // Seed an empty archive so upsert works.
  writeFileSync(
    join(work, "archive.json"),
    JSON.stringify({ schema_version: "1.2.0", publication: "Phillies Wire", updated_at: null, latest_date: null, entries: [] }, null, 2) + "\n",
    "utf8",
  );

  // Run render in the temp dir.
  const result = spawnSync(process.execPath, ["render.mjs"], {
    cwd: work,
    encoding: "utf8",
    env: { ...process.env, PW_SKIP_SCHEDULE_FETCH: "1" },
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`render.mjs exited ${result.status}`);
  }

  // Required output files exist
  const outputs = [
    "phillies-wire-output.html",
    "index.html",
    "status.json",
    "archive.json",
    "archive/index.html",
    "site/index.html",
    "site/archive/index.html",
    "site/archive.json",
    "site/status.json",
    "site/sitemap.xml",
    "site/feed.xml",
    "site/robots.txt",
    "site/fonts.css",
    "data/phillies-2026.json",
    "calendar/phillies-2026-all.ics",
    "site/data/phillies-2026.json",
    "site/calendar/phillies-2026-all.ics",
    "site/schedule/index.html",
    "site/dashboard/preferences/index.html",
    "site/dashboard/preferences/preferences.css",
    "site/dashboard/preferences/preferences.js",
    "site/shared/phillies-prefs.mjs",
  ];
  for (const out of outputs) {
    assert.ok(existsSync(join(work, out)), `missing output: ${out}`);
  }

  // The rendered HTML should contain the hero headline from the fixture and
  // no unresolved {{tokens}}.
  const html = readFileSync(join(work, "index.html"), "utf8");
  assert.ok(html.includes("<main"), "main landmark present");
  assert.ok(!/\{\{[^}]+\}\}/.test(html), "no unresolved tokens");
  assert.ok(html.includes(fixture.hero.headline), "hero headline stamped");
  assert.ok(html.includes("fonts.css"), "fonts.css linked from template");

  // Status payload should reflect the fixture.
  const status = JSON.parse(readFileSync(join(work, "status.json"), "utf8"));
  assert.equal(status.publication, fixture.meta.publication);
  assert.equal(status.date, today);

  console.log("PASS pipeline smoke test: render -> filesystem -> template contract holds");
} finally {
  rmSync(work, { recursive: true, force: true });
}
