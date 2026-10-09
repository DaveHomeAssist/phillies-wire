// Offseason mode: final record comes from the canonical schedule (never the
// fixture's 0-0), the hero drops game-day cards, the ticker carries hot-stove
// items, and the rendered page neither loads live-feed.js nor shows game nav.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyOffseasonPayload, buildHotStoveItems, computeFinalRecord } from "../crawl/offseason.mjs";
import { populate, isOffseasonPayload } from "../render.mjs";

const template = readFileSync(new URL("../phillies-wire-v2.html", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("../phillies-wire-schema.json", import.meta.url), "utf8"));

function game(date, phi, opp, record, home = true) {
  return {
    game_pk: Number(date.replace(/-/g, "")),
    official_date: date,
    game_date: `${date}T18:00:00Z`,
    home_game: home,
    status: { abstract: "Final", detailed: "Final" },
    phillies: { score: phi, league_record: record },
    opponent: { score: opp, abbr: "TB" },
  };
}

const schedule = {
  games: [
    game("2026-09-25", 1, 2, { wins: 86, losses: 74 }),
    game("2026-09-26", 5, 4, { wins: 87, losses: 74 }),
    { official_date: "2026-04-30", status: { abstract: "Final", detailed: "Postponed" }, phillies: { score: null }, opponent: { score: null } },
    game("2026-09-27", 7, 3, { wins: 88, losses: 74 }),
  ],
};

test("final record uses the last final's league record and computes the streak", () => {
  const record = computeFinalRecord(schedule);
  assert.equal(record.wins, 88);
  assert.equal(record.losses, 74);
  assert.equal(record.pct, ".543");
  assert.equal(record.streak, "W2");
  assert.equal(record.last_final.outcome, "W");
  assert.equal(record.last_final.date, "2026-09-27");
  assert.match(record.last_game.label, /^W 7-3 vs TB$/);
});

test("final record is null without completed games", () => {
  assert.equal(computeFinalRecord({ games: [] }), null);
});

test("hot-stove items strip the team prefix and dedupe", () => {
  const items = buildHotStoveItems({
    transactions: [
      { date: "2026-10-02", description: "Philadelphia Phillies signed RHP A." },
      { date: "2026-10-01", description: "Philadelphia Phillies signed RHP A." },
      { date: "2026-10-03", description: "Philadelphia Phillies activated LHP B." },
    ],
  });
  assert.deepEqual(items.map((i) => i.text), ["Hot stove: Activated LHP B.", "Hot stove: Signed RHP A."]);
});

function offseasonData() {
  const data = JSON.parse(JSON.stringify(fixture));
  data.meta.date = "2026-10-12";
  data.meta.edition = 190;
  data.meta.json_ld = "{}";
  data.meta.issue_nav = { show: false };
  data.meta.share = { twitter_url: "x", bluesky_url: "b", mailto_url: "m" };
  applyOffseasonPayload(data, {
    season: 2026,
    finalRecord: computeFinalRecord(schedule),
    hotStoveItems: [{ text: "Hot stove: Signed RHP A.", highlight: true }],
  });
  return data;
}

test("offseason payload replaces game-day hero cards and ticker", () => {
  const data = offseasonData();
  assert.equal(data.hero.mode, "offseason");
  assert.equal(data.hero.headline, "2026 season complete");
  assert.equal(data.record.wins, 88);
  assert.deepEqual(data.hero.cards.map((c) => c.label), ["Final Record", "Last Game", "Next Season"]);
  assert.equal(data.ticker[0].text, "PHI 88-74 · 2026 Final");
  assert.ok(data.ticker.some((t) => t.text.startsWith("Hot stove:")));
  assert.ok(isOffseasonPayload(data));
});

test("offseason template render hides live feed and game-day nav", () => {
  const data = offseasonData();
  Object.assign(data.meta, {
    in_season: false,
    is_offseason: true,
    record_label: "2026 Final",
    subscribe_dek: "Weekly hot-stove updates",
    assets_prefix: "./",
    latest_href: "./",
    archive_href: "./archive/",
  });
  const html = populate(template, data);
  assert.equal((html.match(/{{[^}]+}}/g) ?? []).length, 0);
  assert.doesNotMatch(html, /live-feed\.js/);
  assert.doesNotMatch(html, /Inning by inning/);
  assert.doesNotMatch(html, /pw-next-game/);
  assert.doesNotMatch(html, /First Pitch/);
  assert.match(html, /2026 Results/);
  assert.match(html, /<div class="pw-record-num">88-74<\/div>/);
  assert.match(html, /2026 season complete/);
  assert.match(html, /Weekly hot-stove updates/);
});

var failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}
process.on("exit", () => {
  if (failed) process.exitCode = 1;
});
