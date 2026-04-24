import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { populate } from "../render.mjs";

const template = readFileSync(new URL("../phillies-wire-v2.html", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("../samples/issue-1.2.0.sample.json", import.meta.url), "utf8"));

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
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /data-row="lineup"/);
  assert.match(html, /<a class="pw-skip-link"/);
  assert.match(html, /Trea Turner/);
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
  data.sections.injury_report.content.il_entries[0].freshness_label = "Last confirmed Mar 28, 2026, 10:00 AM ET";
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
  data.sections.roster.chip_label = "Confirmed";
  data.sections.roster.chip_tone = "confirmed";
  data.sections.injury_report.chip_label = "Live";
  data.sections.injury_report.chip_tone = "live";
  data.sections.farm_system.chip_label = "Editorial";
  data.sections.farm_system.chip_tone = "editorial";

  const html = populate(template, data);
  assert.match(html, /pw-section-chip--final">Final/);
  assert.match(html, /pw-section-chip--confirmed">Confirmed/);
  assert.match(html, /pw-section-chip--live">Live/);
  assert.match(html, /pw-section-chip--editorial">Editorial/);
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

function runTest(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (error) {
    console.error("FAIL", name);
    throw error;
  }
}
