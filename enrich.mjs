import { readFileSync, writeFileSync } from "node:fs";
import https from "node:https";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4000;
const ERROR_LOG = "./enrich-error.log";
const DATA_FILE = "./phillies-wire-data.json";
const STRICT_MODE = process.env.ENRICH_STRICT === "true";

const SYSTEM = `You are a beat reporter for the Philadelphia Phillies.
Write in a clear, confident, non-academic voice.
No hyphens in prose. No em dashes under any circumstances.
Imperative mood in section previews.

Return ONLY valid JSON matching the exact editorial schema you are given.
Do not add keys. Do not wrap in markdown. Do not include preamble.`;

main().catch((error) => handleFatal(error));

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const input = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const editorialRequest = buildEditorialRequest(input);

  if (!apiKey) {
    const skipped = markEnrichmentStatus(input, "skipped", "Structured fallback published. ANTHROPIC_API_KEY was not set.");
    writeData(skipped);
    console.log("phillies-wire-data.json published without enrichment");
    return;
  }

  try {
    const responseText = await requestEnrichment(apiKey, editorialRequest);
    const editorialDelta = await parseWithRepair(apiKey, responseText, editorialRequest);
    validateShape(editorialRequest, editorialDelta);

    const enriched = mergeEditorial(input, editorialDelta);
    validateEditorialFields(enriched);
    markEnrichmentStatus(enriched, "enriched", "Editorial copy enriched via Claude.");
    writeData(enriched);
    console.log("phillies-wire-data.json enriched");
  } catch (error) {
    const fallback = markEnrichmentStatus(input, "fallback", `Structured fallback published after enrich failure: ${error.message}`);
    writeError(error);
    writeData(fallback);

    if (STRICT_MODE) {
      throw error;
    }

    console.log("phillies-wire-data.json published with structured fallback");
  }
}

async function requestEnrichment(apiKey, editorialRequest) {
  const userPrompt = `Enrich the following fields with editorial copy.
Keep the same JSON shape and write stronger editorial copy into the provided values only.
Do not edit any keys.

Editorial payload:
${JSON.stringify(editorialRequest, null, 2)}`;

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

async function parseWithRepair(apiKey, responseText, editorialRequest) {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    writeError(responseText);
    const repairedText = await requestRepair(apiKey, responseText, editorialRequest);

    try {
      return JSON.parse(repairedText);
    } catch (repairError) {
      writeError(repairedText);
      throw new Error(`Claude response did not parse as JSON after repair: ${repairError.message}`);
    }
  }
}

function validateShape(original, enriched) {
  const diffs = [];
  compareShape(original, enriched, "root", diffs);
  if (diffs.length) {
    throw new Error(`Schema keys changed: ${diffs.join("; ")}`);
  }
}

function validateEditorialFields(enriched) {
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
  if (allStrings.some((value) => /\u2014/g.test(value))) {
    throw new Error("Enriched payload contains an em dash.");
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

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function buildEditorialRequest(data) {
  return {
    ticker: cloneJson(data.ticker),
    sections: {
      recap: {
        content: {
          pull_quote: data.sections.recap.content.pull_quote,
        },
      },
      preview: {
        content: {
          narrative: cloneJson(data.sections.preview.content.narrative),
          pull_quote: data.sections.preview.content.pull_quote,
        },
      },
    },
  };
}

function mergeEditorial(data, editorialDelta) {
  const merged = cloneJson(data);
  merged.ticker = cloneJson(editorialDelta.ticker);
  merged.sections.recap.content.pull_quote = editorialDelta.sections.recap.content.pull_quote;
  merged.sections.preview.content.narrative = cloneJson(editorialDelta.sections.preview.content.narrative);
  merged.sections.preview.content.pull_quote = editorialDelta.sections.preview.content.pull_quote;
  return merged;
}

function markEnrichmentStatus(data, state, label) {
  data.meta = data.meta ?? {};
  data.meta.status = data.meta.status ?? {};
  data.meta.status.enrich_state = state;
  data.meta.status.enrich_label = label;
  return data;
}

function writeData(data) {
  writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function requestRepair(apiKey, badResponse, editorialRequest) {
  const payload = await postJson("https://api.anthropic.com/v1/messages", {
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: MODEL,
      max_tokens: 2000,
      system: "Return only valid JSON. Repair the malformed JSON while preserving the same editorial schema and intended copy.",
      messages: [
        {
          role: "user",
          content: `Repair this malformed JSON so it matches this schema exactly.\n\nSchema:\n${JSON.stringify(editorialRequest, null, 2)}\n\nMalformed response:\n${badResponse}`,
        },
      ],
    },
  });

  return (payload.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("");
}

function handleFatal(error) {
  writeError(error);
  console.error(error.message);
  process.exit(1);
}

function writeError(error) {
  const message = typeof error === "string" ? error : `[${new Date().toISOString()}] ${error.stack ?? error.message}\n`;
  writeFileSync(ERROR_LOG, message, "utf8");
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
