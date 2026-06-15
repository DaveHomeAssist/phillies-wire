// Shared assertion harness for reliability tests.
//
// Matches the existing repo convention (a local runTest that logs PASS/FAIL
// and throws), but centralizes it and adds a small set of helpers so each new
// test file stays terse. A file registers cases with `test(...)` and ends with
// `await run()`, which prints a per-file summary and exits non-zero on failure.

import assert from "node:assert/strict";

const cases = [];

export function test(name, fn) {
  cases.push({ name, fn });
}

export async function run() {
  let failed = 0;
  for (const c of cases) {
    try {
      await c.fn();
      console.log("PASS", c.name);
    } catch (error) {
      failed += 1;
      console.error("FAIL", c.name);
      console.error("      " + (error?.message ?? String(error)).split("\n").join("\n      "));
    }
  }
  if (failed) {
    console.error(`\n${failed} of ${cases.length} cases failed.`);
    process.exit(1);
  }
  console.log(`\n${cases.length} cases passed.`);
}

// Assert that a synchronous call throws.
export function expectThrows(fn, message) {
  assert.throws(fn, message ? new RegExp(message) : undefined);
}

// Assert a substring is absent (used for "must never render X" checks).
export function refuteIncludes(haystack, needle, context) {
  assert.ok(
    !String(haystack).includes(needle),
    `${context ?? "output"} must not contain ${JSON.stringify(needle)} — got: ${JSON.stringify(String(haystack).slice(0, 160))}`,
  );
}

export { assert };
