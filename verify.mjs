import { existsSync, readFileSync } from "node:fs";

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

// Streak sign must agree with the most recent completed final in archive.json.
// Missing this check on 2026-04-22 allowed a payload with record.streak="W1"
// to ship while the archive showed seven consecutive losses.
{
  const recordStreak = (data.record?.streak ?? "").trim();
  const finals = (archive.entries ?? []).filter(
    (entry) => entry.mode === "final" && typeof entry.headline === "string",
  );
  if (recordStreak && finals.length) {
    const latest = finals[0]; // archive.json is newest-first
    const match = latest.headline.match(/PHI\s+(\d+)\s*,\s*[A-Z]{2,4}\s+(\d+)/i);
    if (match) {
      const phi = parseInt(match[1], 10);
      const opp = parseInt(match[2], 10);
      const lastOutcome = phi > opp ? "W" : "L";
      const streakSign = recordStreak[0]?.toUpperCase();
      if (streakSign !== "W" && streakSign !== "L") {
        fail(`record.streak must start with "W" or "L"; got "${recordStreak}"`);
      }
      if (streakSign !== lastOutcome) {
        fail(
          `record.streak "${recordStreak}" disagrees with the most recent final (${latest.date}: "${latest.headline}" → ${lastOutcome}).`,
        );
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
