import assert from "node:assert/strict";

import { parseJsonResponseText, stripMarkdownJsonFence } from "../enrich.mjs";

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
