import { existsSync, readFileSync } from "node:fs";

const data = readJson("./phillies-wire-data.json");
const status = readJson("./status.json");
const archive = readJson("./archive.json");
const issuePath = `./issues/${data.meta.date}/index.html`;
const siteIssuePath = `./site/issues/${data.meta.date}/index.html`;
const mojibakePattern = /Â·|Â°|â€“|â€”/;

const requiredFiles = [
  "./phillies-wire-output.html",
  "./index.html",
  "./status.json",
  "./archive.json",
  "./archive/index.html",
  issuePath,
  "./site/index.html",
  "./site/archive/index.html",
  "./site/archive.json",
  "./site/status.json",
  siteIssuePath,
  "./live-feed.js",
  "./site/live-feed.js",
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

if (data.hero.mode === "live" && !/[A-Z]{2,3}\s+\d+,\s+[A-Z]{2,3}\s+\d+/.test(data.hero.headline)) {
  fail("Live hero headline must include both team abbreviations and scores.");
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

if (!/live-feed\.js/.test(latestHtml)) {
  fail("Latest issue page is missing the live-feed module.");
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

console.log("Rendered issue, archive, and site artifact verified");

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
