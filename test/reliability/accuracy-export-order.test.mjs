// RELIABILITY: the accuracy export must describe the HTML this run rendered.
//
// run.mjs used to call `factcheck.mjs --export-accuracy` BEFORE render.mjs, so
// the export's deterministic HTML checks read the previous run's
// phillies-wire-output.html, or nothing on a fresh CI checkout (the file is
// gitignored). The scorecard could therefore never carry a pipeline-integrity
// finding for the edition it claimed to describe, while the docs said the
// export runs post-render. The export now runs after render and mirrors the
// report into site/ itself so verify.mjs's root/site equality gate still holds.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAccuracyReport } from "../../factcheck.mjs";
import { test, run, assert } from "./_harness.mjs";

const runSource = readFileSync(new URL("../../run.mjs", import.meta.url), "utf8");

function stageOrder(listName) {
  const match = runSource.match(new RegExp(`const ${listName}\\s*=\\s*\\[([^\\]]+)\\]`));
  assert.ok(match, `sanity: located ${listName}`);
  return match[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

test("PIN: the accuracy export stage runs after render.mjs and before verify.mjs (daily)", () => {
  const order = stageOrder("DAILY_STAGES");
  const render = order.indexOf("render.mjs");
  const exportStage = order.indexOf("ACCURACY_EXPORT_STAGE");
  const verify = order.indexOf("verify.mjs");
  assert.ok(render >= 0 && exportStage >= 0 && verify >= 0, `stages: ${order}`);
  assert.ok(render < exportStage, "export must follow render so it inspects this run's HTML");
  assert.ok(exportStage < verify, "verify must still gate on the exported report");
});

test("PIN: the accuracy export stage runs after render.mjs and before verify.mjs (live)", () => {
  const order = stageOrder("LIVE_STAGES");
  assert.ok(order.indexOf("render.mjs") < order.indexOf("ACCURACY_EXPORT_STAGE"));
  assert.ok(order.indexOf("ACCURACY_EXPORT_STAGE") < order.indexOf("verify.mjs"));
});

test("writeAccuracyReport mirrors the report into an existing site tree", () => {
  const work = mkdtempSync(join(tmpdir(), "pw-accuracy-mirror-"));
  try {
    const rootPath = join(work, "dashboard", "accuracy", "accuracy.json");
    const sitePath = join(work, "site", "dashboard", "accuracy", "accuracy.json");
    const report = { schema_version: "accuracy-1.0.0", summary: { total_claims: 0 }, sections: [] };

    // No site/ yet: only the root copy is written.
    writeAccuracyReport(report, rootPath, sitePath);
    assert.ok(existsSync(rootPath));
    assert.ok(!existsSync(sitePath), "must not create site/ when render has not built it");

    // site/ exists (render ran): both copies are written and identical.
    mkdirSync(join(work, "site"), { recursive: true });
    writeAccuracyReport(report, rootPath, sitePath);
    assert.ok(existsSync(sitePath));
    assert.equal(readFileSync(rootPath, "utf8"), readFileSync(sitePath, "utf8"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

await run();
