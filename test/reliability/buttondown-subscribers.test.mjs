// RELIABILITY: Buttondown subscriber merge
//
// The site Subscribe button feeds Buttondown. deliver.mjs merges active
// Buttondown subscribers with the manual DELIVERY_RECIPIENTS list (best
// effort, lowercase-deduped) so a new signup receives the next issue without
// hand-editing a secret. The fetch must never block the send. These cases pin
// the parse, the merge/dedupe, and the outage fallback.

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main as deliverMain, extractActiveSubscribers, dedupeEmails } from "../../deliver.mjs";
import { test, run, assert } from "./_harness.mjs";

test("extractActiveSubscribers keeps only regular subscribers and normalizes emails", () => {
  const rows = [
    { email_address: "Active@Example.com", type: "regular" },
    { email: "Old@Example.com", subscriber_type: "regular" }, // legacy field names
    { email_address: "pending@example.com", type: "unactivated" }, // dropped
    { email_address: "gone@example.com", type: "unsubscribed" }, // dropped
    { email_address: "", type: "regular" }, // dropped (no address)
    { type: "regular" }, // dropped (no email field)
  ];
  assert.deepEqual(extractActiveSubscribers(rows), ["active@example.com", "old@example.com"]);
  assert.deepEqual(extractActiveSubscribers(null), []);
});

test("dedupeEmails lowercases, dedupes, and drops non-addresses", () => {
  assert.deepEqual(
    dedupeEmails(["A@x.com", "a@x.com", " B@x.com ", "not-an-email", ""]),
    ["a@x.com", "b@x.com"],
  );
});

async function withDeliverEnv(fn) {
  const work = mkdtempSync(join(tmpdir(), "pw-buttondown-"));
  const prevCwd = process.cwd();
  const prevEnv = {
    DELIVERY_RECIPIENTS: process.env.DELIVERY_RECIPIENTS,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    BUTTONDOWN_API_KEY: process.env.BUTTONDOWN_API_KEY,
  };
  try {
    process.chdir(work);
    writeFileSync(
      "phillies-wire-data.json",
      JSON.stringify({
        meta: { publication: "Phillies Wire", date: "2026-06-25" },
        record: { wins: 1, losses: 0 },
        sections: {},
        next_game: {},
      }),
    );
    process.env.SMTP_USER = "wire@example.com";
    process.env.SMTP_PASS = "stub";
    await fn();
  } finally {
    process.chdir(prevCwd);
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v == null) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    rmSync(work, { recursive: true, force: true });
  }
}

test("delivery merges Buttondown subscribers with DELIVERY_RECIPIENTS and dedupes", async () => {
  await withDeliverEnv(async () => {
    process.env.DELIVERY_RECIPIENTS = "you@example.com, mom@example.com";
    process.env.BUTTONDOWN_API_KEY = "stub-key";
    let sent = 0;
    await deliverMain({
      createTransportImpl: () => ({ verify: async () => {}, sendMail: async () => { sent += 1; }, close: () => {} }),
      fetchSubscribersImpl: async () => ({
        ok: true,
        json: async () => ({
          results: [
            { email_address: "mom@example.com", type: "regular" }, // duplicate of env list
            { email_address: "NewFan@example.com", type: "regular" }, // brand-new signup
            { email_address: "pending@example.com", type: "unactivated" }, // not yet confirmed
          ],
          next: null,
        }),
      }),
    });
    // you + mom + newfan = 3 (mom de-duped, pending excluded)
    const status = JSON.parse(readFileSync("delivery-status.json", "utf8"));
    assert.equal(status.delivered, 3);
    assert.equal(sent, 3);
  });
});

test("a Buttondown outage falls back to DELIVERY_RECIPIENTS and does not block the send", async () => {
  await withDeliverEnv(async () => {
    process.env.DELIVERY_RECIPIENTS = "you@example.com";
    process.env.BUTTONDOWN_API_KEY = "stub-key";
    await deliverMain({
      createTransportImpl: () => ({ verify: async () => {}, sendMail: async () => {}, close: () => {} }),
      fetchSubscribersImpl: async () => {
        throw new Error("network down");
      },
    });
    const status = JSON.parse(readFileSync("delivery-status.json", "utf8"));
    assert.equal(status.delivered, 1); // still delivered to the manual list
    assert.equal(status.state, "sent");
  });
});

await run();
