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
//   node factcheck.mjs --export-accuracy → write dashboard/accuracy/accuracy.json only
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
import { FETCH_TIMEOUT_MS } from "./config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- Config ----------

const DEFAULT_DS_ID = "f67f24d7-9acf-4598-8a8b-6c74a61ae7bb";
const DEFAULT_WIRE_ROOT = "https://davehomeassist.github.io/phillies-wire/";
const DEFAULT_DASHBOARD = "https://davehomeassist.github.io/phillies-wire/dashboard/";

const DATA_FILE = join(__dirname, "phillies-wire-data.json");
const OUTPUT_HTML = join(__dirname, "phillies-wire-output.html");
const REPORTS_DIR = join(__dirname, "reports");
const WHITELIST_DEFAULT = join(__dirname, "factcheck-whitelist.json");
const ACCURACY_REPORT_FILE = join(__dirname, "dashboard", "accuracy", "accuracy.json");
const ACCURACY_SCHEMA_VERSION = "accuracy-1.0.0";

const MLB_TEAM_ID_PHI = 143;
const MLB_API = "https://statsapi.mlb.com/api/v1";
const FACTCHECK_FETCH_TIMEOUT_MS = Number(process.env.FACTCHECK_FETCH_TIMEOUT_MS ?? FETCH_TIMEOUT_MS);

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
const isAccuracyExport = process.argv.includes("--export-accuracy");
// A live-refresh export reconciles the morning's intentionally-frozen editorial
// snapshot against the live MLB API. Disagreements there are expected drift, not
// publish-blocking errors, so they are recorded as unverifiable instead.
const isLiveRefresh = process.argv.includes("--live-refresh");
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
  console.log(`[FACTCHECK] mode=${mode} accuracy_export=${isAccuracyExport} dry_run=${DRY_RUN}`);

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
  let coverage = emptyCoverage();
  if (mode === "daily") {
    coverage = await runSourceChecks({ data, findings, liveRefresh: isLiveRefresh });
  }

  applyWhitelist(findings, whitelist);

  const status = pickStatus(findings);
  const accuracyReport = buildAccuracyReport({ data, findings, coverage, generatedAt: new Date() });
  if (isAccuracyExport || mode === "daily") {
    writeAccuracyReport(accuracyReport);
  }

  if (isAccuracyExport) {
    console.log(`[FACTCHECK] accuracy report written: ${ACCURACY_REPORT_FILE}`);
    printSummary(findings);
    return;
  }

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

  if (shouldEmailReport(findings)) {
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
    const leader = pickStandingsLeader(standingsRows);
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

// Which published claim groups an MLB Stats API source check actually
// covered on this run. buildAccuracyReport only marks a claim "accurate" when
// its group was covered; everything else stays "unverifiable" so the scorecard
// never advertises a verification that did not happen.
export function emptyCoverage() {
  return { standings: false, record: false, recap: false, injuries: false };
}

async function runSourceChecks({ data, findings, liveRefresh = false }) {
  const coverage = emptyCoverage();
  // The recap is editorial copy describing the most-recent final, which can
  // legitimately differ from factcheck's calendar-"yesterday" at game-final and
  // timezone boundaries. On a live refresh that race is expected drift, not a
  // publishable error, so its disagreements go to the non-blocking `unverified`
  // bucket (keeping the verify gate — and daily email — from false-failing).
  //
  // Standings are NOT in this carve-out: crawl re-fetches them live on every
  // refresh (they are not a frozen snapshot), so a standings-vs-API mismatch is
  // a real wrong-data signal (e.g. a degraded crawl fallback publishing stale NL
  // East records) and MUST keep blocking in every mode.
  const recapBucket = liveRefresh ? findings.unverified : findings.errors;
  // A. Most-recent final reconciliation. The crawl records the last final it
  // saw in meta.last_final (date, game_pk, runs, opponent) and, on a final
  // edition, the recap result in sections.recap.content.result. Check that
  // published final against the MLB schedule for that date. Fall back to
  // calendar-yesterday only when the payload carries no last_final.
  try {
    const target = resolveRecapTarget(data);
    const sched = await fetchJSON(`${MLB_API}/schedule?sportId=1&teamId=${MLB_TEAM_ID_PHI}&date=${target.date}`);
    const game = pickRecapGame(sched?.dates?.[0]?.games ?? [], target);
    if (game && game.status?.abstractGameState === "Final") {
      const gamePk = game.gamePk;
      const boxscore = await fetchJSON(`${MLB_API}/game/${gamePk}/boxscore`).catch((error) => {
        findings.unverified.push({
          id: "recap-boxscore-api-unreachable",
          title: "Could not reach MLB Stats API boxscore for recap reconciliation",
          detail: error.message,
        });
        return null;
      });
      if (boxscore) {
        const compared = reconcileRecap({ data, boxscore, game, findings, bucket: recapBucket });
        if (compared) coverage.recap = true;
      }
    } else if (target.source !== "calendar") {
      findings.unverified.push({
        id: "recap-game-not-final",
        title: `Published last final (${target.date}) is not a Final on the MLB schedule`,
        detail: game
          ? `MLB reports ${game.status?.detailedState ?? "unknown"} for gamePk ${game.gamePk}.`
          : `No game matching gamePk ${target.gamePk ?? "?"} found on ${target.date}.`,
      });
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
      let comparedRows = 0;
      for (const wireRow of wireRows) {
        const apiRow = nle[wireRow.abbr ?? wireRow.team];
        if (!apiRow) continue;
        comparedRows += 1;
        if (apiRow.wins !== wireRow.wins || apiRow.losses !== wireRow.losses) {
          // Always blocking — standings are live-fetched, not a frozen snapshot.
          findings.errors.push({
            id: `standings-record-${wireRow.team}`,
            title: `${wireRow.team} record disagrees with MLB API`,
            detail: `Wire: ${wireRow.wins}-${wireRow.losses}. API: ${apiRow.wins}-${apiRow.losses}.`,
          });
        }
      }
      if (comparedRows > 0) {
        coverage.standings = true;
        // The header record is reconciled against the Phillies standings row
        // by the deterministic check, and that row was just compared to the
        // API, so the record claim is covered whenever the PHI row was.
        coverage.record = wireRows.some((row) => nle[row.abbr ?? row.team] && (row.is_phi || row.abbr === "PHI" || row.team === "PHI"));
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
  // This check is one directional: it flags API placements missing from the
  // Wire, but it does not confirm the Wire's own IL entries, so it never marks
  // injury claims covered.
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

  return coverage;
}

// A published score is a real number, not the null / "" placeholders the
// fixture carries before a game goes final.
function isScore(value) {
  return value !== null && value !== "" && Number.isFinite(Number(value));
}

// Which MLB game the published "last final" refers to. Prefers the crawl's
// meta.last_final (date + gamePk), then a visible recap's date, then
// calendar-yesterday for payloads that carry neither.
export function resolveRecapTarget(data, today = todayISO()) {
  const lastFinal = data?.meta?.last_final;
  if (lastFinal?.date && /^\d{4}-\d{2}-\d{2}$/.test(lastFinal.date)) {
    return { date: lastFinal.date, gamePk: lastFinal.game_pk ?? null, source: "last_final" };
  }
  const recap = data?.sections?.recap;
  if (recap?.show && /^\d{4}-\d{2}-\d{2}$/.test(recap.content?.date ?? "")) {
    return { date: recap.content.date, gamePk: data?.meta?.game_pk ?? null, source: "recap" };
  }
  return { date: offsetDays(today, -1), gamePk: null, source: "calendar" };
}

// Pick the schedule entry the published final describes. A gamePk match wins;
// otherwise a lone Final on that date; a doubleheader without a gamePk is
// ambiguous and is left unchecked rather than guessed.
export function pickRecapGame(games = [], target = {}) {
  if (target.gamePk != null) {
    return games.find((game) => String(game.gamePk) === String(target.gamePk)) ?? null;
  }
  const finals = games.filter((game) => game.status?.abstractGameState === "Final");
  if (finals.length === 1) return finals[0];
  return games.length === 1 ? games[0] : null;
}

// Returns true when at least one published value was actually compared to the
// MLB source, so the caller can mark the recap group as covered.
export function reconcileRecap({ data, boxscore, game, findings, bucket = findings.errors }) {
  const phiSide = boxscore.teams?.home?.team?.id === MLB_TEAM_ID_PHI ? "home" : "away";
  const phiBox = boxscore.teams?.[phiSide];
  const oppBox = boxscore.teams?.[phiSide === "home" ? "away" : "home"];
  if (!phiBox || !oppBox) return false;

  const phiRuns = game.teams?.[phiSide]?.score;
  const oppRuns = game.teams?.[phiSide === "home" ? "away" : "home"]?.score;
  const gameDate = game.officialDate ?? String(game.gameDate ?? "").slice(0, 10);
  let compared = false;

  // meta.last_final is what crawl.mjs actually publishes (and what verify.mjs
  // uses to check the streak sign), so it is the primary recap claim.
  const lastFinal = data?.meta?.last_final;
  if (
    lastFinal &&
    isScore(lastFinal.phi_runs) &&
    isScore(lastFinal.opp_runs) &&
    (!lastFinal.date || !gameDate || lastFinal.date === gameDate) &&
    (lastFinal.game_pk == null || game.gamePk == null || String(lastFinal.game_pk) === String(game.gamePk))
  ) {
    compared = true;
    if (Number(lastFinal.phi_runs) !== Number(phiRuns) || Number(lastFinal.opp_runs) !== Number(oppRuns)) {
      bucket.push({
        id: "recap-last-final-score",
        title: "Published last final disagrees with MLB schedule",
        detail: `Wire: PHI ${lastFinal.phi_runs}, ${lastFinal.opp_abbr ?? "OPP"} ${lastFinal.opp_runs} (${lastFinal.date ?? "?"}). API: PHI ${phiRuns}, OPP ${oppRuns}.`,
      });
    }
  }

  const wireRecap = data?.recap ?? data?.sections?.recap?.content ?? null;
  if (!wireRecap) return compared;

  // Visible recap result block (sections.recap.content.result on a final
  // edition): home_score / away_score in schedule orientation.
  const result = wireRecap.result;
  const recapDate = wireRecap.date;
  if (
    result &&
    isScore(result.home_score) &&
    isScore(result.away_score) &&
    (!recapDate || !gameDate || recapDate === gameDate)
  ) {
    compared = true;
    const homeRuns = game.teams?.home?.score;
    const awayRuns = game.teams?.away?.score;
    if (Number(result.home_score) !== Number(homeRuns) || Number(result.away_score) !== Number(awayRuns)) {
      bucket.push({
        id: "recap-final-score",
        title: "Recap final score disagrees with MLB box score",
        detail: `Wire: home ${result.home_score}, away ${result.away_score}${result.summary_line ? ` (${result.summary_line})` : ""}. API: home ${homeRuns}, away ${awayRuns}.`,
      });
    }
  }

  // Legacy free text fields, kept for payloads that carry them.
  if (wireRecap.final_score) {
    compared = true;
    const rx = /(?:PHI|Phillies)\s*(\d+)[,\-–\s]+(?:[A-Z]{2,3}|[A-Za-z ]+)\s*(\d+)|(?:[A-Z]{2,3}|[A-Za-z ]+)\s*(\d+)[,\-–\s]+(?:PHI|Phillies)\s*(\d+)/;
    const m = rx.exec(wireRecap.final_score);
    if (m) {
      const phiWire = Number(m[1] ?? m[4]);
      const oppWire = Number(m[2] ?? m[3]);
      if (phiWire !== phiRuns || oppWire !== oppRuns) {
        bucket.push({
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
      compared = true;
      const [ , ip, h, er, bb, k ] = m;
      const disagree =
        String(starterStats.inningsPitched) !== String(ip) ||
        Number(starterStats.hits) !== Number(h) ||
        Number(starterStats.earnedRuns) !== Number(er) ||
        Number(starterStats.baseOnBalls) !== Number(bb) ||
        Number(starterStats.strikeOuts) !== Number(k);
      if (disagree) {
        bucket.push({
          id: "recap-starter-line",
          title: "Starter line disagrees with MLB box score",
          detail: `Wire: ${wireRecap.starter_line}. API: ${starterStats.inningsPitched} IP, ${starterStats.hits} H, ${starterStats.earnedRuns} ER, ${starterStats.baseOnBalls} BB, ${starterStats.strikeOuts} K.`,
        });
      }
    }
  }

  return compared;
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

export function buildAccuracyReport({ data, findings, coverage, generatedAt = new Date() } = {}) {
  const safeFindings = findings ?? { accurate: [], errors: [], stale: [], unverified: [], pipeline: [] };
  const covered = { ...emptyCoverage(), ...(coverage ?? {}) };
  const meta = data?.meta ?? {};
  const editionDate = meta.date ?? todayISO();
  const editionLabel = formatEditionLabel(meta);
  const sections = [];
  const hasFinding = (id) => [...safeFindings.errors, ...safeFindings.stale, ...safeFindings.pipeline]
    .some((finding) => finding?.id === id);

  // The edition date is checked against the run clock by the deterministic
  // edition-date-stale check whenever the data artifact loaded.
  const mastheadCovered = Boolean(data) && !hasFinding("data-missing");
  addSection(sections, "masthead", "Masthead", [
    claim(`${editionLabel || "Phillies Wire"}${editionLabel ? " · " : ""}${editionDate}`, {
      covered: mastheadCovered,
      note: mastheadCovered
        ? "Edition date checked against the run date by the deterministic edition-date check."
        : "Edition metadata from the current pipeline artifact.",
    }),
    meta.status?.generated_at_et ? claim(`Updated ${meta.status.generated_at_et}`, {
      covered: mastheadCovered,
      note: "Rendered update timestamp from the current edition.",
    }) : null,
  ]);

  const game = data?.sections?.game_status?.content ?? {};
  const starters = game.starters ?? data?.sections?.lineup?.content?.starters ?? {};
  const broadcast = game.broadcast ?? {};
  const weather = game.weather ?? {};
  addSection(sections, "game", "Game Information", [
    game.matchup ? claim(game.matchup) : data?.hero?.headline ? claim(data.hero.headline) : null,
    formatStarterClaim(starters),
    game.first_pitch ? claim(`First pitch ${game.first_pitch}`) : null,
    game.venue ? claim(`Venue: ${game.venue}`) : null,
    formatBroadcastClaim(broadcast),
    formatWeatherClaim(weather),
  ]);

  // Record W-L is reconciled against the Phillies standings row (deterministic)
  // and that row against the MLB standings API (source check), so it is
  // covered whenever the standings check ran. Division rank and streak are only
  // reconciled internally against the standings row, never against the API.
  const record = data?.record ?? {};
  addSection(sections, "record", "Record & Standing", [
    Number.isFinite(Number(record.wins)) && Number.isFinite(Number(record.losses))
      ? claim(`Record: ${record.wins}-${record.losses}`, {
        covered: covered.record && !hasFinding("record-standings-mismatch"),
        note: covered.record ? "Reconciled with the Phillies row of the MLB standings API." : undefined,
      })
      : null,
    record.division_rank && record.division
      ? claim(`Division standing: ${ordinal(record.division_rank)} in ${record.division}`)
      : null,
    record.streak ? claim(`Current streak: ${record.streak}`) : null,
  ]);

  const standingsRows = getStandingsRows(data);
  addSection(sections, "standings", "NL East Standings", standingsRows.map((row) => {
    const abbr = row.abbr ?? row.team ?? row.name;
    const rowCovered = covered.standings
      && !hasFinding(`standings-record-${row.team ?? abbr}`)
      && !hasFinding(`standings-gb-${abbr}`);
    return claim(`${abbr}: ${row.wins}-${row.losses}, GB ${row.gb ?? "—"}, streak ${row.streak ?? "—"}`, {
      covered: rowCovered,
      note: [
        rowCovered ? "W-L compared with the MLB standings API; games back reconciled against the leader; streak as published." : null,
        row.is_phi ? "Phillies row also reconciles with the page header record." : null,
      ].filter(Boolean).join(" ") || undefined,
    });
  }));

  // The most recent final drives the streak sign and the recap. It is the one
  // editorial score claim the source check actually compares to MLB.
  const lastFinal = meta.last_final;
  const recap = data?.sections?.recap;
  addSection(sections, "recap", "Last Final", [
    recap?.show && recap.content?.result?.summary_line
      ? claim(`Recap: ${recap.content.result.summary_line}${recap.content.date ? ` (${recap.content.date})` : ""}`, {
        covered: covered.recap && !hasFinding("recap-final-score"),
        note: covered.recap ? "Compared with the MLB schedule and box score for that game." : undefined,
      })
      : null,
    lastFinal && isScore(lastFinal.phi_runs) && isScore(lastFinal.opp_runs)
      ? claim(`Last final: PHI ${lastFinal.phi_runs}, ${lastFinal.opp_abbr ?? "OPP"} ${lastFinal.opp_runs} (${lastFinal.date ?? "date unknown"}, ${lastFinal.outcome ?? "?"})`, {
        covered: covered.recap && !hasFinding("recap-last-final-score"),
        note: covered.recap ? "Compared with the MLB schedule for that game." : undefined,
      })
      : null,
  ]);

  const lineup = data?.sections?.lineup?.content ?? {};
  addSection(sections, "lineup", "Lineup", buildLineupClaims(lineup));

  const injuries = getInjuryEntries(data);
  addSection(sections, "injuries", "Injuries", injuries.map((entry) =>
    claim(`${entry.name ?? entry.player} (${entry.position ?? "player"}): ${entry.injury ?? entry.status_note ?? "injury listed"}, ${entry.il_type ?? "IL"}`, {
      note: entry.freshness_label ?? entry.status_note,
    }),
  ));

  const nextGame = data?.next_game ?? {};
  const preview = data?.sections?.preview?.content ?? {};
  addSection(sections, "schedule", "Upcoming Schedule", [
    nextGame.matchup ? claim(`${nextGame.date ?? nextGame.label ?? "Next"}: ${nextGame.matchup}, ${nextGame.time ?? "time TBD"}${nextGame.broadcast ? ` (${nextGame.broadcast})` : ""}`) : null,
    ...(preview.up_next ?? []).map((gameItem) =>
      claim(`${gameItem.date ?? "Upcoming"}: ${gameItem.matchup ?? "TBD"}, ${gameItem.time ?? "time TBD"}${gameItem.broadcast ? ` (${gameItem.broadcast})` : ""}`),
    ),
  ]);

  addFactcheckFindingSections(sections, safeFindings);

  const summary = summarizeAccuracy(sections);
  return {
    schema_version: ACCURACY_SCHEMA_VERSION,
    publication: meta.publication ?? "Phillies Wire",
    edition_date: editionDate,
    edition_label: editionLabel,
    generated_at: toIsoString(generatedAt),
    method: "Generated by factcheck.mjs during the pipeline from the current Wire data artifact. A claim is marked accurate only when a deterministic check or an MLB Stats API source check compared it on this run; claims no check covers stay unverifiable and are listed as published. Weather forecast snapshots are always unverifiable after the fact.",
    coverage: covered,
    verdict_legend: {
      accurate: "Compared with the MLB Stats API or a deterministic pipeline check on this run and not contradicted.",
      inaccurate: "Contradicted by a factcheck error or pipeline integrity finding.",
      unverifiable: "No source check covers the claim on this run, or it could not be confirmed or refuted from available sources.",
    },
    relevancy_legend: {
      current: "Timely for the edition date.",
      outdated: "Superseded by newer information or stale relative phrasing.",
      misleading: "Pipeline state could mislead readers even if a literal value is present.",
    },
    summary,
    highlights: buildAccuracyHighlights(safeFindings, summary),
    sources: buildAccuracySources(editionDate, Boolean(weather && Object.keys(weather).length)),
    sections,
  };
}

function writeAccuracyReport(report, path = ACCURACY_REPORT_FILE) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function addSection(sections, id, title, items) {
  const cleanItems = items.filter((item) => item?.claim);
  if (cleanItems.length) {
    sections.push({ id, title, items: cleanItems });
  }
}

const UNCOVERED_NOTE = "No source check covers this claim on this run; shown as published, not verified.";

// A claim is "accurate" only when the caller says a check covered it (or
// passes an explicit verdict). The default is "unverifiable": the scorecard
// must never report a verification that did not happen.
function claim(text, { verdict, covered = false, relevancy = "current", note } = {}) {
  const resolvedVerdict = verdict ?? (covered ? "accurate" : "unverifiable");
  const item = {
    claim: String(text),
    verdict: resolvedVerdict,
    relevancy,
  };
  const notes = [note, verdict == null && !covered ? UNCOVERED_NOTE : null].filter(Boolean);
  if (notes.length) item.note = notes.map(String).join(" ");
  return item;
}

function formatEditionLabel(meta) {
  const parts = [];
  if (meta.volume != null) parts.push(`Vol. ${meta.volume}`);
  if (meta.edition != null) parts.push(`No. ${meta.edition}`);
  return parts.join(" · ");
}

function formatStarterClaim(starters = {}) {
  const home = starters.home ?? starters.phi;
  const away = starters.away ?? starters.opp;
  if (!home?.name && !away?.name) return null;
  return claim(`${formatPitcher(home)} vs ${formatPitcher(away)}`);
}

function formatPitcher(pitcher = {}) {
  const hand = pitcher.hand ? ` (${pitcher.hand}HP)` : "";
  return `${pitcher.name ?? "TBD"}${hand}`;
}

function formatBroadcastClaim(broadcast = {}) {
  const parts = [broadcast.tv, broadcast.stream, broadcast.radio].filter(Boolean);
  return parts.length ? claim(`Broadcast: ${parts.join(" · ")}`) : null;
}

function formatWeatherClaim(weather = {}) {
  const parts = [
    weather.temp_f != null ? `${weather.temp_f}°` : null,
    weather.condition,
    weather.wind,
  ].filter(Boolean);
  return parts.length ? claim(`Weather: ${parts.join(", ")}`, {
    verdict: "unverifiable",
    relevancy: "current",
    note: "Forecast snapshot generated during the run; weather observations can change after publish.",
  }) : null;
}

function buildLineupClaims(lineup = {}) {
  const items = [];
  if (lineup.mode_label || lineup.status_note) {
    items.push(claim(`Lineup status: ${lineup.mode_label ?? lineup.mode ?? "Unknown"}${lineup.status_note ? ` — ${lineup.status_note}` : ""}`));
  }
  if (lineup.show_orders) {
    for (const [label, order] of [["PHI", lineup.batting_order?.phi ?? lineup.batting_order?.home], ["Opponent", lineup.batting_order?.opp ?? lineup.batting_order?.away]]) {
      if (Array.isArray(order) && order.length) {
        items.push(claim(`${label} batting order: ${formatBattingOrder(order)}`));
      }
    }
  }
  return items;
}

function formatBattingOrder(order) {
  return order
    .filter((batter) => batter?.name && batter.name !== "Pending")
    .map((batter) => `${batter.slot}. ${batter.name}${batter.position ? ` ${batter.position}` : ""}`)
    .join("; ");
}

function addFactcheckFindingSections(sections, findings) {
  addSection(sections, "factcheck-errors", "Fact-check Errors", findings.errors.map((finding) =>
    claim(finding.title, { verdict: "inaccurate", relevancy: "current", note: finding.detail }),
  ));
  addSection(sections, "factcheck-stale", "Stale Copy", findings.stale.map((finding) =>
    claim(finding.title, { verdict: "accurate", relevancy: "outdated", note: finding.detail }),
  ));
  addSection(sections, "factcheck-pipeline", "Pipeline Integrity", findings.pipeline.map((finding) =>
    claim(finding.title, { verdict: "inaccurate", relevancy: "misleading", note: finding.detail }),
  ));
  addSection(sections, "factcheck-unverified", "Unverified Source Gaps", findings.unverified.map((finding) =>
    claim(finding.title, { verdict: "unverifiable", relevancy: "current", note: finding.detail }),
  ));
}

function summarizeAccuracy(sections) {
  const items = sections.flatMap((section) => section.items ?? []);
  const summary = {
    total_claims: items.length,
    accurate: 0,
    inaccurate: 0,
    unverifiable: 0,
    relevancy: { current: 0, outdated: 0, misleading: 0 },
    headline: "",
  };

  for (const item of items) {
    if (item.verdict === "inaccurate") summary.inaccurate += 1;
    else if (item.verdict === "unverifiable") summary.unverifiable += 1;
    else summary.accurate += 1;

    if (item.relevancy === "outdated") summary.relevancy.outdated += 1;
    else if (item.relevancy === "misleading") summary.relevancy.misleading += 1;
    else summary.relevancy.current += 1;
  }

  const parts = [`${summary.accurate} of ${summary.total_claims} published claims verified accurate by a source or pipeline check.`];
  parts.push(summary.inaccurate ? `${summary.inaccurate} inaccurate.` : "No inaccuracies.");
  if (summary.unverifiable) parts.push(`${summary.unverifiable} unverifiable.`);
  if (summary.relevancy.outdated) parts.push(`${summary.relevancy.outdated} outdated.`);
  if (summary.relevancy.misleading) parts.push(`${summary.relevancy.misleading} misleading.`);
  summary.headline = parts.join(" ");
  return summary;
}

function buildAccuracyHighlights(findings, summary) {
  const highlights = [];
  if (summary.inaccurate === 0) {
    highlights.push({
      tone: "good",
      title: "No inaccurate claims detected",
      detail: "factcheck.mjs found no factual disagreements in this run.",
    });
  }
  if (findings.unverified.length || summary.unverifiable) {
    highlights.push({
      tone: "warn",
      title: `${summary.unverifiable} unverifiable claim${summary.unverifiable === 1 ? "" : "s"}`,
      detail: "Unverifiable items are retained on the report instead of being treated as confirmed facts. Claims no check covers on this run are listed as published.",
    });
  }
  if (findings.stale.length === 0 && findings.pipeline.length === 0) {
    highlights.push({
      tone: "good",
      title: "No stale copy or pipeline integrity findings",
      detail: "The current run did not produce stale-copy or render-integrity findings.",
    });
  }
  return highlights;
}

function buildAccuracySources(editionDate, includesWeather) {
  const sources = [
    { label: "Phillies Wire current issue data", url: `${DEFAULT_WIRE_ROOT}issues/${editionDate}/data.json` },
    { label: "MLB Stats API", url: MLB_API },
  ];
  if (includesWeather) {
    sources.push({ label: "Open-Meteo forecast data", url: "https://open-meteo.com/" });
  }
  return sources;
}

function ordinal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st"
    : n % 10 === 2 && n % 100 !== 12 ? "nd"
      : n % 10 === 3 && n % 100 !== 13 ? "rd"
        : "th";
  return `${n}${suffix}`;
}

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

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

export function pickStatus(findings) {
  if (findings.pipeline.length > 0) return "Pipeline Bug";
  if (findings.errors.length > 0) return "Errors";
  if (findings.stale.length > 0) return "Stale Copy";
  if (findings.unverified.length > 0) return "Unverified";
  return "Clean";
}

export function shouldEmailReport(findings) {
  return findings.errors.length + findings.stale.length + findings.pipeline.length + findings.unverified.length > 0;
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
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  const subject = `[Wire Fact-check] ${report.editionDate} — ${report.status} (${report.findings.errors.length}E / ${report.findings.stale.length}S / ${report.findings.pipeline.length}P / ${report.findings.unverified.length}U)`;
  const html = markdownToEmailHTML(report.markdown);

  await transport.sendMail({
    from: `"Phillies Wire Fact-check" <${user}>`,
    to: recipients,
    subject,
    text: report.markdown,
    html,
    disableFileAccess: true,
    disableUrlAccess: true,
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

export async function fetchJSON(url, { fetchImpl = fetch, timeoutMs = FACTCHECK_FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": "phillies-wire-factcheck/1.0" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Factcheck fetch timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

export function pickStandingsLeader(rows = []) {
  return rows
    .filter((row) => Number.isFinite(Number(row.wins)) && Number.isFinite(Number(row.losses)))
    .sort((left, right) => {
      const leftGames = Number(left.wins) + Number(left.losses);
      const rightGames = Number(right.wins) + Number(right.losses);
      const leftPct = leftGames ? Number(left.wins) / leftGames : 0;
      const rightPct = rightGames ? Number(right.wins) / rightGames : 0;
      return rightPct - leftPct
        || Number(right.wins) - Number(left.wins)
        || Number(left.losses) - Number(right.losses);
    })[0] ?? null;
}

// ---------- Exported surface for verify.mjs ----------

export async function runFactcheck({ mode: m = "pre-publish" } = {}) {
  // Allows verify.mjs to call the deterministic subset in-process.
  // Returns { status, findings }; caller decides how to gate.
  const { data, html } = loadLocalArtifacts();
  const findings = { accurate: [], errors: [], stale: [], unverified: [], pipeline: [] };
  runDeterministicChecks({ data, html, findings, whitelist: loadWhitelist() });
  let coverage = emptyCoverage();
  if (m === "daily") coverage = await runSourceChecks({ data, findings });
  return { status: pickStatus(findings), findings, coverage };
}
