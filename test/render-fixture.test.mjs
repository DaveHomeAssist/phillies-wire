import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildFeedXml, buildIssueDataJson, populate } from "../render.mjs";

const template = readFileSync(new URL("../phillies-wire-v2.html", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("../phillies-wire-schema.json", import.meta.url), "utf8"));

runTest("feed builder emits RSS 2.0, not Atom", () => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.meta.publication = "Phillies Wire";
  const feed = buildFeedXml({
    updated_at: "2026-06-28T01:47:00.000Z",
    entries: [
      {
        date: "2026-06-27",
        headline: "PHI 2, NYM 6.",
        dek: "Final at Citi Field.",
        generated_at: "2026-06-28T01:47:00.000Z",
      },
    ],
  }, data);

  assert.match(feed, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0"/);
  assert.match(feed, /<channel>/);
  assert.match(feed, /<item>/);
  assert.match(feed, /<guid isPermaLink="true">https:\/\/phillieswire\.com\/issues\/2026-06-27\/<\/guid>/);
  assert.match(feed, /type="application\/rss\+xml"/);
  assert.doesNotMatch(feed, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/);
});

runTest("issue data builder keeps a large final play array under budget", () => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.meta.date = "2026-06-27";
  data.meta.edition = 87;
  data.meta.volume = 1;
  data.meta.generated_at = "2026-06-28T01:40:00.000Z";
  data.meta.status.mode = "final";
  data.meta.status.mode_label = "Final";
  data.hero.mode = "final";
  data.hero.label = "Final";
  data.hero.headline = "PHI 3, NYM 8.";
  data.hero.summary = "PHI 3, NYM 8. Final at Citi Field.";
  data.sections.game_status.content.linescore = makeLinescore();
  data.sections.game_status.content.plays = makeManyPlays(71);
  data.sections.lineup.content.batting_order.home = makeLineup("NYM");
  data.sections.lineup.content.batting_order.away = makeLineup("PHI");
  data.sections.lineup.content.batting_order.phi = makeLineup("PHI");
  data.sections.lineup.content.batting_order.opp = makeLineup("NYM");
  data.sections.injury_report.content.il_entries = [
    { name: "Player One", position: "RHP", injury: "Shoulder", il_type: "15-day IL", status_note: "Rehab work continues." },
  ];

  const text = buildIssueDataJson(data);
  const issueData = JSON.parse(text);
  const plays = issueData.sections.game_status.content.plays;

  assert.ok(Buffer.byteLength(JSON.stringify(issueData), "utf8") <= 20 * 1024);
  assert.equal(issueData.schema_version, "1.4.0");
  assert.equal(plays.length, 71);
  assert.equal(JSON.stringify(plays).includes("playEvents"), false);
  assert.equal(issueData.sections.lineup, null);
  assert.equal(issueData.sections.injury_report, null);
  assert.ok(plays.every((play) => typeof play.detail === "string" && play.detail.length > 0));
  assert.ok(plays.some((play) => play.score_after === "PHI 2, NYM 0"));
});

runTest("fixture render resolves every token and includes required landmarks", () => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.meta.assets_prefix = "./";
  data.meta.latest_href = "./";
  data.meta.archive_href = "./archive/";
  data.meta.show_sections = true;
  data.meta.off_day = false;
  data.meta.game_pk = "0";
  data.meta.first_pitch_iso = "2026-03-28T20:05:00Z";
  data.meta.page_title = "Phillies Wire · Phillies vs Rangers · Mar 28, 2026";
  data.meta.page_description = "Game 2 at CBP.";
  data.meta.canonical_url = "https://example.com/";
  data.meta.og_title = "Phillies Wire: Phillies vs Rangers";
  data.meta.og_description = "Game 2 at CBP.";
  data.meta.og_image = "https://example.com/og.svg";
  data.meta.og_image_alt = "Phillies Wire";
  data.meta.json_ld = "{\\u0026\"ok\":true}";
  data.meta.issue_nav = { show: false };
  data.meta.share = {
    twitter_url: "https://twitter.com/intent/tweet",
    bluesky_url: "https://bsky.app/intent/compose",
    mailto_url: "mailto:?subject=test",
  };

  const html = populate(template, data);
  const unresolved = html.match(/{{[^}]+}}/g) ?? [];
  assert.equal(unresolved.length, 0, `Unresolved tokens: ${unresolved.slice(0, 5).join(", ")}`);

  assert.match(html, /<main id="pw-main"/);
  assert.match(html, /<nav class="pw-shell-nav"/);
  assert.match(html, /href="\.\/dashboard\/innings\/">Inning by inning<\/a>/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /data-row="lineup"/);
  assert.match(html, /<a class="pw-skip-link"/);
  assert.match(html, /Schedule refresh required/);
});

runTest("fixture render populates Open Graph and JSON-LD", () => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.meta.assets_prefix = "./";
  data.meta.latest_href = "./";
  data.meta.archive_href = "./archive/";
  data.meta.show_sections = true;
  data.meta.off_day = false;
  data.meta.game_pk = "0";
  data.meta.first_pitch_iso = "2026-03-28T20:05:00Z";
  data.meta.page_title = "T";
  data.meta.page_description = "D";
  data.meta.canonical_url = "https://example.com/";
  data.meta.og_title = "OGT";
  data.meta.og_description = "OGD";
  data.meta.og_image = "https://example.com/og.svg";
  data.meta.og_image_alt = "alt";
  data.meta.json_ld = "[\"safe\"]";
  data.meta.issue_nav = { show: false };
  data.meta.share = {
    twitter_url: "https://twitter.com/intent/tweet",
    bluesky_url: "https://bsky.app/intent/compose",
    mailto_url: "mailto:?subject=test",
  };

  const html = populate(template, data);
  assert.match(html, /property="og:title"[^>]+content="OGT"/);
  assert.match(html, /property="og:image"[^>]+content="https:\/\/example\.com\/og\.svg"/);
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLdMatch, "Expected JSON-LD script tag");
  assert.equal(jsonLdMatch[1].trim(), "[\"safe\"]");
});

runTest("fixture render surfaces freshness labels when provided", () => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.meta.assets_prefix = "./";
  data.meta.latest_href = "./";
  data.meta.archive_href = "./archive/";
  data.meta.show_sections = true;
  data.meta.off_day = false;
  data.meta.game_pk = "0";
  data.meta.first_pitch_iso = "2026-03-28T20:05:00Z";
  data.meta.page_title = "T";
  data.meta.page_description = "D";
  data.meta.canonical_url = "https://example.com/";
  data.meta.og_title = "OGT";
  data.meta.og_description = "OGD";
  data.meta.og_image = "https://example.com/og.svg";
  data.meta.og_image_alt = "alt";
  data.meta.json_ld = "[\"safe\"]";
  data.meta.issue_nav = { show: false };
  data.meta.share = {
    twitter_url: "https://twitter.com/intent/tweet",
    bluesky_url: "https://bsky.app/intent/compose",
    mailto_url: "mailto:?subject=test",
  };
  data.sections.roster.content.as_of_label = "As of Apr 20, 2026, 1:05 PM ET";
  data.sections.injury_report.content.il_entries = [
    { name: "Current Player", position: "RHP", injury: "Current injury", freshness_label: "" },
  ];
  data.sections.injury_report.content.il_entries[0].freshness_label = "Last confirmed Mar 28, 2026, 10:00 AM ET";
  data.sections.farm_system.show = true;
  data.sections.farm_system.content.last_confirmed_label = "Last confirmed Mar 28, 2026, 10:00 AM ET";

  const html = populate(template, data);
  assert.match(html, /As of Apr 20, 2026, 1:05 PM ET/);
  assert.match(html, /Last confirmed Mar 28, 2026, 10:00 AM ET/);
});

runTest("fixture render surfaces section chips when provided", () => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.meta.assets_prefix = "./";
  data.meta.latest_href = "./";
  data.meta.archive_href = "./archive/";
  data.meta.show_sections = true;
  data.meta.off_day = false;
  data.meta.game_pk = "0";
  data.meta.first_pitch_iso = "2026-03-28T20:05:00Z";
  data.meta.page_title = "T";
  data.meta.page_description = "D";
  data.meta.canonical_url = "https://example.com/";
  data.meta.og_title = "OGT";
  data.meta.og_description = "OGD";
  data.meta.og_image = "https://example.com/og.svg";
  data.meta.og_image_alt = "alt";
  data.meta.json_ld = "[\"safe\"]";
  data.meta.issue_nav = { show: false };
  data.meta.share = {
    twitter_url: "https://twitter.com/intent/tweet",
    bluesky_url: "https://bsky.app/intent/compose",
    mailto_url: "mailto:?subject=test",
  };
  data.sections.recap.chip_label = "Final";
  data.sections.recap.chip_tone = "final";
  data.sections.recap.show = true;
  data.sections.roster.chip_label = "Confirmed";
  data.sections.roster.chip_tone = "confirmed";
  data.sections.injury_report.chip_label = "Live";
  data.sections.injury_report.chip_tone = "live";
  data.sections.farm_system.chip_label = "Editorial";
  data.sections.farm_system.chip_tone = "editorial";
  data.sections.farm_system.show = true;

  const html = populate(template, data);
  assert.match(html, /pw-section-chip--final">Final/);
  assert.match(html, /pw-section-chip--confirmed">Confirmed/);
  assert.match(html, /pw-section-chip--live">Live/);
  assert.match(html, /pw-section-chip--editorial">Editorial/);
});

runTest("fixture render omits recap accordion when no final recap is present", () => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.meta.assets_prefix = "./";
  data.meta.latest_href = "./";
  data.meta.archive_href = "./archive/";
  data.meta.show_sections = true;
  data.meta.off_day = false;
  data.meta.game_pk = "0";
  data.meta.first_pitch_iso = "2026-03-28T20:05:00Z";
  data.meta.page_title = "T";
  data.meta.page_description = "D";
  data.meta.canonical_url = "https://example.com/";
  data.meta.og_title = "OGT";
  data.meta.og_description = "OGD";
  data.meta.og_image = "https://example.com/og.svg";
  data.meta.og_image_alt = "alt";
  data.meta.json_ld = "[\"safe\"]";
  data.meta.issue_nav = { show: false };
  data.meta.share = {
    twitter_url: "https://twitter.com/intent/tweet",
    bluesky_url: "https://bsky.app/intent/compose",
    mailto_url: "mailto:?subject=test",
  };
  delete data.sections.recap;

  const html = populate(template, data);
  assert.doesNotMatch(html, /data-row="recap"/);
  assert.doesNotMatch(html, /PHI 5, TEX 3/);
});

runTest("fixture render keeps matchup metadata in the hero instead of duplicating Game Status rows", () => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.meta.assets_prefix = "./";
  data.meta.latest_href = "./";
  data.meta.archive_href = "./archive/";
  data.meta.show_sections = true;
  data.meta.off_day = false;
  data.meta.game_pk = "0";
  data.meta.first_pitch_iso = "2026-03-28T20:05:00Z";
  data.meta.page_title = "T";
  data.meta.page_description = "D";
  data.meta.canonical_url = "https://example.com/";
  data.meta.og_title = "OGT";
  data.meta.og_description = "OGD";
  data.meta.og_image = "https://example.com/og.svg";
  data.meta.og_image_alt = "alt";
  data.meta.json_ld = "[\"safe\"]";
  data.meta.issue_nav = { show: false };
  data.meta.share = {
    twitter_url: "https://twitter.com/intent/tweet",
    bluesky_url: "https://bsky.app/intent/compose",
    mailto_url: "mailto:?subject=test",
  };

  const html = populate(template, data);
  const gameStatus = html.match(/<div class="pw-acc-row(?: pw-acc-row--open)?" data-row="game">([\s\S]*?)data-row="lineup"/);
  assert.ok(gameStatus, "Expected to capture the Game Status accordion block");
  const gameStatusHtml = gameStatus[1];

  assert.match(html, /pw-hero-card-label">First Pitch/);
  assert.match(html, /pw-hero-card-label">Venue/);
  assert.match(gameStatusHtml, /Starters, live tracker, and park notes/);
  assert.match(gameStatusHtml, /pw-info-label">Starters<\/span>/);
  assert.doesNotMatch(gameStatusHtml, /pw-info-label">Matchup<\/span>/);
  assert.doesNotMatch(gameStatusHtml, /pw-info-label">First Pitch<\/span>/);
  assert.doesNotMatch(gameStatusHtml, /pw-info-label">Venue<\/span>/);
  assert.doesNotMatch(gameStatusHtml, /pw-info-label">Series<\/span>/);
  assert.doesNotMatch(gameStatusHtml, /pw-info-label">Broadcast<\/span>/);
  assert.doesNotMatch(gameStatusHtml, /pw-info-label">Weather<\/span>/);
});

runTest("fixture render hides recap when recap.show is false", () => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.meta.assets_prefix = "./";
  data.meta.latest_href = "./";
  data.meta.archive_href = "./archive/";
  data.meta.show_sections = true;
  data.meta.off_day = false;
  data.meta.game_pk = "0";
  data.meta.first_pitch_iso = "2026-03-28T20:05:00Z";
  data.meta.page_title = "T";
  data.meta.page_description = "D";
  data.meta.canonical_url = "https://example.com/";
  data.meta.og_title = "OGT";
  data.meta.og_description = "OGD";
  data.meta.og_image = "https://example.com/og.svg";
  data.meta.og_image_alt = "alt";
  data.meta.json_ld = "[\"safe\"]";
  data.meta.issue_nav = { show: false };
  data.meta.share = {
    twitter_url: "https://twitter.com/intent/tweet",
    bluesky_url: "https://bsky.app/intent/compose",
    mailto_url: "mailto:?subject=test",
  };
  data.sections.recap.show = false;

  const html = populate(template, data);
  assert.doesNotMatch(html, /data-row="recap"/);
  assert.doesNotMatch(html, /Thursday Recap/);
});

runTest("fixture render shows recap when recap.show is true", () => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.meta.assets_prefix = "./";
  data.meta.latest_href = "./";
  data.meta.archive_href = "./archive/";
  data.meta.show_sections = true;
  data.meta.off_day = false;
  data.meta.game_pk = "0";
  data.meta.first_pitch_iso = "2026-03-28T20:05:00Z";
  data.meta.page_title = "T";
  data.meta.page_description = "D";
  data.meta.canonical_url = "https://example.com/";
  data.meta.og_title = "OGT";
  data.meta.og_description = "OGD";
  data.meta.og_image = "https://example.com/og.svg";
  data.meta.og_image_alt = "alt";
  data.meta.json_ld = "[\"safe\"]";
  data.meta.issue_nav = { show: false };
  data.meta.share = {
    twitter_url: "https://twitter.com/intent/tweet",
    bluesky_url: "https://bsky.app/intent/compose",
    mailto_url: "mailto:?subject=test",
  };
  data.sections.recap.show = true;
  data.sections.recap.title = "Current Recap";

  const html = populate(template, data);
  assert.match(html, /data-row="recap"/);
  assert.match(html, /Current Recap/);
});

runTest("triple-brace token emits raw HTML without escaping", () => {
  const html = populate("{{{meta.raw}}}", { meta: { raw: "<em>ok</em>" } });
  assert.equal(html, "<em>ok</em>");
});

runTest("double-brace token HTML-escapes user input", () => {
  const html = populate("<span>{{meta.text}}</span>", { meta: { text: "<script>alert(1)</script>" } });
  assert.equal(html, "<span>&lt;script&gt;alert(1)&lt;/script&gt;</span>");
});

runTest("nested {{#if}} blocks resolve correctly", () => {
  const tpl = "{{#if outer}}OUT {{#if inner}}IN{{/if}}{{/if}}";
  assert.equal(populate(tpl, { outer: true, inner: true }), "OUT IN");
  assert.equal(populate(tpl, { outer: true, inner: false }), "OUT ");
  assert.equal(populate(tpl, { outer: false, inner: true }), "");
});

runTest("nested {{#each}} inside {{#if}} resolves correctly", () => {
  const tpl = "{{#if show}}<ul>{{#each items}}<li>{{this}}</li>{{/each}}</ul>{{/if}}";
  assert.equal(populate(tpl, { show: true, items: ["a", "b"] }), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(populate(tpl, { show: false, items: ["a"] }), "");
});

runTest("whitespace-only {{ }} expression throws instead of stringifying the scope", () => {
  assert.throws(() => populate("<span>{{ }}</span>", { foo: "bar" }), /Empty/);
  assert.throws(() => populate("<span>{{   }}</span>", { foo: "bar" }), /Empty/);
});

runTest("whitespace-only {{{ }}} expression also throws", () => {
  assert.throws(() => populate("<span>{{{ }}}</span>", { foo: "bar" }), /Empty/);
});

runTest("completely empty {{}} stays literal (regex never matches)", () => {
  // No path characters between the braces → the regex doesn't fire,
  // the substring passes through as inert text. Not a security issue
  // because the page won't render the token in any meaningful way.
  assert.equal(populate("<span>{{}}</span>", {}), "<span>{{}}</span>");
});

function makeManyPlays(count) {
  const eventTypes = ["strikeout", "walk_hbp", "single", "out", "home_run", "extra_base_hit", "reached_on_error"];
  return Array.from({ length: count }, (_, index) => {
    const event_type = eventTypes[index % eventTypes.length];
    const is_scoring = index === 12 || index === 48;
    const is_key = is_scoring || event_type === "home_run" || event_type === "extra_base_hit";
    return {
      id: `823609:${index}`,
      inning: Math.floor(index / 8) + 1,
      half: index % 2 === 0 ? "top" : "bottom",
      team: index % 2 === 0 ? "PHI" : "NYM",
      event_type,
      actor: index % 2 === 0 ? "Bryce Harper" : "Francisco Lindor",
      actor_id: index % 2 === 0 ? 547180 : 596019,
      detail: `Bryce Harper singles on a sharp line drive to center fielder A.J. Ewing. Runner ${index} advances while the throw comes through the cutoff man.`,
      score_after: is_scoring ? "PHI 2, NYM 0" : "PHI 0, NYM 0",
      runs: is_scoring ? 2 : 0,
      is_scoring,
      is_key,
    };
  });
}

function makeLineup(team) {
  return Array.from({ length: 9 }, (_, index) => ({
    slot: index + 1,
    name: `${team} Batter ${index + 1}`,
    position: "IF",
    bats: index % 2 ? "L" : "R",
  }));
}

function makeLinescore() {
  return {
    currentInning: 9,
    currentInningOrdinal: "9th",
    inningState: "End",
    isTopInning: false,
    outs: 3,
    teams: {
      away: { runs: 3, hits: 7, errors: 0 },
      home: { runs: 8, hits: 11, errors: 1 },
    },
    innings: Array.from({ length: 9 }, (_, index) => ({
      num: index + 1,
      away: { runs: index === 3 ? 2 : 0, hits: 1, errors: 0 },
      home: { runs: index === 5 ? 3 : 0, hits: 1, errors: index === 8 ? 1 : 0 },
    })),
  };
}

function runTest(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (error) {
    console.error("FAIL", name);
    throw error;
  }
}
