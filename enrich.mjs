import { readFileSync, writeFileSync } from "node:fs";
import https from "node:https";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 2000;
const ERROR_LOG = "./enrich-error.log";
const DATA_FILE = "./phillies-wire-data.json";

const SYSTEM = `You are a beat reporter for the Philadelphia Phillies.
Write in a clear, confident, non-academic voice.
No hyphens in prose. No em dashes under any circumstances.
Imperative mood in section previews.

Return ONLY valid JSON matching the exact input schema.
Do not add keys. Do not wrap in markdown. Do not include preamble.`;

main().catch((error) => fail(error));

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required to run enrich.mjs.");
  }

  const input = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const original = cloneJson(input);
  const responseText = await requestEnrichment(apiKey, input);
  const enriched = parseJson(responseText);

  validateShape(original, enriched);
  validateEditorialFields(original, enriched);

  writeFileSync(DATA_FILE, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  console.log("phillies-wire-data.json enriched");
}

async function requestEnrichment(apiKey, data) {
  const userPrompt = `Enrich the following fields with editorial copy.
Leave all structured fields (scores, times, names, badge values) exactly as provided.
Write only to these targets:
- sections.recap.content.pull_quote
- sections.preview.content.narrative (array of 2-3 paragraphs)
- sections.preview.content.pull_quote
- ticker (reorder or rewrite highlight items for editorial punch)

Raw payload:
${JSON.stringify(data, null, 2)}`;

  const payload = await postJson("https://api.anthropic.com/v1/messages", {
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    },
  });

  const text = (payload.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("");
  if (!text.trim()) {
    throw new Error("Anthropic response did not contain any text content.");
  }

  return text;
}

function parseJson(responseText) {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    writeFileSync(ERROR_LOG, responseText, "utf8");
    throw new Error(`Claude response did not parse as JSON: ${error.message}`);
  }
}

function validateShape(original, enriched) {
  const diffs = [];
  compareShape(original, enriched, "root", diffs);
  if (diffs.length) {
    throw new Error(`Schema keys changed: ${diffs.join("; ")}`);
  }
}

function validateEditorialFields(original, enriched) {
  const recapQuote = enriched.sections?.recap?.content?.pull_quote;
  const previewQuote = enriched.sections?.preview?.content?.pull_quote;
  const narrative = enriched.sections?.preview?.content?.narrative;

  if (!isNonEmptyString(recapQuote) || !isNonEmptyString(previewQuote)) {
    throw new Error("Both pull_quote fields must be non-empty strings.");
  }

  if (!Array.isArray(narrative) || narrative.length < 2 || narrative.length > 3 || narrative.some((value) => !isNonEmptyString(value))) {
    throw new Error("sections.preview.content.narrative must be an array of 2-3 non-empty strings.");
  }

  const allStrings = [];
  collectStrings(enriched, allStrings);
  if (allStrings.some((value) => /—/g.test(value))) {
    throw new Error("Enriched payload contains an em dash.");
  }

  const immutablePaths = [
    "sections.recap.content.result",
    "sections.game_status.content.starters",
    "sections.roster.content.rotation",
    "sections.roster.content.highlights",
    "sections.injury_report.content.il_entries",
    "sections.preview.content.up_next",
    "next_game",
  ];

  for (const path of immutablePaths) {
    const before = JSON.stringify(resolvePath(original, path));
    const after = JSON.stringify(resolvePath(enriched, path));
    if (before !== after) {
      throw new Error(`Structured data changed at ${path}.`);
    }
  }
}

function compareShape(left, right, path, diffs) {
  if (Array.isArray(left)) {
    if (!Array.isArray(right)) {
      diffs.push(`${path} expected array`);
      return;
    }

    if (left.length && right.length) {
      compareShape(left[0], right[0], `${path}[0]`, diffs);
    }
    return;
  }

  if (left && typeof left === "object") {
    if (!right || typeof right !== "object" || Array.isArray(right)) {
      diffs.push(`${path} expected object`);
      return;
    }

    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.join("|") !== rightKeys.join("|")) {
      diffs.push(`${path} keys differ`);
    }

    for (const key of leftKeys) {
      compareShape(left[key], right[key], `${path}.${key}`, diffs);
    }
  }
}

function collectStrings(value, output) {
  if (typeof value === "string") {
    output.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, output);
    }
  }
}

function resolvePath(value, path) {
  return path.split(".").reduce((current, part) => current?.[part], value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(error) {
  const message = `[${new Date().toISOString()}] ${error.stack ?? error.message}\n`;
  writeFileSync(ERROR_LOG, message, "utf8");
  console.error(error.message);
  process.exit(1);
}

function postJson(url, { headers, body }) {
  const parsed = new URL(url);
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          ...headers,
          "content-length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          let parsedBody;
          try {
            parsedBody = JSON.parse(raw);
          } catch (error) {
            reject(error);
            return;
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(parsedBody?.error?.message ?? `Anthropic request failed with status ${response.statusCode}.`));
            return;
          }

          resolve(parsedBody);
        });
      },
    );

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
