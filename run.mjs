import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DATA_FILE = "./phillies-wire-data.json";
const ARCHIVE_FILE = "./archive.json";
const DEFAULT_VOLUME = 1;

// Two operating modes:
//   daily — the morning publish. Full pipeline: crawl, enrich with Claude,
//           render, verify, deliver emails. Runs once per day.
//   live  — game-window refresh. Crawl (preserving morning editorial),
//           render, verify. No enrich (would burn Anthropic tokens
//           regenerating the same morning copy). No deliver (would spam
//           subscribers every 15 minutes during a game).
const ISSUE_MODE = (process.env.ISSUE_MODE || "daily").toLowerCase();
const IS_LIVE_REFRESH = ISSUE_MODE === "live";

const DAILY_STAGES = ["crawl.mjs", "enrich.mjs", "render.mjs", "verify.mjs"];
const LIVE_STAGES  = ["crawl.mjs", "render.mjs", "verify.mjs"];
const PIPELINE_STAGES = IS_LIVE_REFRESH ? LIVE_STAGES : DAILY_STAGES;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export function main() {
  console.log(`Pipeline mode: ${ISSUE_MODE}${IS_LIVE_REFRESH ? " (skipping enrich + deliver)" : ""}`);

  for (const stage of PIPELINE_STAGES) {
    const stageEnv = buildStageEnv(stage);
    runNodeStage(stage, stageEnv);

    if (stage === "crawl.mjs") {
      const editionMeta = syncEditionMetadata();
      const editionAction = editionMeta.reused ? "reused" : "assigned";
      console.log(
        `Edition ${editionAction}: Vol. ${editionMeta.volume} No. ${editionMeta.edition} for ${editionMeta.date}`,
      );
    }
  }

  if (IS_LIVE_REFRESH) {
    console.log("Delivery skipped: game-window refresh does not send email.");
    return;
  }

  if (process.env.DELIVERY_RECIPIENTS) {
    runNodeStage("deliver.mjs", buildStageEnv("deliver.mjs"));
  } else {
    console.log("Delivery skipped: DELIVERY_RECIPIENTS not set.");
  }
}

function buildStageEnv(stage) {
  const env = { ...process.env };
  // Scope the Anthropic key to the stage that needs it so a buggy downstream
  // stage cannot exfiltrate it.
  if (stage !== "enrich.mjs") {
    delete env.ANTHROPIC_API_KEY;
  }
  // SMTP credentials only need to reach the delivery stage.
  if (stage !== "deliver.mjs") {
    delete env.SMTP_USER;
    delete env.SMTP_PASS;
  }
  return env;
}

export function runNodeStage(scriptName, stageEnv = process.env) {
  console.log(`\n==> Running ${scriptName}`);
  const result = spawnSync(process.execPath, [scriptName], {
    stdio: "inherit",
    env: stageEnv,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.signal) {
    console.error(`${scriptName} terminated with signal ${result.signal}`);
    process.exit(1);
  }
}

export function syncEditionMetadata() {
  const data = readJson(DATA_FILE);
  const archive = readJson(ARCHIVE_FILE, {
    schema_version: null,
    publication: "",
    updated_at: null,
    latest_date: null,
    entries: [],
  });

  const issueDate = data.meta?.date;
  if (!issueDate) {
    throw new Error("Cannot assign edition metadata without meta.date in phillies-wire-data.json.");
  }

  const editionMeta = resolveEditionMetadata(issueDate, data, archive.entries ?? []);
  data.meta = data.meta ?? {};
  data.meta.volume = editionMeta.volume;
  data.meta.edition = editionMeta.edition;

  writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return editionMeta;
}

export function resolveEditionMetadata(issueDate, data, entries) {
  const currentEntry = entries.find((entry) => entry.date === issueDate);
  if (currentEntry) {
    return {
      date: issueDate,
      volume: Number(currentEntry.volume) || Number(data.meta?.volume) || DEFAULT_VOLUME,
      edition: Number(currentEntry.edition) || 1,
      reused: true,
    };
  }

  const latestEntry = [...entries]
    .filter((entry) => entry?.date)
    .sort((left, right) => right.date.localeCompare(left.date))[0];

  if (!latestEntry) {
    return {
      date: issueDate,
      volume: Number(data.meta?.volume) || DEFAULT_VOLUME,
      edition: 1,
      reused: false,
    };
  }

  const issueYear = issueDate.slice(0, 4);
  const latestYear = latestEntry.date.slice(0, 4);

  if (issueYear > latestYear) {
    return {
      date: issueDate,
      volume: (Number(latestEntry.volume) || Number(data.meta?.volume) || DEFAULT_VOLUME) + 1,
      edition: 1,
      reused: false,
    };
  }

  if (issueYear === latestYear && issueDate > latestEntry.date) {
    return {
      date: issueDate,
      volume: Number(latestEntry.volume) || Number(data.meta?.volume) || DEFAULT_VOLUME,
      edition: (Number(latestEntry.edition) || 0) + 1,
      reused: false,
    };
  }

  return {
    date: issueDate,
    volume: Number(latestEntry.volume) || Number(data.meta?.volume) || DEFAULT_VOLUME,
    edition: Number(data.meta?.edition) || 1,
    reused: false,
  };
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) {
    return fallback;
  }

  return JSON.parse(readFileSync(path, "utf8"));
}
