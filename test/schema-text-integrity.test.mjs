import assert from "assert";
import { readFileSync } from "node:fs";

const schemaText = readFileSync(new URL("../phillies-wire-schema.json", import.meta.url), "utf8");

runTest("schema fixture does not contain mojibake in user-facing fallback copy", () => {
  const mojibakePattern = /Â·|Â°|â€“|â€”|Ã[^\s]/;

  assert.ok(!mojibakePattern.test(schemaText), "Schema fixture still contains mojibake.");
  assert.ok(schemaText.includes('PHI leads 1–0'));
  assert.ok(schemaText.includes('NBCSP+ · 94.1 WIP'));
  assert.ok(schemaText.includes('48° · Mostly sunny · NNW 15–20 mph'));
  assert.ok(schemaText.includes('Luzardo vs Gore · Sun Mar 29 · 1:35 PM ET'));
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
