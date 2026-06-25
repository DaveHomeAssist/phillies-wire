// RELIABILITY: deliver failure isolation (audit P1-DELIVER-1)
//
// run.mjs runs deliver.mjs LAST, after the site has already been rendered,
// verified, and effectively published. deliver.mjs's top-level
// `main().catch(() => process.exit(1))` means any SMTP failure (auth, refused
// connection, a single bad recipient) exits non-zero and marks the WHOLE
// pipeline run as failed — even though the public site already shipped. Email
// is best-effort; its failure should be logged, not fatal.
//
// Run deliver.mjs in a temp dir with a failing SMTP transport and a valid
// recipient + payload, then assert the exit behavior.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main as deliverMain, sendDelivery } from "../../deliver.mjs";
import { test, run, assert } from "./_harness.mjs";

let cachedRun = null;

async function runDeliver() {
  if (cachedRun) {
    return cachedRun;
  }
  cachedRun = runDeliverOnce();
  return cachedRun;
}

async function runDeliverOnce() {
  const work = mkdtempSync(join(tmpdir(), "pw-deliver-"));
  writeFileSync(
    join(work, "phillies-wire-data.json"),
    JSON.stringify({
      meta: { publication: "Phillies Wire", date: "2026-06-13", off_day: true },
      record: { wins: 40, losses: 28 },
      next_game: { matchup: "PHI vs NYM", date: "2026-06-14", time: "7:05 PM" },
      sections: {},
    }),
  );
  writeFileSync(join(work, "phillies-wire-email.html"), "<html><head></head><body>Wire</body></html>");
  const previousCwd = process.cwd();
  const previousEnv = {
    DELIVERY_RECIPIENTS: process.env.DELIVERY_RECIPIENTS,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_TIMEOUT_MS: process.env.SMTP_TIMEOUT_MS,
  };
  const captured = { stdout: "", stderr: "", closed: false, status: 0 };
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  process.chdir(work);
  process.env.DELIVERY_RECIPIENTS = "fan@example.com";
  process.env.SMTP_USER = "wire@example.com";
  process.env.SMTP_PASS = "app-password";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1";
  process.env.SMTP_TIMEOUT_MS = "250";

  console.log = (...args) => {
    captured.stdout += `${args.join(" ")}\n`;
  };
  console.warn = (...args) => {
    captured.stderr += `${args.join(" ")}\n`;
  };
  console.error = (...args) => {
    captured.stderr += `${args.join(" ")}\n`;
  };

  try {
    await deliverMain({
      createTransportImpl: () => ({
        verify: async () => {
          throw new Error(`verification failed for ${process.env.SMTP_PASS}`);
        },
        sendMail: async () => {
          throw new Error(`send failed for ${process.env.SMTP_PASS}`);
        },
        close: () => {
          captured.closed = true;
        },
      }),
    });
  } catch (error) {
    captured.status = 1;
    captured.stderr += `${error.message}\n`;
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
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

  return captured;
}

// --- Guard: secrets must never leak to logs even on failure ---
test("deliver never prints SMTP credentials to stdout/stderr", async () => {
  const res = await runDeliver();
  const combined = (res.stdout ?? "") + (res.stderr ?? "");
  assert.ok(!combined.includes("app-password"), "SMTP_PASS leaked to logs");
});

// --- Pin (open P1) ---
test("PIN P1: an SMTP failure after publish must not fail the pipeline (exit 0)", async () => {
  const res = await runDeliver();
  assert.equal(res.status, 0, `deliver exited ${res.status}; delivery failure should be logged, not fatal, because the site already published`);
  assert.equal(res.closed, true, "transport should be closed after a failed delivery attempt");
});

test("P2-DELIVER-2: one bad recipient is isolated and transient failures retry once", async () => {
  const attempts = new Map();
  const calls = [];
  let closed = false;
  const transport = {
    verify: async () => {},
    sendMail: async (message) => {
      calls.push(message.to);
      const count = attempts.get(message.to) ?? 0;
      attempts.set(message.to, count + 1);
      if (message.to === "flaky@example.com" && count === 0) {
        throw new Error("temporary failure");
      }
      if (message.to === "bad@example.com") {
        throw new Error("permanent failure");
      }
    },
    close: () => {
      closed = true;
    },
  };

  const result = await sendDelivery(transport, {
    from: "wire@example.com",
    to: "flaky@example.com,bad@example.com,good@example.com",
    subject: "Wire",
    text: "body",
    html: "<p>body</p>",
  }, { retries: 1 });

  assert.equal(result.delivered, 2);
  assert.equal(result.failed, 1);
  assert.equal(attempts.get("flaky@example.com"), 2);
  assert.equal(attempts.get("bad@example.com"), 2);
  assert.equal(attempts.get("good@example.com"), 1);
  assert.ok(calls.includes("good@example.com"), "good recipient was skipped after a prior failure");
  assert.equal(closed, true);
});

await run();
