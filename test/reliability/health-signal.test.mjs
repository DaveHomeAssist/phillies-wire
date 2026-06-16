// RELIABILITY: post-deploy health signal (goal G4)
//
// The out-of-band health check must catch stale or structurally broken
// publishes after Pages deploys: missing crawl schema fields, unresolved
// template tokens, and failed delivery status should alert instead of
// silently passing on freshness alone.

import { validateHealthSnapshot } from "../../scripts/health-check.mjs";
import { test, run, assert } from "./_harness.mjs";

const NOW = new Date("2026-06-16T14:00:00Z");

function healthySnapshot(overrides = {}) {
  return {
    status: {
      publication: "Phillies Wire",
      date: "2026-06-16",
      generated_at: "2026-06-16T13:45:00Z",
      issue_path: "issues/2026-06-16/",
      ...overrides.status,
    },
    latest: {
      schema_version: "latest-1.0.0",
      edition_date: "2026-06-16",
      generated_at: "2026-06-16T13:45:00Z",
      ...overrides.latest,
    },
    issueData: {
      schema_version: "1.3.0",
      meta: { date: "2026-06-16", status: { crawl_state: "ok" } },
      record: {},
      hero: {},
      sections: {},
      next_game: {},
      ...overrides.issueData,
    },
    issueHtml: overrides.issueHtml ?? "<!doctype html><title>Phillies Wire</title>",
    delivery: {
      schema_version: "delivery-1.0.0",
      generated_at: "2026-06-16T13:46:00Z",
      state: "sent",
      required: true,
      delivered: 2,
      failed: 0,
      ...overrides.delivery,
    },
  };
}

test("G4: health snapshot accepts a fresh issue with delivery signal", () => {
  const result = validateHealthSnapshot(healthySnapshot(), { now: NOW, maxAgeMin: 60 });
  assert.equal(result.ageMin, 15);
});

test("G4: health snapshot fails on crawl schema gaps", () => {
  assert.throws(
    () => validateHealthSnapshot(
      healthySnapshot({ issueData: { meta: { date: "2026-06-16", status: {} } } }),
      { now: NOW, maxAgeMin: 60 },
    ),
    /crawl_state/,
  );
});

test("G4: health snapshot fails on unresolved template tokens", () => {
  assert.throws(
    () => validateHealthSnapshot(
      healthySnapshot({ issueHtml: "<h1>{{hero.headline}}</h1>" }),
      { now: NOW, maxAgeMin: 60 },
    ),
    /unresolved template tokens/,
  );
});

test("G4: health snapshot fails on failed delivery status", () => {
  assert.throws(
    () => validateHealthSnapshot(
      healthySnapshot({ delivery: { state: "failed", delivered: 0, failed: 2 } }),
      { now: NOW, maxAgeMin: 60 },
    ),
    /delivery status is failed/,
  );
});

test("G4: any failed recipient alerts (partial delivery is not acceptable)", () => {
  assert.throws(
    () => validateHealthSnapshot(
      healthySnapshot({ delivery: { state: "partial", delivered: 1, failed: 1 } }),
      { now: NOW, maxAgeMin: 60 },
    ),
    /failed recipient/,
  );
});

await run();
