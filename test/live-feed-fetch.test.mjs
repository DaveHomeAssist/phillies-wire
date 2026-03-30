import assert from "assert";

import { fetchJson } from "../live-feed.js";

await runTest("fetchJson rejects non-OK responses so polling can fall back cleanly", async () => {
  const fetchImpl = async function() {
    return {
      ok: false,
      status: 503,
      json() {
        throw new Error("json should not be read for non-OK responses");
      },
    };
  };

  await assert.rejects(
    fetchJson(fetchImpl, "https://example.com/linescore"),
    /503/,
  );
});

async function runTest(name, fn) {
  try {
    await fn();
    console.log("PASS", name);
  } catch (error) {
    console.error("FAIL", name);
    throw error;
  }
}
