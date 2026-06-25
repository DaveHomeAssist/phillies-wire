import assert from "node:assert/strict";

import { parseJsonResponseText, stripMarkdownJsonFence, validateEditorialFields } from "../enrich.mjs";

const pregame = (previewQuote, recapQuote) => ({
  sections: {
    recap: { content: { pull_quote: recapQuote } },
    preview: { content: { narrative: ["One.", "Two."], pull_quote: previewQuote } },
  },
});

runTest("pregame enrichment passes with an empty recap pull_quote", () => {
  // Morning issues have no recap yet; the daily fallback bug was requiring it.
  const original = pregame("source preview quote", "");
  const delta = pregame("enriched preview quote", "");
  validateEditorialFields(original, delta);
});

runTest("recap pull_quote stays required once a recap exists", () => {
  const original = pregame("source preview quote", "Final: Phillies win.");
  const delta = pregame("enriched preview quote", "");
  assert.throws(() => validateEditorialFields(original, delta), /recap pull_quote/);
});

runTest("preview pull_quote is always required", () => {
  const original = pregame("source preview quote", "");
  const delta = pregame("", "");
  assert.throws(() => validateEditorialFields(original, delta), /preview pull_quote/);
});

runTest("stripMarkdownJsonFence unwraps fenced JSON", () => {
  const text = "```json\n{\"ok\":true}\n```";
  assert.equal(stripMarkdownJsonFence(text), "{\"ok\":true}");
});

runTest("parseJsonResponseText accepts fenced JSON", () => {
  const parsed = parseJsonResponseText("```json\n{\"ticker\":[]}\n```");
  assert.deepEqual(parsed, { ticker: [] });
});

runTest("parseJsonResponseText accepts plain JSON", () => {
  const parsed = parseJsonResponseText("{\"ok\":true}");
  assert.deepEqual(parsed, { ok: true });
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
