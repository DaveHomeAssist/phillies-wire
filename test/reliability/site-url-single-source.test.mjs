// RELIABILITY: one origin for every generated absolute URL.
//
// config.mjs is the documented single source of constants, yet the public
// origin was copied into render.mjs, email-render.mjs, scripts/health-check.mjs,
// and factcheck.mjs, and the factcheck copy still pointed at the retired
// github.io root, so the accuracy report's "sources" links and the Notion row
// disagreed with the sitemap, feed, and email. Every pipeline module must now
// import SITE_URL from config.mjs.

import { readFileSync } from "node:fs";
import { SITE_URL, DEFAULT_SITE_URL } from "../../config.mjs";
import { test, run, assert } from "./_harness.mjs";

const MODULES = [
  "render.mjs",
  "email-render.mjs",
  "factcheck.mjs",
  "deliver.mjs",
  "verify.mjs",
  "run.mjs",
  "crawl.mjs",
  "enrich.mjs",
  "canonical-schedule.mjs",
  "scripts/health-check.mjs",
];

function source(rel) {
  return readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
}

test("config.mjs exports the public origin with no trailing slash", () => {
  assert.equal(DEFAULT_SITE_URL, "https://phillieswire.com");
  assert.ok(/^https:\/\/[^/]+$/.test(SITE_URL), `SITE_URL must be a bare origin, got ${SITE_URL}`);
});

test("PIN: no pipeline module hardcodes the site origin outside config.mjs", () => {
  for (const rel of MODULES) {
    const text = source(rel);
    assert.ok(!text.includes("https://phillieswire.com"), `${rel} must import SITE_URL from config.mjs`);
    assert.ok(!text.includes("davehomeassist.github.io/phillies-wire"), `${rel} still points at the retired github.io root`);
  }
});

test("PIN: render, email, factcheck, and the health check consume SITE_URL from config", () => {
  for (const rel of ["render.mjs", "email-render.mjs", "factcheck.mjs", "scripts/health-check.mjs"]) {
    assert.match(source(rel), /import \{[^}]*\bSITE_URL\b[^}]*\} from "\.\.?\/config\.mjs"/, `${rel} imports SITE_URL`);
  }
});

await run();
