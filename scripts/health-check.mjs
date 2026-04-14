#!/usr/bin/env node
// Health check: fetches the deployed status.json and asserts the site
// has been updated within the configured freshness budget. Intended to
// run out-of-band (a separate cron or uptime monitor) so we find out if
// the publish pipeline silently breaks.
//
// Usage:
//   node scripts/health-check.mjs
//
// Environment:
//   PHILLIES_WIRE_BASE_URL    - origin to probe (default GitHub Pages URL)
//   PHILLIES_WIRE_MAX_AGE_MIN - maximum allowed age in minutes (default 240)
//   PHILLIES_WIRE_WEBHOOK     - optional Slack/Discord webhook for failure

import https from "node:https";

const BASE_URL = process.env.PHILLIES_WIRE_BASE_URL ?? "https://davehomeassist.github.io/phillies-wire";
const MAX_AGE_MIN = Number(process.env.PHILLIES_WIRE_MAX_AGE_MIN ?? 240);
const WEBHOOK = process.env.PHILLIES_WIRE_WEBHOOK;

main().catch((error) => {
  fail(error.message).finally(() => process.exit(1));
});

async function main() {
  const statusUrl = `${BASE_URL.replace(/\/$/, "")}/status.json`;
  const payload = await fetchJson(statusUrl);
  if (!payload?.generated_at) {
    throw new Error("status.json did not include generated_at");
  }
  const generatedMs = Date.parse(payload.generated_at);
  if (!Number.isFinite(generatedMs)) {
    throw new Error(`generated_at is not a valid date: ${payload.generated_at}`);
  }
  const ageMin = Math.round((Date.now() - generatedMs) / 60000);
  if (ageMin > MAX_AGE_MIN) {
    throw new Error(`status.json is ${ageMin}m old (budget: ${MAX_AGE_MIN}m).`);
  }
  console.log(`OK: status.json is ${ageMin}m old. Latest issue ${payload.date}.`);
}

async function fail(message) {
  console.error(`HEALTH CHECK FAILED: ${message}`);
  if (!WEBHOOK) {
    return;
  }
  try {
    await postJson(WEBHOOK, { text: `Phillies Wire health check failed: ${message}` });
  } catch (error) {
    console.error(`Failed to post webhook: ${error.message}`);
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "cache-control": "no-cache" } }, (response) => {
      if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
        reject(new Error(`Request failed with status ${response.statusCode} for ${url}`));
        response.resume();
        return;
      }
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

function postJson(url, body) {
  const parsed = new URL(url);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    }, (response) => {
      response.resume();
      response.on("end", () => {
        if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300) {
          resolve();
          return;
        }
        reject(new Error(`Webhook failed with status ${response.statusCode}`));
      });
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}
