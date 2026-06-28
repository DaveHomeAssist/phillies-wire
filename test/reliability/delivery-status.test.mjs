// RELIABILITY: delivery-status.json producer signal
//
// deliver.mjs must leave a machine-readable delivery-status.json artifact after
// sendDelivery returns so the out-of-band health check can validate email
// delivery without scraping CI logs.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main as deliverMain, writeDeliveryStatus } from "../../deliver.mjs";
import { test, run, assert } from "./_harness.mjs";

test("G4: deliver writes delivery-status.json after a successful send", async () => {
  const work = mkdtempSync(join(tmpdir(), "pw-delivery-status-"));
  const previousCwd = process.cwd();
  const previousEnv = {
    DELIVERY_RECIPIENTS: process.env.DELIVERY_RECIPIENTS,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
  };

  try {
    process.chdir(work);
    mkdirSync("site", { recursive: true });
    writeFileSync(
      "phillies-wire-data.json",
      JSON.stringify({
        meta: { publication: "Phillies Wire", date: "2026-06-16", off_day: true },
        record: { wins: 40, losses: 30 },
        next_game: { matchup: "PHI vs NYM", date: "2026-06-17", time: "6:40 PM" },
        sections: {},
      }),
    );
    writeFileSync("phillies-wire-email.html", "<html><head></head><body>Wire</body></html>");
    process.env.DELIVERY_RECIPIENTS = "fan@example.com";
    process.env.SMTP_USER = "wire@example.com";
    process.env.SMTP_PASS = "stub-password";

    await deliverMain({
      createTransportImpl: () => ({
        verify: async () => {},
        sendMail: async () => {},
        close: () => {},
      }),
    });

    assert.equal(existsSync("delivery-status.json"), true);
    assert.equal(existsSync("site/delivery-status.json"), true);
    const status = JSON.parse(readFileSync("delivery-status.json", "utf8"));
    assert.deepEqual(Object.keys(status), [
      "schema_version",
      "generated_at",
      "state",
      "required",
      "delivered",
      "failed",
    ]);
    assert.equal(status.schema_version, "delivery-1.0.0");
    assert.equal(status.state, "sent");
    assert.equal(status.required, true);
    assert.equal(status.delivered, 1);
    assert.equal(status.failed, 0);
    assert.equal(typeof status.failed, "number");
    assert.doesNotThrow(() => new Date(status.generated_at).toISOString());
  } finally {
    process.chdir(previousCwd);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(work, { recursive: true, force: true });
  }
});

test("G4b: live refresh can write skipped delivery status", () => {
  const work = mkdtempSync(join(tmpdir(), "pw-delivery-skipped-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(work);
    mkdirSync("site", { recursive: true });
    const status = writeDeliveryStatus({ state: "skipped", required: false });
    const rootStatus = JSON.parse(readFileSync("delivery-status.json", "utf8"));
    const siteStatus = JSON.parse(readFileSync("site/delivery-status.json", "utf8"));

    assert.equal(status.state, "skipped");
    assert.equal(rootStatus.state, "skipped");
    assert.equal(siteStatus.state, "skipped");
    assert.equal(rootStatus.required, false);
  } finally {
    process.chdir(previousCwd);
    rmSync(work, { recursive: true, force: true });
  }
});

await run();
