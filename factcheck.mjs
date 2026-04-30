// FILE: factcheck.mjs
//
// Phillies Wire Fact-Checker
// --------------------------
// Verifies the most recent Wire edition against:
//   - Internal schema consistency (deterministic, offline)
//   - MLB Stats API (source of record for box scores, standings, IL, roster)
//   - MLB Pipeline prospect rankings (HTTP fetch)
//
// Run modes:
//   * pre-publish  — only deterministic checks, intended to be imported by
//                    verify.mjs and used as a hard publish gate. No network.
//   * daily        — full suite (deterministic + source-verified). Writes a
//                    Markdown report to ./reports/, upserts a Notion row, and
//                    emails on any errors. This is what the scheduled task runs.
//
// CLI:
//   node factcheck.mjs              → daily mode (default)
//   node factcheck.mjs --pre-publish → deterministic-only, exit 1 on any fail
//
// Env:
//   NOTION_API_KEY              — Notion integration token
//   FACTCHECK_DS_ID             — Notion data source id (override default)
//   FACTCHECK_RECIPIENTS        — comma-separated emails for error alerts
//   SMTP_USER / SMTP_PASS       — reuses deliver.mjs SMTP config
//   FACTCHECK_WIRE_ROOT         — override live Wire root URL
//   FACTCHECK_DASHBOARD_URL     — override live dashboard URL
//   FACTCHECK_WHITELIST_FILE    — path to editorial whitelist JSON
//   FACTCHECK_DRY_RUN           — "1" skips Notion + email side effects

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- Config ----------

const DEFAULT_DS_ID = "f67f24d7-9acf-4598-8a8b-6c74a61ae7bb";
const DEFAULT_WIRE_ROOT = "https://davehomeassist.github.io/phillies-wire/";
const DEFAULT_DASHBOARD = "https://davehomeassist.github.io/phillies-wire/dashboard/";

const DATA_FILE = join(__dirname, "phillies-wire-data.json");
const OUTPUT_HTML = join(__dirname, "phillies-wire-output.html");
const REPORTS_DIR = join(__dirname, "reports");
const WHITELIST_DEFAULT = join(__dirname, "factcheck-whitelist.json");

const MLB_TEAM_ID_PHI = 143;
const MLB_API = "https://statsapi.mlb.com/api/v1";

// NL East team IDs — used for standings reconciliation
const NL_EAST_IDS = {
  PHI: 143,
  ATL: 144,
  NYM: 121,
  MIA: 146,
  WSH: 120,
};

// ---------- Main ----------

const isPrePublish = process.argv.includes("--pre-publish");
const mode = isPrePublish ? "pre-publish" : "daily";
const DRY_RUN = process.env.FACTCHECK_DRY_RUN === "1";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[FACTCHECK] fatal: ${err.message}`);
    console.error(err.stack);
    process.exit(2);
  });
}

async function main() {
  console.log(`[FACTCHECK] mode=${mode} dry_run=${DRY_RUN}`);

  const { data, html, source } = loadLocalArtifacts();
  const editionDate = data?.meta?.date ?? todayISO();
  const volume = data?.meta?.volume ?? null;
  const issueNumber = data?.meta?.issue ?? null;
  const whitelist = loadWhitelist();

  const findings = {
    accurate: [],
    errors: [],
    stale: [],
    unverified: [],
    pipeline: [],
  };

  // --- Deterministic checks (always) ---
  runDeterministicChecks({ data, html, findings, whitelist });

  // --- Source-verified checks (daily only) ---
  if (mode === "daily") {
    await runSourceChecks({ data, findings });
  }

  applyWhitelist(findings, whitelist);

  const status = pickStatus(findings);
  const report = buildReport({
    editionDate,
    volume,
    issueNumber,
    status,
    findings,
    source,
    mode,
  });

  // --- Write Markdown report ---
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = join(REPORTS_DIR, `factcheck-${editionDate}.md`);
  writeFileSync(reportPath, report.markdown, "utf8");
  console.log(`[FACTCHECK] report written: ${reportPath}`);

  // --- Pre-publish gate exits here ---
  if (mode === "pre-publish") {
    const blocking = findings.errors.length + findings.pipeline.length;
    if (blocking > 0) {
      console.error(`[FACTCHECK] pre-publish BLOCKED: ${blocking} blocking issue(s)`);
      printSummary(findings);
      process.exit(1);
    }
    console.log(`[FACTCHECK] pre-publish OK`);
    return;
  }

  // --- Daily mode: Notion + email ---
  if (DRY_RUN) {
    console.log(`[FACTCHECK] dry-run — skipping Notion + email`);
    printSummary(findings);
    return;
  }

  try {
    await upsertNotionRow(report);
    console.log(`[FACTCHECK] notion row upserted`);
  } catch (e) {
    console.error(`[FACTCHECK] notion upsert failed: ${e.message}`);
  }

  const errCount = findings.errors.length + findings.stale.length + findings.pipeline.length;
  if (errCount > 0) {
    try {
      await emailReport(report);
      console.log(`[FACTCHECK] email sent`);
    } catch (e) {
      console.error(`[FACTCHECK] email failed: ${e.message}`);
    }
  } else {
    console.log(`[FACTCHECK] clean — no email`);
  }

  console.log(`[FACTCHECK] ${editionDate} status=${status} errors=${findings.errors.length} stale=${findings.stale.length} pipeline=${findings.pipeline.length}`);
  printSummary(findings);
}

// ---------- Artifact loading ----------

function loadLocalArtifacts() {
  let data = null;
  let html = null;
  let source = "local";

  if (existsSync(DATA_FILE)) {
    try { data = JSON.parse(readFileSync(DATA_FILE, "utf8")); } catch (e) {
      console.warn(`[FACTCHECK] data parse warn: ${e.message}`);
    }
  }
  if (existsSync(OUTPUT_HTML)) {
    html = readFileSync(OUTPUT_HTML, "utf8");
  }

  // Fallback to live fetch if local not present (e.g. running on a
  // different box than the renderer, or before first render of the day)
  if (!data || !html) {
    // Daily mode will fetch during source checks; pre-publish requires local.
    if (!data && !html) source = "live-fallback";
  }
  return { data, html, source };
}

function loadWhitelist() {
  const path = process.env.FACTCHECK_WHITELIST_FILE ?? WHITELIST_DEFAULT;
  if (!existsSync(path)) return { editorial_accepts: [] };
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) {
    console.warn(`[FACTCHECK] whitelist parse warn: ${e.message}`);
    return { editorial_accepts: [] };
  }
}

function applyWhitelist(findings, whitelist) {
  const accepts = new Set((whitelist.editorial_accepts ?? []).map((s) => String(s)));
  for (const bucket of ["errors", "stale", "unverified", "pipeline"]) {
    findings[bucket] = findings[bucket].filter((f) => !accepts.has(f.id));
  }
}

// ---------- Deterministic checks ----------

function runDeterministicChecks({ data, html, findings, whitelist: _w }) {
  if (!data) {
    findings.pipeline.push({
      id: "data-missing",
      title: "phillies-wire-data.json missing or unparseable",
      detail: "Fact-checker could not locate today's data artifact. Crawl/enrich likely failed.",
    });
    return;
  }

  // 1. Edition date matches today
  const today = todayISO();
  if (data.meta?.date && data.meta.date !== today) {
    findings.stale.push({
      id: "edition-date-stale",
      title: `Edition date ${data.meta.date} does not match today (${today})`,
      detail: "Pipeline did not refresh the edition stamp. Crawl/render may be reusing yesterday's artifact.",
    });
  }

  // 2. Token leakage in rendered HTML
  if (html) {
    const tokens = [...html.matchAll(/\{\{([^{}\n]{1,80})\}\}/g)]
      .map((m) => m[1].trim())
      .filter((t) => !t.startsWith("!"));
    if (tokens.length > 0) {
      findings.pipeline.push({
        id: "template-token-leak",
        title: `${tokens.length} unresolved template token(s) in rendered HTML`,
        detail: `Examples: ${[...new Set(tokens)].slice(0, 10).join(", ")}. Schema is missing these keys or render step skipped them.`,
      });
    }
  }

  // 3. Duplicate render blocks (weather/score strip regression)
  if (html) {
    const htmlWithoutTicker = stripTickerHtml(html);
    const stripRE = /(\d{2,3}°[^<]{0,80}(?:Overcast|Partly|Sunny|Clear|Rain|Cloudy|Wind|gusts)[^<]{0,80})/g;
    const weatherMatches = [...htmlWithoutTicker.matchAll(stripRE)].map((m) => m[1].trim());
    const dup = firstDuplicate(weatherMatches);
    if (dup) {
      findings.pipeline.push({
        id: "duplicate-weather-block",
        title: "Weather/conditions strip rendered more than once",
        detail: `Duplicate string: "${dup.slice(0, 120)}". Template is rendering the block twice — likely a partial inclusion bug.`,
      });
    }
  }

  // 4. Standings math: W + L ≥ 0 and GB consistent with leader
  const standingsRows = getStandingsRows(data);
  if (standingsRows.length) {
    const leader = standingsRows.find((r) => Number(r.gb) === 0) ?? standingsRows[0];
    if (leader && leader.wins != null && leader.losses != null) {
      for (const r of standingsRows) {
        if (r.wins == null || r.losses == null) continue;
        const expectedGB = ((leader.wins - r.wins) + (r.losses - leader.losses)) / 2;
        const numericGb = r.gb === "—" ? 0 : Number(r.gb);
        if (r.gb != null && Math.abs(numericGb - expectedGB) > 0.01) {
          findings.errors.push({
            id: `standings-gb-${r.abbr ?? r.team ?? "?"}`,
            title: `${r.abbr ?? r.team ?? "?"} GB (${r.gb}) does not reconcile with W-L vs. leader`,
            detail: `Leader ${leader.abbr ?? leader.team} ${leader.wins}-${leader.losses}. ${r.abbr ?? r.team} ${r.wins}-${r.losses} → expected GB ${expectedGB.toFixed(1)}.`,
          });
        }
      }
    }

    const phi = standingsRows.find((r) => r.is_phi || r.abbr === "PHI" || r.team === "PHI");
    if (phi && data.record) {
      if (data.record.wins !== phi.wins || data.record.losses !== phi.losses) {
        findings.errors.push({
          id: "record-standings-mismatch",
          title: "Header record does not match NL East standings row",
          detail: `Header: ${data.record.wins}-${data.record.losses}. Standings: ${phi.wins}-${phi.losses}.`,
        });
      }
      if (data.record.streak && phi.streak && data.record.streak !== phi.streak) {
        findings.errors.push({
          id: "record-streak-mismatch",
          title: "Header streak does not match NL East standings row",
          detail: `Header: ${data.record.streak}. Standings: ${phi.streak}.`,
        });
      }
      if (data.record.division_rank && phi.division_rank && Number(data.record.division_rank) !== Number(phi.division_rank)) {
        findings.errors.push({
          id: "record-division-rank-mismatch",
          title: "Header division rank does not match NL East standings row",
          detail: `Header: ${data.record.division_rank}. Standings: ${phi.division_rank}.`,
        });
      }
    }
  }

  // 5. "tonight"/"today"/"open tonight" phrasing must match edition date or game date
  if (html && data.meta?.date) {
    const gameDate = data.game?.date ?? data.meta.date;
    const opensTonight = /\bopen(?:s|ed)?\s+tonight\b/i.test(html);
    if (opensTonight && data.meta.date !== gameDate) {
      findings.stale.push({
        id: "opens-tonight-mismatch",
        title: '"opens tonight" phrasing but meta.date ≠ game.date',
        detail: `meta.date=${data.meta.date}, game.date=${gameDate}. Phrase likely copied from a prior edition.`,
      });
    }
  }

  // 6. Promo / SEPTA / giveaway fields internally consistent with game.firstPitch
  if (data.game?.firstPitch && data.promo?.septa_first_departure) {
    const fpMinutes = parseClockHM(data.game.firstPitch);
    const septaMinutes = parseClockHM(data.promo.septa_first_departure);
    if (fpMinutes != null && septaMinutes != null) {
      const diff = fpMinutes - septaMinutes;
      // SEPTA block typically starts 60–150 min before first pitch.
      // Anything >210 min before is almost certainly stale from a prior edition.
      if (diff > 210) {
        findings.stale.push({
          id: "septa-start-too-early",
          title: "SEPTA first-departure time is >3.5h before first pitch",
          detail: `firstPitch=${data.game.firstPitch}, SEPTA=${data.promo.septa_first_departure}. Likely copied from an earlier-start game.`,
        });
      }
    }
  }

  // 7. Giveaway date matches edition date
  if (data.promo?.giveaway?.date && data.meta?.date) {
    if (data.promo.giveaway.date !== data.meta.date) {
      findings.stale.push({
        id: "giveaway-date-mismatch",
        title: "Giveaway date does not match edition date",
        detail: `giveaway.date=${data.promo.giveaway.date}, edition=${data.meta.date}.`,
      });
    }
  }

  // 8. "veteran" label applied to players with <1 full MLB season of service
  if (data.roster?.notes) {
    for (const note of data.roster.notes) {
      if (/\bveteran\b/i.test(note.text ?? "") && note.mlb_service_years != null && note.mlb_service_years < 1) {
        findings.errors.push({
          id: `veteran-label-${note.player ?? "?"}`,
          title: `"veteran" label applied to ${note.player ?? "?"} (${note.mlb_service_years} yrs MLB service)`,
          detail: "Label requires ≥1 full MLB season. Swap to 'rookie' or 'sophomore'.",
        });
      }
    }
  }

  // 9. Dashboard dead-state heuristic: check for em-dash placeholders in a live scrape
  //    (Only flagged if html contains dashboard block AND we see >5 "—" inside data slots)
  if (html && html.includes("dashboard")) {
    const placeholderHits = (html.match(/<[^>]*data-slot[^>]*>\s*—\s*</g) ?? []).length;
    if (placeholderHits >= 5) {
      findings.pipeline.push({
        id: "dashboard-empty-slots",
        title: `Dashboard has ${placeholderHits} empty data slots (rendered em-dash)`,
        detail: "archive.json hydration is not running. Dashboard will look dead to readers.",
      });
    }
  }

  const recap = data.sections?.recap;
  if (recap?.show && recap.content?.date && data.meta?.date && recap.content.date !== data.meta.date) {
    findings.pipeline.push({
      id: "visible-recap-date-mismatch",
      title: "Visible recap date does not match edition date",
      detail: `recap.content.date=${recap.content.date}, edition=${data.meta.date}. Hide the recap or rebuild it from the current final.`,
    });
  }
}

// ---------- Source-verified checks ----------

async function runSourceChecks({ data, findings }) {
  // A. Previous-day box score reconciliation
  try {
    const yesterdayISO = offsetDays(todayISO(), -1);
    const sched = await fetchJSON(`${MLB_API}/schedule?sportId=1&teamId=${MLB_TEAM_ID_PHI}&date=${yesterdayISO}`);
    const game = sched?.dates?.[0]?.games?.[0];
    if (game && game.status?.abstractGameState === "Final") {
      const gamePk = game.gamePk;
      const boxscore = await fetchJSON(`${MLB_API}.1/game/${gamePk}/boxscore`).catch(() => null);
      if (boxscore) reconcileRecap({ data, boxscore, game, findings });
    }
  } catch (e) {
    findings.unverified.push({
      id: "recap-api-unreachable",
      title: "Could not reach MLB Stats API for recap reconciliation",
      detail: e.message,
    });
  }

  // B. Standings reconciliation
  try {
    const standings = await fetchJSON(`${MLB_API}/standings?leagueId=104&season=${new Date().getFullYear()}`);
    const nle = extractNLEast(standings);
    const wireRows = getStandingsRows(data);
    if (nle && wireRows.length) {
      for (const wireRow of wireRows) {
        const apiRow = nle[wireRow.abbr ?? wireRow.team];
        if (!apiRow) continue;
        if (apiRow.wins !== wireRow.wins || apiRow.losses !== wireRow.losses) {
          findings.errors.push({
            id: `standings-record-${wireRow.team}`,
            title: `${wireRow.team} record disagrees with MLB API`,
            detail: `Wire: ${wireRow.wins}-${wireRow.losses}. API: ${apiRow.wins}-${apiRow.losses}.`,
          });
        }
      }
    }
  } catch (e) {
    findings.unverified.push({
      id: "standings-api-unreachable",
      title: "Could not reach MLB Stats API for standings reconciliation",
      detail: e.message,
    });
  }

  // C. Injury list (transactions endpoint, since team/injuries returns 404 per CLAUDE.md)
  try {
    const today = todayISO();
    const start = offsetDays(today, -10);
    const tx = await fetchJSON(`${MLB_API}/transactions?teamId=${MLB_TEAM_ID_PHI}&startDate=${start}&endDate=${today}`);
    const activeIl = buildActiveIlFromTransactions(tx?.transactions ?? []);
    const wireInjuries = getInjuryEntries(data);
    if (wireInjuries.length || activeIl.length) {
      for (const apiIL of activeIl) {
        const playerName = apiIL.name;
        const wireEntry = wireInjuries.find((i) => (i.name ?? i.player ?? "").toLowerCase() === playerName.toLowerCase());
        if (!wireEntry) {
          findings.unverified.push({
            id: `il-missing-${slug(playerName)}`,
            title: `${playerName} in recent MLB transactions but not in Wire injury list`,
            detail: apiIL.description,
          });
        }
      }
    }
  } catch (e) {
    findings.unverified.push({
      id: "transactions-api-unreachable",
      title: "Could not reach MLB Stats API for transactions",
      detail: e.message,
    });
  }
}

function reconcileRecap({ data, boxscore, game, findings }) {
  const phiSide = boxscore.teams?.home?.team?.id === MLB_TEAM_ID_PHI ? "home" : "away";
  const phiBox = boxscore.teams?.[phiSide];
  const oppBox = boxscore.teams?.[phiSide === "home" ? "away" : "home"];
  if (!phiBox || !oppBox) return;

  const phiRuns = game.teams?.[phiSide]?.score;
  const oppRuns = game.teams?.[phiSide === "home" ? "away" : "home"]?.score;

  const wireRecap = data?.recap ?? data?.sections?.recap?.content ?? null;
  if (!wireRecap) return;

  // Final score line
  if (wireRecap.final_score) {
    const rx = /(?:PHI|Phillies)\s*(\d+)[,\-–\s]+(?:[A-Z]{2,3}|[A-Za-z ]+)\s*(\d+)|(?:[A-Z]{2,3}|[A-Za-z ]+)\s*(\d+)[,\-–\s]+(?:PHI|Phillies)\s*(\d+)/;
    const m = rx.exec(wireRecap.final_score);
    if (m) {
      const phiWire = Number(m[1] ?? m[4]);
      const oppWire = Number(m[2] ?? m[3]);
      if (phiWire !== phiRuns || oppWire !== oppRuns) {
        findings.errors.push({
          id: "recap-final-score",
          title: "Recap final score disagrees with MLB box score",
          detail: `Wire: ${wireRecap.final_score}. API: PHI ${phiRuns}, OPP ${oppRuns}.`,
        });
      }
    }
  }

  // Starter line (if present)
  const phiPitchers = phiBox.pitchers ?? [];
  const starterId = phiPitchers[0];
  const starterStats = starterId ? phiBox.players?.[`ID${starterId}`]?.stats?.pitching : null;
  if (starterStats && wireRecap.starter_line) {
    const rx = /(\d+(?:\.\d)?)\s*IP.*?(\d+)\s*H.*?(\d+)\s*ER.*?(\d+)\s*BB.*?(\d+)\s*K/is;
    const m = rx.exec(wireRecap.starter_line);
    if (m) {
      const [ , ip, h, er, bb, k ] = m;
      const disagree =
        String(starterStats.inningsPitched) !== String(ip) ||
        Number(starterStats.hits) !== Number(h) ||
        Number(starterStats.earnedRuns) !== Number(er) ||
        Number(starterStats.baseOnBalls) !== Number(bb) ||
        Number(starterStats.strikeOuts) !== Number(k);
      if (disagree) {
        findings.errors.push({
          id: "recap-starter-line",
          title: "Starter line disagrees with MLB box score",
          detail: `Wire: ${wireRecap.starter_line}. API: ${starterStats.inningsPitched} IP, ${starterStats.hits} H, ${starterStats.earnedRuns} ER, ${starterStats.baseOnBalls} BB, ${starterStats.strikeOuts} K.`,
        });
      }
    }
  }
}

function extractNLEast(standings) {
  const out = {};
  const records = standings?.records ?? [];
  for (const div of records) {
    for (const tr of div.teamRecords ?? []) {
      const code = teamCode(tr.team?.id);
      if (code) {
        out[code] = { wins: tr.wins, losses: tr.losses, gb: tr.gamesBack };
      }
    }
  }
  return out;
}

function teamCode(id) {
  const map = { 143: "PHI", 144: "ATL", 121: "NYM", 146: "MIA", 120: "WSH" };
  return map[id] ?? null;
}

function getStandingsRows(data) {
  return data?.sections?.standings?.content?.teams
    ?? data?.standings?.nl_east
    ?? [];
}

function getInjuryEntries(data) {
  return data?.sections?.injury_report?.content?.il_entries
    ?? data?.injuries
    ?? [];
}

function stripTickerHtml(html) {
  return String(html ?? "").replace(/<div class="pw-ticker">[\s\S]*?<\/div>\s*<\/div>/g, "");
}

function buildActiveIlFromTransactions(transactions = []) {
  const active = new Map();
  const sorted = [...transactions].sort((left, right) =>
    String(left.effectiveDate ?? left.date ?? "").localeCompare(String(right.effectiveDate ?? right.date ?? "")),
  );

  for (const transaction of sorted) {
    const description = transaction.description ?? "";
    const name = transaction.person?.fullName;
    if (!name || !description) {
      continue;
    }
    if (/activated .* from the .*injured list/i.test(description)) {
      active.delete(name);
      continue;
    }
    if (/placed .* on the .*injured list/i.test(description) || /transferred .* injured list .* injured list/i.test(description)) {
      active.set(name, { name, description });
    }
  }

  return [...active.values()];
}

// ---------- Report assembly ----------

function buildReport({ editionDate, volume, issueNumber, status, findings, source, mode }) {
  const wireURL = process.env.FACTCHECK_WIRE_ROOT ?? DEFAULT_WIRE_ROOT;
  const dashURL = process.env.FACTCHECK_DASHBOARD_URL ?? DEFAULT_DASHBOARD;
  const volString = volume && issueNumber ? `Vol ${volume} · No. ${issueNumber}` : (volume ?? "");

  const md = [];
  md.push(`# Fact-check — ${editionDate}${volString ? ` (${volString})` : ""}`);
  md.push("");
  md.push(`- Status: **${status}**`);
  md.push(`- Mode: ${mode}`);
  md.push(`- Source: ${source}`);
  md.push(`- Wire: ${wireURL}`);
  md.push(`- Dashboard: ${dashURL}`);
  md.push("");

  for (const [label, bucket] of [
    ["Errors", findings.errors],
    ["Stale copy", findings.stale],
    ["Pipeline issues", findings.pipeline],
    ["Unverified", findings.unverified],
    ["Accurate", findings.accurate],
  ]) {
    if (bucket.length === 0) continue;
    md.push(`## ${label} (${bucket.length})`);
    md.push("");
    for (const f of bucket) {
      md.push(`- **${f.title}**`);
      if (f.detail) md.push(`  ${f.detail}`);
    }
    md.push("");
  }

  return {
    editionDate,
    volume: volString,
    status,
    findings,
    wireURL,
    dashURL,
    markdown: md.join("\n"),
  };
}

function pickStatus(findings) {
  if (findings.pipeline.length > 0) return "Pipeline Bug";
  if (findings.errors.length > 0) return "Errors";
  if (findings.stale.length > 0) return "Stale Copy";
  return "Clean";
}

function printSummary(findings) {
  const tally = Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, v.length]));
  console.log(`[FACTCHECK] summary ${JSON.stringify(tally)}`);
}

// ---------- Notion upsert ----------

async function upsertNotionRow(report) {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    console.warn("[FACTCHECK] NOTION_API_KEY not set — skipping Notion upsert");
    return;
  }
  const dataSourceId = process.env.FACTCHECK_DS_ID ?? DEFAULT_DS_ID;
  const summary = buildNotionSummary(report);

  const properties = {
    "Edition": { title: [{ text: { content: `${report.editionDate}${report.volume ? " · " + report.volume : ""}` } }] },
    "Date": { date: { start: report.editionDate } },
    "Status": { select: { name: report.status } },
    "Error Count": { number: report.findings.errors.length },
    "Stale Count": { number: report.findings.stale.length },
    "Unverified": { number: report.findings.unverified.length },
    "Pipeline Issues": { number: report.findings.pipeline.length },
    "Volume": { rich_text: [{ text: { content: report.volume ?? "" } }] },
    "Wire URL": { url: report.wireURL },
    "Dashboard URL": { url: report.dashURL },
    "Summary": { rich_text: [{ text: { content: truncate(summary, 1800) } }] },
    "Errors Detail": { rich_text: [{ text: { content: truncate(detailList(report.findings.errors), 1800) } }] },
    "Stale Detail": { rich_text: [{ text: { content: truncate(detailList(report.findings.stale), 1800) } }] },
  };

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion ${res.status}: ${body.slice(0, 400)}`);
  }
}

function buildNotionSummary(report) {
  const { errors, stale, pipeline, unverified } = report.findings;
  const parts = [];
  if (errors.length) parts.push(`${errors.length} error(s)`);
  if (stale.length) parts.push(`${stale.length} stale`);
  if (pipeline.length) parts.push(`${pipeline.length} pipeline`);
  if (unverified.length) parts.push(`${unverified.length} unverified`);
  return parts.length ? parts.join(" · ") : "All checks passed.";
}

function detailList(items) {
  return items.map((f) => `• ${f.title}${f.detail ? ` — ${f.detail}` : ""}`).join("\n");
}

// ---------- Email ----------

async function emailReport(report) {
  const recipients = process.env.FACTCHECK_RECIPIENTS ?? process.env.DELIVERY_RECIPIENTS;
  if (!recipients) {
    console.log("[FACTCHECK] no recipients configured — skipping email");
    return;
  }
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    console.warn("[FACTCHECK] SMTP not configured — skipping email");
    return;
  }

  // Lazy import so pre-publish runs don't load nodemailer.
  const { createTransport } = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT ?? 587);
  const transport = createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port,
    secure: port === 465,
    requireTLS: true,
    auth: { user, pass },
    tls: { minVersion: "TLSv1.2" },
  });

  const subject = `[Wire Fact-check] ${report.editionDate} — ${report.status} (${report.findings.errors.length}E / ${report.findings.stale.length}S / ${report.findings.pipeline.length}P)`;
  const html = markdownToEmailHTML(report.markdown);

  await transport.sendMail({
    from: `"Phillies Wire Fact-check" <${user}>`,
    to: recipients,
    subject,
    text: report.markdown,
    html,
  });
}

function markdownToEmailHTML(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split("\n");
  const out = [];
  let inList = false;
  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h1>${esc(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h2>${esc(line.slice(3))}</h2>`);
    } else if (line.startsWith("- ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      const body = line.slice(2).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out.push(`<li>${body}</li>`);
    } else if (line.startsWith("  ") && inList) {
      // continuation line
      out.push(`<div style="margin-left:1.5em;color:#555;">${esc(line.trim())}</div>`);
    } else if (line.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("");
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<p>${esc(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return `<body style="font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:16px;">${out.join("\n")}</body>`;
}

// ---------- Utilities ----------

function todayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function offsetDays(iso, delta) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function parseClockHM(s) {
  // accepts "6:40 PM", "18:40", "2:40 PM"
  const m1 = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(s).trim());
  if (!m1) return null;
  let h = Number(m1[1]);
  const min = Number(m1[2]);
  const ampm = m1[3]?.toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function firstDuplicate(arr) {
  const seen = new Map();
  for (const item of arr) {
    const key = item.replace(/\s+/g, " ").trim();
    if (seen.has(key)) return key;
    seen.set(key, true);
  }
  return null;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function truncate(s, n) {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": "phillies-wire-factcheck/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

// ---------- Exported surface for verify.mjs ----------

export async function runFactcheck({ mode: m = "pre-publish" } = {}) {
  // Allows verify.mjs to call the deterministic subset in-process.
  // Returns { status, findings }; caller decides how to gate.
  const { data, html } = loadLocalArtifacts();
  const findings = { accurate: [], errors: [], stale: [], unverified: [], pipeline: [] };
  runDeterministicChecks({ data, html, findings, whitelist: loadWhitelist() });
  if (m === "daily") await runSourceChecks({ data, findings });
  return { status: pickStatus(findings), findings };
}
