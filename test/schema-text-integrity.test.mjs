import assert from "assert";
import { readFileSync } from "node:fs";

const schemaText = readFileSync(new URL("../phillies-wire-schema.json", import.meta.url), "utf8");

runTest("schema fixture does not contain mojibake or dated game-specific fallback copy", () => {
  const mojibakePattern = /Â·|Â°|â€“|â€”|Ã[^\s]/;
  const staleFixturePattern = /Trea Turner|Kyle Schwarber|Bryce Harper|Nick Castellanos|Jacob deGrom|Aaron Nola|Wheeler rehab|Kerkering|Max Lazar|Toledo Mud Hens|Sun Mar 29|NBCSP\+|94\.1 WIP|48°|PHI leads 1–0/;

  assert.ok(!mojibakePattern.test(schemaText), "Schema fixture still contains mojibake.");
  assert.ok(!staleFixturePattern.test(schemaText), "Schema fixture still contains dated game-specific fallback copy.");
  assert.ok(schemaText.includes("Schedule refresh required"));
  assert.ok(schemaText.includes("Lineups pending MLB confirmation"));
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
