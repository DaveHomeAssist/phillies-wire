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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// GitHub Pages reports a custom domain's page_url as http:// until "Enforce
// HTTPS" is enabled (cert provisioning). The deployed site serves HTTPS
// regardless, and we probe with node:https, so upgrade the scheme rather than
// hard-failing the post-deploy check on the protocol prefix.
const BASE_URL = (process.env.PHILLIES_WIRE_BASE_URL ?? "https://davehomeassist.github.io/phillies-wire")
  .replace(/^http:\/\//i, "https://");
const MAX_AGE_MIN = Number(process.env.PHILLIES_WIRE_MAX_AGE_MIN ?? 240);
const WEBHOOK = process.env.PHILLIES_WIRE_WEBHOOK;
const HEALTH_DIR = process.env.PHILLIES_WIRE_HEALTH_DIR;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    fail(error.message).finally(() => process.exit(1));
  });
}

export async function main() {
  const { status, latest, issueData, issueHtml, delivery } = HEALTH_DIR
    ? await loadLocalSnapshot(HEALTH_DIR)
    : await loadRemoteSnapshot(BASE_URL);
  const result = validateHealthSnapshot({
    status,
    latest,
    issueData,
    issueHtml,
    delivery,
  }, {
    maxAgeMin: MAX_AGE_MIN,
  });
  console.log(`OK: status.json is ${result.ageMin}m old. Latest issue ${status.date}. Delivery ${delivery.state}.`);
}

async function loadRemoteSnapshot(baseUrlValue) {
  const baseUrl = baseUrlValue.replace(/\/$/, "");
  const status = await fetchJson(`${baseUrl}/status.json`);
  const issuePath = status?.issue_path || (status?.date ? `issues/${status.date}/` : null);
  const [latest, issueData, issueHtml, delivery] = await Promise.all([
    fetchJson(`${baseUrl}/latest.json`),
    issuePath ? fetchJson(`${baseUrl}/${issuePath.replace(/^\//, "")}data.json`) : Promise.resolve(null),
    issuePath ? fetchText(`${baseUrl}/${issuePath.replace(/^\//, "")}`) : Promise.resolve(""),
    fetchJson(`${baseUrl}/delivery-status.json`),
  ]);
  return { status, latest, issueData, issueHtml, delivery };
}

async function loadLocalSnapshot(baseDir) {
  const status = await readLocalJson(baseDir, "status.json");
  const issuePath = status?.issue_path || (status?.date ? `issues/${status.date}/` : null);
  const [latest, issueData, issueHtml, delivery] = await Promise.all([
    readLocalJson(baseDir, "latest.json"),
    issuePath ? readLocalJson(baseDir, issuePath.replace(/^\//, ""), "data.json") : Promise.resolve(null),
    issuePath ? readLocalText(baseDir, issuePath.replace(/^\//, ""), "index.html") : Promise.resolve(""),
    readLocalJson(baseDir, "delivery-status.json"),
  ]);
  return { status, latest, issueData, issueHtml, delivery };
}

export function validateHealthSnapshot({ status, latest, issueData, issueHtml, delivery }, options = {}) {
  const maxAgeMin = Number(options.maxAgeMin ?? MAX_AGE_MIN);
  const now = options.now ?? new Date();

  if (!status?.generated_at) {
    throw new Error("status.json did not include generated_at");
  }
  const generatedMs = Date.parse(status.generated_at);
  if (!Number.isFinite(generatedMs)) {
    throw new Error(`generated_at is not a valid date: ${status.generated_at}`);
  }
  const ageMin = Math.round((now.getTime() - generatedMs) / 60000);
  if (ageMin > maxAgeMin) {
    throw new Error(`status.json is ${ageMin}m old (budget: ${maxAgeMin}m).`);
  }

  if (!status.date || !status.issue_path) {
    throw new Error("status.json is missing date or issue_path");
  }
  if (!latest || latest.edition_date !== status.date) {
    throw new Error("latest.json edition_date does not match status.json date");
  }
  if (!latest.generated_at || Number.isNaN(Date.parse(latest.generated_at))) {
    throw new Error("latest.json generated_at is missing or invalid");
  }

  const issueRequired = ["schema_version", "meta", "record", "hero", "sections", "next_game"];
  for (const key of issueRequired) {
    if (!(key in (issueData ?? {}))) {
      throw new Error(`issue data.json is missing required key: ${key}`);
    }
  }
  if (issueData.meta?.date !== status.date) {
    throw new Error("issue data.json meta.date does not match status.json date");
  }
  if (issueData.meta?.status?.crawl_state == null) {
    throw new Error("issue data.json is missing meta.status.crawl_state");
  }

  if (/\{\{[^{}\n]{1,80}\}\}/.test(String(issueHtml ?? ""))) {
    throw new Error("issue HTML contains unresolved template tokens");
  }
  if (String(issueHtml ?? "").includes("[object Object]")) {
    throw new Error('issue HTML contains "[object Object]"');
  }

  if (!delivery?.schema_version || !delivery.generated_at || !delivery.state) {
    throw new Error("delivery-status.json is missing required fields");
  }
  if (Number.isNaN(Date.parse(delivery.generated_at))) {
    throw new Error(`delivery-status.json generated_at is invalid: ${delivery.generated_at}`);
  }
  if (delivery.state === "failed" || delivery.state === "misconfigured") {
    throw new Error(`delivery status is ${delivery.state}${delivery.reason ? `: ${delivery.reason}` : ""}`);
  }
  if (delivery.required && Number(delivery.delivered ?? 0) < 1) {
    throw new Error("delivery was required but no recipients were delivered");
  }
  if (Number(delivery.failed ?? 0) > 0) {
    throw new Error(
      `delivery had ${Number(delivery.failed)} failed recipient(s) (delivered ${Number(delivery.delivered ?? 0)})`,
    );
  }
  if (delivery.state === "partial") {
    throw new Error(`delivery status is partial${delivery.reason ? `: ${delivery.reason}` : ""}`);
  }

  return { ageMin };
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
  return fetchText(url).then((raw) => JSON.parse(raw));
}

function readLocalJson(...parts) {
  return readLocalText(...parts).then((raw) => JSON.parse(raw));
}

function readLocalText(...parts) {
  return readFile(join(...parts), "utf8");
}

function fetchText(url) {
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
      response.on("end", () => { resolve(raw); });
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
