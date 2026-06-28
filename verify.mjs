import { existsSync, readFileSync, readdirSync } from "node:fs";
import { runFactcheck } from "./factcheck.mjs";

const data = readJson("./phillies-wire-data.json");
const status = readJson("./status.json");
const archive = readJson("./archive.json");
const issuePath = `./issues/${data.meta.date}/index.html`;
const issueDataPath = `./issues/${data.meta.date}/data.json`;
const siteIssuePath = `./site/issues/${data.meta.date}/index.html`;
const siteIssueDataPath = `./site/issues/${data.meta.date}/data.json`;
const schedulePath = "./data/phillies-2026.json";
const siteSchedulePath = "./site/data/phillies-2026.json";
const calendarPath = "./calendar/phillies-2026-all.ics";
const siteCalendarPath = "./site/calendar/phillies-2026-all.ics";
// Covers the CP1252-in-UTF-8 sequences we've seen in the wild: punctuation
// and accented characters passed through a double-encoding pipeline.
const mojibakePattern = /Â·|Â°|â€“|â€”|â€œ|â€\u009d|Ã[\u0080-\u00BF]/;

const requiredFiles = [
  "./phillies-wire-output.html",
  "./index.html",
  "./status.json",
  "./archive.json",
  "./archive/index.html",
  issuePath,
  issueDataPath,
  "./site/index.html",
  "./site/archive/index.html",
  "./site/archive.json",
  "./site/status.json",
  siteIssuePath,
  siteIssueDataPath,
  "./live-feed.js",
  "./site/live-feed.js",
  "./pw-enhance.css",
  "./site/pw-enhance.css",
  "./fonts.css",
  "./site/fonts.css",
  "./robots.txt",
  "./sitemap.xml",
  "./feed.xml",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./og-default.svg",
  "./site/robots.txt",
  "./site/sitemap.xml",
  "./site/feed.xml",
  "./site/manifest.webmanifest",
  "./site/favicon.svg",
  "./site/og-default.svg",
  "./latest.json",
  "./site/latest.json",
  "./schedule/index.html",
  "./dashboard/preferences/index.html",
  "./dashboard/preferences/preferences.css",
  "./dashboard/preferences/preferences.js",
  "./site/schedule/index.html",
  "./site/dashboard/preferences/index.html",
  "./site/dashboard/preferences/preferences.css",
  "./site/dashboard/preferences/preferences.js",
  "./dashboard/accuracy/index.html",
  "./dashboard/accuracy/accuracy.css",
  "./dashboard/accuracy/accuracy.js",
  "./dashboard/accuracy/accuracy.json",
  "./site/dashboard/accuracy/index.html",
  "./site/dashboard/accuracy/accuracy.css",
  "./site/dashboard/accuracy/accuracy.js",
  "./site/dashboard/accuracy/accuracy.json",
  "./dashboard/season/index.html",
  "./dashboard/season/season.css",
  "./dashboard/season/season.js",
  "./site/dashboard/season/index.html",
  "./site/dashboard/season/season.css",
  "./site/dashboard/season/season.js",
  schedulePath,
  siteSchedulePath,
  calendarPath,
  siteCalendarPath,
  "./embed/ticker.html",
  "./site/embed/ticker.html",
  "./shared/phillies-prefs.mjs",
  "./site/shared/phillies-prefs.mjs",
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    fail(`Missing required output: ${file}`);
  }
}

if (!data.meta?.schema_version) {
  fail("meta.schema_version is required.");
}

if (!data.hero?.headline || !Array.isArray(data.hero?.cards) || !Array.isArray(data.hero?.bullets)) {
  fail("Hero payload is incomplete.");
}

const allowedModes = new Set(["pregame", "live", "final", "off_day"]);
if (!allowedModes.has(data.hero.mode)) {
  fail(`Unexpected hero mode: ${data.hero.mode}`);
}

if (data.hero.cards.length !== 3 || data.hero.bullets.length < 2) {
  fail("Hero cards must contain exactly 3 items, and hero bullets must contain at least 2 items.");
}

for (const card of data.hero.cards) {
  if (!card?.label || !card?.value) {
    fail("Every hero card must include a label and value.");
  }
}

if (!data.hero.label || !data.hero.summary || !data.hero.next_label || !data.hero.next_value) {
  fail("Hero label, summary, next_label, and next_value are required.");
}

if (data.meta.off_day && data.meta.show_sections !== false) {
  fail("Off-day payloads must disable section rendering.");
}

if (data.hero.mode === "final" && data.hero.headline !== data.sections?.recap?.content?.result?.summary_line) {
  fail("Final hero headline must match the recap summary line.");
}

// Live headline must have both team abbreviations (2-3 uppercase letters
// each) AND numeric scores. Anchor to the whole string so trailing cruft
// doesn't accidentally satisfy the pattern. Placeholder "AWAY 0, HOME 0"
// previously slipped through because the fallback abbreviation happened
// to satisfy {A-Z}{2,3}.
if (
  data.hero.mode === "live" &&
  !/^[A-Z]{2,3}\s+\d+,\s+[A-Z]{2,3}\s+\d+/.test(data.hero.headline)
) {
  fail("Live hero headline must include both team abbreviations and scores.");
}
if (
  data.hero.mode === "live" &&
  /^(AWAY|HOME)\s+\d+,\s+(AWAY|HOME)\s+\d+/.test(data.hero.headline)
) {
  fail("Live hero headline is using the AWAY/HOME fallback placeholders.");
}

// Regression guards (Issue 006). Home-venue-specific fields must not leak
// onto road games, and the "Roster & Lineup" chip must not claim the lineup
// is confirmed while the lineup section is still pending.
if (!data.meta.off_day) {
  const gameStatus = data.sections?.game_status?.content ?? {};
  const venueIsHome = gameStatus.venue_is_home === true;
  if (!venueIsHome && gameStatus.transit) {
    fail(
      `Away game still carries a transit string ("${gameStatus.transit}"). Transit is Citizens Bank Park / SEPTA specific and must be cleared when venue_is_home is false.`,
    );
  }

  const rosterChip = data.sections?.roster?.chip_label ?? "";
  const lineupAnnounced = data.sections?.lineup?.content?.announced === true;
  if (/confirmed/i.test(rosterChip) && !lineupAnnounced) {
    fail(
      `Roster chip reads "${rosterChip}" while the lineup is not announced. The "Roster & Lineup" chip must not say "Confirmed" until lineups post.`,
    );
  }
}

if (status.date !== data.meta.date || status.publication !== data.meta.publication) {
  fail("status.json does not match the rendered issue metadata.");
}

if (status.issue_path !== `issues/${data.meta.date}/`) {
  fail("status.json issue_path is incorrect.");
}

const currentEntry = (archive.entries ?? []).find((entry) => entry.date === data.meta.date);
if (!currentEntry) {
  fail(`archive.json is missing an entry for ${data.meta.date}.`);
}

if (currentEntry.issue_path !== `issues/${data.meta.date}/`) {
  fail("archive.json current entry has the wrong issue path.");
}

if (currentEntry.edition !== data.meta.edition || currentEntry.volume !== data.meta.volume) {
  fail("archive.json current entry edition metadata does not match the rendered issue.");
}

if (currentEntry.headline !== data.hero.headline) {
  fail("archive.json current entry headline does not match the hero headline.");
}

if (currentEntry.hero_label !== data.hero.label) {
  fail("archive.json current entry label does not match the hero label.");
}

if (existsSync(`./overrides/${data.meta.date}.json`)) {
  const noted = (data.meta.status?.source_notes ?? []).some((note) => /Editorial overrides applied/i.test(note));
  if (!noted) {
    fail("Override file exists, but the payload does not mention applied overrides.");
  }
}

const htmlFiles = [
  "./phillies-wire-output.html",
  "./index.html",
  issuePath,
  "./archive/index.html",
  "./site/index.html",
  siteIssuePath,
  "./site/archive/index.html",
];
const textIntegrityFiles = [
  "./phillies-wire-schema.json",
  "./phillies-wire-data.json",
  "./status.json",
  "./archive.json",
  schedulePath,
  ...htmlFiles,
];

for (const file of textIntegrityFiles) {
  assertNoMojibake(readFileSync(file, "utf8"), file);
}

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  assertNoUnresolvedTokens(html, file);

  if (!/Phillies Wire/.test(html)) {
    fail(`Rendered HTML is missing the publication name: ${file}`);
  }
}

const latestHtml = readFileSync("./index.html", "utf8");
if (!/pw-hero/.test(latestHtml)) {
  fail("Latest issue page is missing the hero section.");
}

// Enhancement layer (Liberty Bell / broadsheet) must be wired in and the
// fonts self-hosted, not loaded from Google Fonts.
if (!/pw-enhance\.css/.test(latestHtml)) {
  fail("Latest issue page does not link pw-enhance.css (enhancement layer missing).");
}
if (!/fonts\.css/.test(latestHtml)) {
  fail("Latest issue page does not link the self-hosted fonts.css.");
}
if (/fonts\.googleapis\.com/.test(latestHtml)) {
  fail("Latest issue page still loads Google Fonts; fonts must be self-hosted.");
}

// Regression guard across EVERY issue page (persisted + deployed), not just the
// latest: historical pages must stay free of external Google Fonts, must not
// leak internal header/secret names, and must not carry injected reminders.
for (const root of ["./issues", "./site/issues"]) {
  if (!existsSync(root)) {
    continue;
  }
  for (const dir of readdirSync(root)) {
    const file = `${root}/${dir}/index.html`;
    if (!existsSync(file)) {
      continue;
    }
    const html = readFileSync(file, "utf8");
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html)) {
      fail(`Issue page loads external Google Fonts (must be self-hosted): ${file}`);
    }
    if (/x-api-key|sk-ant-/.test(html)) {
      fail(`Issue page leaks an internal key/header name: ${file}`);
    }
    if (/<system-reminder>/.test(html)) {
      fail(`Issue page contains an injected system-reminder: ${file}`);
    }
  }
}

if (!data.meta.off_day && !/pw-accordion/.test(latestHtml)) {
  fail("Latest issue page is missing the accordion sections.");
}

if (!data.meta.off_day) {
  const lineup = data.sections?.lineup?.content;
  if (!lineup?.starters?.home?.name || !lineup?.starters?.away?.name) {
    fail("Lineup section is missing starter names.");
  }

  const homeOrder = lineup?.batting_order?.home;
  const awayOrder = lineup?.batting_order?.away;
  if (!Array.isArray(homeOrder) || homeOrder.length !== 9 || !Array.isArray(awayOrder) || awayOrder.length !== 9) {
    fail("Lineup batting_order must contain nine entries for each side.");
  }

  if (!/data-row="lineup"/.test(latestHtml)) {
    fail("Latest issue page is missing the lineup accordion row.");
  }
}

if (!/live-feed\.js/.test(latestHtml)) {
  fail("Latest issue page is missing the live-feed module.");
}

const requiredMeta = [
  /<meta name="description"[^>]+content="[^"]+"/,
  /<link rel="canonical"[^>]+href="[^"]+"/,
  /<meta property="og:title"[^>]+content="[^"]+"/,
  /<meta property="og:image"[^>]+content="[^"]+"/,
  /<meta name="twitter:card"[^>]+content="summary_large_image"/,
  /<script type="application\/ld\+json"/,
  /<link rel="alternate"[^>]+type="application\/rss\+xml"/,
  /<a class="pw-skip-link"/,
];

for (const pattern of requiredMeta) {
  if (!pattern.test(latestHtml)) {
    fail(`Latest issue page is missing SEO/accessibility tag: ${pattern}`);
  }
}

const latestJsonLdMatch = latestHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (!latestJsonLdMatch) {
  fail("Latest issue page is missing JSON-LD block.");
}
try {
  const jsonLdText = latestJsonLdMatch[1]
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&");
  JSON.parse(jsonLdText);
} catch (error) {
  fail(`Latest issue JSON-LD block did not parse: ${error.message}`);
}

if (!data.meta.off_day) {
  const requiredHooks = [
    "pw-status-mode-chip",
    "pw-status-text",
    "pw-hero-section",
    "pw-hero-label",
    "pw-hero-headline",
    "pw-hero-dek",
    "pw-hero-summary",
    "pw-game-status-preview",
    "pw-live-score",
  ];

  for (const hook of requiredHooks) {
    if (!latestHtml.includes(`id="${hook}"`)) {
      fail(`Latest issue page is missing live hook ${hook}.`);
    }
  }
}

// Per-issue data.json contract (schema_version 1.3.0+).
// Added Sprint 2026-W17 Day 2.2 — unlocks the dashboard's live Team Health,
// Lineup, and Player Focus panels.
{
  const issueData = readJson(issueDataPath);
  const siteIssueData = readJson(siteIssueDataPath);
  const required = ["schema_version", "meta", "record", "hero", "sections", "next_game"];
  for (const key of required) {
    if (!(key in issueData)) {
      fail(`Issue data.json is missing required key: ${key}`);
    }
  }
  if (!issueData.schema_version || !/^\d+\.\d+\.\d+$/.test(issueData.schema_version)) {
    fail(`Issue data.json schema_version must be semver; got "${issueData.schema_version}"`);
  }
  if (JSON.stringify(issueData) !== JSON.stringify(siteIssueData)) {
    fail("Issue data.json and site/ copy differ — site artifact copy broke.");
  }
  const issueDataBytes = Buffer.byteLength(JSON.stringify(issueData), "utf8");
  if (issueDataBytes > 20 * 1024) {
    fail(`Issue data.json exceeds 20 KB budget (${issueDataBytes} bytes). Strip heavier sections.`);
  }
}

// Guard against injected system instructions leaking into rendered output.
// Incident context: 2026-04-20 session observed an external fetch that
// returned content containing a fake <system-reminder> block. Not our
// content, but good hygiene to block it at publish time.
for (const file of htmlFiles) {
  const content = readFileSync(file, "utf8");
  if (/<system-reminder[^>]*>/i.test(content)) {
    fail(`Rendered HTML contains a system-reminder marker, possible prompt injection: ${file}`);
  }
}

{
  const schedule = readJson(schedulePath);
  const siteSchedule = readJson(siteSchedulePath);

  if (JSON.stringify(schedule) !== JSON.stringify(siteSchedule)) {
    fail("Canonical schedule JSON and site copy differ.");
  }

  if (!schedule.schema_version || !/^\d+\.\d+\.\d+$/.test(schedule.schema_version)) {
    fail(`Canonical schedule schema_version must be semver; got "${schedule.schema_version}"`);
  }

  if (!Array.isArray(schedule.games) || schedule.games.length < 1) {
    fail("Canonical schedule must include at least one game.");
  }

  if (!schedule.summary || typeof schedule.summary.total_games !== "number") {
    fail("Canonical schedule is missing summary metadata.");
  }

  const firstGame = schedule.games[0];
  const requiredGameKeys = ["game_pk", "official_date", "game_date", "title", "matchup", "venue", "status", "opponent", "attendance_key"];
  for (const key of requiredGameKeys) {
    if (!(key in firstGame)) {
      fail(`Canonical schedule game is missing key: ${key}`);
    }
  }
}

{
  const calendarText = readFileSync(calendarPath, "utf8");
  const siteCalendarText = readFileSync(siteCalendarPath, "utf8");
  if (calendarText !== siteCalendarText) {
    fail("Calendar artifact and site copy differ.");
  }
  if (!calendarText.startsWith("BEGIN:VCALENDAR")) {
    fail("Calendar artifact is not a valid VCALENDAR payload.");
  }
}

// latest.json consumer contract (Upgrade 1).
// Rule 2 instantiation of the portfolio Definition of Done contract.
{
  const latest = readJson("./latest.json");
  const siteLatest = readJson("./site/latest.json");

  const topRequired = [
    "schema_version",
    "publication",
    "edition_date",
    "generated_at",
    "mode",
    "mode_label",
    "off_day",
    "record",
    "hero",
    "game",
    "schedule",
    "ticker",
  ];
  for (const key of topRequired) {
    if (!(key in latest)) {
      fail(`latest.json is missing required key: ${key}`);
    }
  }

  if (!latest.schema_version || !/^[a-z-]+\d+\.\d+\.\d+$/.test(latest.schema_version)) {
    fail(`latest.json schema_version must look like "latest-1.0.0"; got "${latest.schema_version}"`);
  }

  if (latest.publication !== data.meta.publication) {
    fail("latest.json publication does not match rendered data.");
  }

  if (latest.edition_date !== data.meta.date) {
    fail("latest.json edition_date does not match rendered data.");
  }

  if (JSON.stringify(latest) !== JSON.stringify(siteLatest)) {
    fail("latest.json and site/latest.json differ, site artifact copy broke.");
  }

  if (!latest.off_day) {
    const gameRequired = ["matchup", "first_pitch", "venue", "starters"];
    for (const key of gameRequired) {
      if (latest.game?.[key] == null) {
        fail(`latest.json game.${key} is required when off_day is false.`);
      }
    }
  }

  if (!Array.isArray(latest.ticker)) {
    fail("latest.json ticker must be an array.");
  }

  if (latest.schedule?.path !== "data/phillies-2026.json") {
    fail("latest.json schedule.path must point at the canonical schedule artifact.");
  }

  // Freshness: generated_at must be a valid ISO timestamp within the last 26 hours.
  // 26 = cron cadence (daily) + 2 hour grace for delivery lag.
  const generatedAt = Date.parse(latest.generated_at);
  if (Number.isNaN(generatedAt)) {
    fail(`latest.json generated_at is not a valid ISO timestamp: ${latest.generated_at}`);
  }
  const ageHours = (Date.now() - generatedAt) / (1000 * 60 * 60);
  if (ageHours > 26) {
    fail(`latest.json generated_at is stale by ${ageHours.toFixed(1)} hours.`);
  }
}

// Ticker embed scaffold (Upgrade 4). Must render all four states and stay
// self contained so third parties can iframe it safely.
{
  const tickerHtml = readFileSync("./embed/ticker.html", "utf8");
  const siteTicker = readFileSync("./site/embed/ticker.html", "utf8");
  const requiredFns = ["renderPregame", "renderLive", "renderFinal", "renderOffDay"];
  for (const fn of requiredFns) {
    if (!tickerHtml.includes(fn)) {
      fail(`embed/ticker.html is missing render function: ${fn}`);
    }
  }
  if (tickerHtml !== siteTicker) {
    fail("embed/ticker.html and site/embed/ticker.html differ.");
  }
  // Iframe safety: no external script src or stylesheet href.
  if (/<script\s+[^>]*src=/i.test(tickerHtml)) {
    fail("embed/ticker.html must be inline; no external <script src=>.");
  }
  if (/<link\s+[^>]*href=/i.test(tickerHtml)) {
    fail("embed/ticker.html must be inline; no external <link href=>.");
  }
}

// Streak sign must agree with the most recent completed final.
// Missing this check on 2026-04-22 allowed a payload with record.streak="W1"
// to ship while the archive showed seven consecutive losses. Truth source is
// data.meta.last_final (sourced fresh from MLB API by crawl), with a fallback
// to archive.json. Archive can be structurally stale when daily editions
// were never promoted to final (live cron didn't run, or rain-out etc), so
// the archive comparison is only enforced when the latest archive final is
// recent relative to the issue date.
{
  const recordStreak = (data.record?.streak ?? "").trim();
  if (recordStreak) {
    const streakSign = recordStreak[0]?.toUpperCase();
    if (streakSign !== "W" && streakSign !== "L") {
      fail(`record.streak must start with "W" or "L"; got "${recordStreak}"`);
    }

    const lastFinal = data.meta?.last_final;
    if (lastFinal && (lastFinal.outcome === "W" || lastFinal.outcome === "L")) {
      if (streakSign !== lastFinal.outcome) {
        fail(
          `record.streak "${recordStreak}" disagrees with most recent MLB final (${lastFinal.date}: PHI ${lastFinal.phi_runs}, ${lastFinal.opp_abbr} ${lastFinal.opp_runs} → ${lastFinal.outcome}).`,
        );
      }
    } else {
      const finals = (archive.entries ?? []).filter(
        (entry) => entry.mode === "final" && typeof entry.headline === "string",
      );
      const latest = finals[0]; // archive.json is newest-first
      if (latest && isWithinDays(latest.date, data.meta?.date, 3)) {
        const match = latest.headline.match(/PHI\s+(\d+)\s*,\s*[A-Z]{2,4}\s+(\d+)/i);
        if (match) {
          const phi = parseInt(match[1], 10);
          const opp = parseInt(match[2], 10);
          const lastOutcome = phi > opp ? "W" : "L";
          if (streakSign !== lastOutcome) {
            fail(
              `record.streak "${recordStreak}" disagrees with the most recent archived final (${latest.date}: "${latest.headline}" → ${lastOutcome}).`,
            );
          }
        }
      }
    }
  }
}

// Probable pitcher handedness sanity: if overrides/pitchers.json exists and
// declares a hand for a named probable pitcher, the rendered payload must
// not contradict it. This is the 2026-04-22 Matthew Boyd regression guard.
{
  const overridesPath = "./overrides/pitchers.json";
  if (existsSync(overridesPath)) {
    let overrides = {};
    try {
      overrides = JSON.parse(readFileSync(overridesPath, "utf8"))?.handedness ?? {};
    } catch {
      overrides = {};
    }
    const starters = [
      data.sections?.game_status?.content?.starters,
      data.sections?.lineup?.content?.starters,
    ].filter(Boolean);
    for (const group of starters) {
      for (const [role, entry] of Object.entries(group)) {
        if (!entry?.name || !entry?.hand) continue;
        const expected = overrides[entry.name.toLowerCase().trim()];
        if (expected && expected !== entry.hand) {
          fail(
            `Pitcher handedness override conflict: ${entry.name} (${role}) rendered as "${entry.hand}" but overrides/pitchers.json declares "${expected}".`,
          );
        }
      }
    }
  }
}

// Dashboard ES-module integrity: every `import ... from "../path"` in
// dashboard.js must resolve to a file present in both the root checkout
// and the site/ mirror. The 2026-04-22 "empty dashboard" outage happened
// because shared/phillies-prefs.mjs was untracked — verify listed it in
// requiredFiles (pass in working tree), but CI deployed from HEAD, so
// production returned 404 and every dashboard widget stayed as placeholder.
{
  const dashboardJs = readFileSync("./dashboard/dashboard.js", "utf8");
  const importRe = /from\s+["']\.\.\/([^"']+)["']/g;
  let match;
  while ((match = importRe.exec(dashboardJs)) !== null) {
    const rel = match[1];
    const root = `./${rel}`;
    const site = `./site/${rel}`;
    if (!existsSync(root)) {
      fail(`Dashboard imports ${rel} but ${root} is missing.`);
    }
    if (!existsSync(site)) {
      fail(`Dashboard imports ${rel} but ${site} is missing (render did not mirror it).`);
    }
  }
}

// Accuracy dashboard contract (/dashboard/accuracy/). The fact-check
// scorecard is a static surface backed by accuracy.json; the page hydrates
// from it client-side. Gate the contract so a malformed report or a broken
// site mirror can't ship a dead scorecard (same failure mode as the
// 2026-04-22 empty-dashboard outage).
{
  const accuracy = readJson("./dashboard/accuracy/accuracy.json");
  const siteAccuracy = readJson("./site/dashboard/accuracy/accuracy.json");

  if (JSON.stringify(accuracy) !== JSON.stringify(siteAccuracy)) {
    fail("Accuracy report JSON and site/ copy differ — site artifact copy broke.");
  }

  if (!accuracy.schema_version || !/^accuracy-\d+\.\d+\.\d+$/.test(accuracy.schema_version)) {
    fail(`Accuracy report schema_version must look like "accuracy-1.0.0"; got "${accuracy.schema_version}"`);
  }

  if (!accuracy.summary || typeof accuracy.summary.total_claims !== "number") {
    fail("Accuracy report is missing summary.total_claims.");
  }

  if (accuracy.edition_date !== data.meta.date) {
    fail(`Accuracy report edition_date (${accuracy.edition_date}) does not match rendered edition (${data.meta.date}).`);
  }

  const expectedAccuracyLabel = `Vol. ${data.meta.volume} · No. ${data.meta.edition}`;
  if (accuracy.edition_label !== expectedAccuracyLabel) {
    fail(`Accuracy report edition_label (${accuracy.edition_label}) does not match rendered edition (${expectedAccuracyLabel}).`);
  }

  const accuracyGeneratedAt = Date.parse(accuracy.generated_at);
  if (Number.isNaN(accuracyGeneratedAt)) {
    fail(`Accuracy report generated_at is not a valid ISO timestamp: ${accuracy.generated_at}`);
  }
  const accuracyFutureSkewMinutes = (accuracyGeneratedAt - Date.now()) / (1000 * 60);
  if (accuracyFutureSkewMinutes > 5) {
    fail(`Accuracy report generated_at is ${accuracyFutureSkewMinutes.toFixed(1)} minutes in the future.`);
  }
  const accuracyAgeHours = (Date.now() - accuracyGeneratedAt) / (1000 * 60 * 60);
  if (accuracyAgeHours > 26) {
    fail(`Accuracy report generated_at is stale by ${accuracyAgeHours.toFixed(1)} hours.`);
  }

  if (!Array.isArray(accuracy.sections) || accuracy.sections.length < 1) {
    fail("Accuracy report must include at least one section.");
  }

  const allowedVerdicts = new Set(["accurate", "inaccurate", "unverifiable"]);
  const allowedRelevancy = new Set(["current", "outdated", "misleading"]);
  const verdictCounts = { accurate: 0, inaccurate: 0, unverifiable: 0 };
  const relevancyCounts = { current: 0, outdated: 0, misleading: 0 };
  let counted = 0;
  for (const section of accuracy.sections) {
    if (!section || !Array.isArray(section.items)) {
      fail(`Accuracy section "${section?.title ?? "?"}" is missing an items array.`);
    }
    for (const item of section.items) {
      counted += 1;
      if (!allowedVerdicts.has(item?.verdict)) {
        fail(`Accuracy item has an invalid verdict ${JSON.stringify(item?.verdict)} (claim: ${item?.claim ?? "?"}).`);
      }
      if (!allowedRelevancy.has(item?.relevancy)) {
        fail(`Accuracy item has an invalid relevancy ${JSON.stringify(item?.relevancy)} (claim: ${item?.claim ?? "?"}).`);
      }
      verdictCounts[item.verdict] += 1;
      relevancyCounts[item.relevancy] += 1;
    }
  }

  // The headline tally must reconcile with the items actually listed, so the
  // scorecard can never advertise a count it doesn't show.
  if (counted !== accuracy.summary.total_claims) {
    fail(`Accuracy summary.total_claims (${accuracy.summary.total_claims}) does not match counted items (${counted}).`);
  }
  for (const [key, value] of Object.entries(verdictCounts)) {
    if (accuracy.summary[key] !== value) {
      fail(`Accuracy summary.${key} (${accuracy.summary[key]}) does not match counted ${key} items (${value}).`);
    }
  }
  for (const [key, value] of Object.entries(relevancyCounts)) {
    if (accuracy.summary.relevancy?.[key] !== value) {
      fail(`Accuracy summary.relevancy.${key} (${accuracy.summary.relevancy?.[key]}) does not match counted ${key} items (${value}).`);
    }
  }
  if (accuracy.summary.inaccurate !== 0) {
    fail(`Accuracy report contains ${accuracy.summary.inaccurate} inaccurate claim(s).`);
  }
  if (accuracy.summary.relevancy.outdated !== 0 || accuracy.summary.relevancy.misleading !== 0) {
    fail(
      `Accuracy report contains stale claim(s): ${accuracy.summary.relevancy.outdated} outdated, ${accuracy.summary.relevancy.misleading} misleading.`,
    );
  }

  const accuracyHtml = readFileSync("./dashboard/accuracy/index.html", "utf8");
  assertNoUnresolvedTokens(accuracyHtml, "./dashboard/accuracy/index.html");
  assertNoMojibake(accuracyHtml, "./dashboard/accuracy/index.html");
  assertNoMojibake(readFileSync("./dashboard/accuracy/accuracy.json", "utf8"), "./dashboard/accuracy/accuracy.json");
  if (!/Phillies Wire/.test(accuracyHtml)) {
    fail("Accuracy page is missing the publication name.");
  }
}

{
  // Season at a Glance (/dashboard/season/). Static page derived
  // entirely on the client from the canonical schedule, so we just
  // guard the markup for token/encoding regressions and that it
  // points at the canonical schedule artifact it depends on.
  const seasonHtml = readFileSync("./dashboard/season/index.html", "utf8");
  assertNoUnresolvedTokens(seasonHtml, "./dashboard/season/index.html");
  assertNoMojibake(seasonHtml, "./dashboard/season/index.html");
  if (!/Phillies Wire/.test(seasonHtml)) {
    fail("Season page is missing the publication name.");
  }
  const seasonJs = readFileSync("./dashboard/season/season.js", "utf8");
  if (!/data\/phillies-2026\.json/.test(seasonJs)) {
    fail("Season page does not read the canonical schedule artifact.");
  }
}

{
  const { findings } = await runFactcheck({ mode: "pre-publish" });
  const blocking = [...findings.errors, ...findings.pipeline];
  if (blocking.length) {
    fail(`Factcheck failed: ${formatFactcheckFindings(blocking)}`);
  }
}

console.log("Rendered issue, archive, schedule, calendar, latest.json, ticker, and site artifact verified");

function readJson(path) {
  if (!existsSync(path)) {
    fail(`Missing JSON file: ${path}`);
  }

  return JSON.parse(readFileSync(path, "utf8"));
}

function assertNoUnresolvedTokens(html, file) {
  const unresolved = html.match(/{{[^}]+}}/g) ?? [];
  if (unresolved.length) {
    fail(`Unresolved template tokens remain in ${file}: ${unresolved.slice(0, 10).join(", ")}`);
  }
}

function assertNoMojibake(text, file) {
  if (mojibakePattern.test(text)) {
    fail(`Mojibake detected in ${file}.`);
  }
}

function formatFactcheckFindings(findings) {
  return findings
    .slice(0, 5)
    .map((finding) => `${finding.id}: ${finding.title}`)
    .join("; ");
}

function isWithinDays(isoA, isoB, days) {
  if (!isoA || !isoB) return false;
  const a = Date.parse(`${isoA}T00:00:00Z`);
  const b = Date.parse(`${isoB}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(b - a) <= days * 24 * 60 * 60 * 1000;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
