import assert from "assert";

import { buildPregamePreviewContent, buildRecapPullQuote } from "../pregame-preview.js";

runTest("buildPregamePreviewContent refreshes stale baseline copy with today's starters", () => {
  const preview = buildPregamePreviewContent({
    matchup: "Phillies vs Rangers - Game 3",
    firstPitch: "1:35 PM",
    venue: "Citizens Bank Park, Philadelphia",
    seriesLabel: "Series tied 1-1",
    starters: {
      home: { name: "Jesus Luzardo" },
      away: { name: "MacKenzie Gore" },
    },
  });

  assert.strictEqual(preview.preview, "Jesus Luzardo vs MacKenzie Gore" + " · " + "Phillies vs Rangers - Game 3");
  assert.ok(preview.content.narrative[0].includes("Jesus Luzardo"));
  assert.ok(preview.content.narrative[0].includes("MacKenzie Gore"));
  assert.ok(!preview.content.narrative[0].includes("Aaron Nola"));
  assert.ok(!preview.content.narrative[0].includes("Jacob deGrom"));
  assert.ok(preview.content.narrative[1].includes("1:35 PM"));
  assert.ok(preview.content.narrative[1].includes("Citizens Bank Park"));
  assert.ok(preview.content.narrative[1].includes("Series tied 1-1"));
  assert.strictEqual(preview.content.pull_quote, "Jesus Luzardo vs MacKenzie Gore drives today's matchup.");
});

runTest("buildRecapPullQuote seeds final recap copy from the current result", () => {
  const pullQuote = buildRecapPullQuote({
    summaryLine: "PHI 3, TEX 8.",
    venue: "Citizens Bank Park, Philadelphia",
    seriesLabel: "Rangers win series 2-1",
  });

  assert.ok(pullQuote.includes("PHI 3, TEX 8."));
  assert.ok(pullQuote.includes("Citizens Bank Park"));
  assert.ok(pullQuote.includes("Rangers win series 2-1"));
  assert.ok(!pullQuote.includes("Sanchez"));
  assert.ok(!pullQuote.includes("Nola"));
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
