import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

const DATA_FILE = "./phillies-wire-data.json";
const TEMPLATE_FILE = "./phillies-wire-v2.html";
const OUTPUT_FILE = "./phillies-wire-output.html";
const INDEX_FILE = "./index.html";
const STATUS_FILE = "./status.json";
const ARCHIVE_FILE = "./archive.json";
const ARCHIVE_DIR = "./archive";
const ISSUES_DIR = "./issues";
const SITE_DIR = "./site";

main();

function main() {
  const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const template = readFileSync(TEMPLATE_FILE, "utf8");
  const issueDate = data.meta.date;

  const latestHtml = renderIssue(template, data, {
    assetsPrefix: "./",
    latestHref: "./",
    archiveHref: "./archive/",
  });
  const issueHtml = renderIssue(template, data, {
    assetsPrefix: "../../",
    latestHref: "../../",
    archiveHref: "../../archive/",
  });

  assertNoUnresolvedTokens(latestHtml);
  assertNoUnresolvedTokens(issueHtml);

  const archive = upsertArchive(loadArchive(), buildArchiveEntry(data), data);
  const archiveHtml = renderArchivePage(archive);
  const status = buildStatusPayload(data, archive);

  mkdirSync(`${ISSUES_DIR}/${issueDate}`, { recursive: true });
  mkdirSync(ARCHIVE_DIR, { recursive: true });

  writeFileSync(OUTPUT_FILE, latestHtml, "utf8");
  writeFileSync(INDEX_FILE, latestHtml, "utf8");
  writeFileSync(`${ISSUES_DIR}/${issueDate}/index.html`, issueHtml, "utf8");
  writeFileSync(`${ARCHIVE_DIR}/index.html`, archiveHtml, "utf8");
  writeFileSync(ARCHIVE_FILE, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
  writeFileSync(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`, "utf8");

  buildSiteArtifact({
    latestHtml,
    archive,
    archiveHtml,
    status,
  });

  console.log("Rendered latest issue, dated issue page, archive, and site artifact");
}

function buildSiteArtifact({ latestHtml, archive, archiveHtml, status }) {
  rmSync(SITE_DIR, { recursive: true, force: true });
  mkdirSync(SITE_DIR, { recursive: true });

  writeFileSync(`${SITE_DIR}/index.html`, latestHtml, "utf8");
  writeFileSync(`${SITE_DIR}/archive.json`, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
  writeFileSync(`${SITE_DIR}/status.json`, `${JSON.stringify(status, null, 2)}\n`, "utf8");

  copyFileSync("./tokens.css", `${SITE_DIR}/tokens.css`);
  copyFileSync("./phillies-wire.css", `${SITE_DIR}/phillies-wire.css`);

  if (existsSync(ISSUES_DIR)) {
    copyDirectory(ISSUES_DIR, `${SITE_DIR}/issues`);
  }

  mkdirSync(`${SITE_DIR}/archive`, { recursive: true });
  writeFileSync(`${SITE_DIR}/archive/index.html`, archiveHtml, "utf8");
}

function renderIssue(templateString, data, links) {
  const renderData = cloneJson(data);
  renderData.meta = renderData.meta ?? {};
  renderData.meta.assets_prefix = links.assetsPrefix;
  renderData.meta.latest_href = links.latestHref;
  renderData.meta.archive_href = links.archiveHref;
  return populate(templateString, renderData);
}

function loadArchive() {
  if (!existsSync(ARCHIVE_FILE)) {
    return {
      schema_version: null,
      publication: "",
      updated_at: null,
      latest_date: null,
      entries: [],
    };
  }

  const parsed = JSON.parse(readFileSync(ARCHIVE_FILE, "utf8"));
  return {
    schema_version: parsed.schema_version ?? null,
    publication: parsed.publication ?? "",
    updated_at: parsed.updated_at ?? null,
    latest_date: parsed.latest_date ?? null,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  };
}

function buildArchiveEntry(data) {
  return {
    date: data.meta.date,
    issue_path: `issues/${data.meta.date}/`,
    volume: data.meta.volume,
    edition: data.meta.edition,
    mode: data.meta.status?.mode ?? "pregame",
    mode_label: data.meta.status?.mode_label ?? "Pregame",
    hero_label: data.hero?.label ?? data.meta.status?.mode_label ?? "Issue",
    headline: data.hero?.headline ?? data.meta.publication,
    dek: data.hero?.dek ?? "",
    summary: data.hero?.summary ?? "",
    off_day: data.meta.off_day ?? false,
    enrich_state: data.meta.status?.enrich_state ?? "pending",
    generated_at: data.meta.generated_at,
  };
}

function upsertArchive(archive, entry, data) {
  const entries = [entry, ...(archive.entries ?? []).filter((item) => item.date !== entry.date)].sort((left, right) =>
    right.date.localeCompare(left.date),
  );

  return {
    schema_version: data.meta.schema_version ?? archive.schema_version ?? "1.2.0",
    publication: data.meta.publication ?? archive.publication ?? "Phillies Wire",
    updated_at: data.meta.generated_at,
    latest_date: data.meta.date,
    entries,
  };
}

function renderArchivePage(archive) {
  const latestEntry = archive.entries[0];
  const latestSummary = latestEntry
    ? `${formatArchiveDate(latestEntry.date)} · ${latestEntry.hero_label} · ${latestEntry.headline}`
    : "No issues published yet.";

  const archiveItems = archive.entries
    .map((entry) => {
      const meta = [
        `Vol. ${entry.volume}`,
        `No. ${entry.edition}`,
        entry.mode_label,
        entry.enrich_state,
      ]
        .filter(Boolean)
        .join(" · ");

      return `<a class="pw-archive-item" href="../${escapeHtml(entry.issue_path)}">
  <div class="pw-archive-item-top">
    <div class="pw-archive-item-date">${escapeHtml(formatArchiveDate(entry.date))}</div>
    <div class="pw-archive-item-badge pw-archive-item-badge--${escapeHtml(entry.mode)}">${escapeHtml(entry.hero_label)}</div>
  </div>
  <div class="pw-archive-item-headline">${escapeHtml(entry.headline)}</div>
  <div class="pw-archive-item-dek">${escapeHtml(entry.dek || entry.summary)}</div>
  <div class="pw-archive-item-meta">${escapeHtml(meta)}</div>
</a>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(archive.publication)} Archive</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../tokens.css">
<link rel="stylesheet" href="../phillies-wire.css">
</head>
<body>
<div class="pw-page">
  <div class="pw-shell-nav">
    <a class="pw-shell-link" href="../">Latest</a>
    <a class="pw-shell-link" href="./">Archive</a>
  </div>

  <section class="pw-archive-page">
    <div class="pw-archive-kicker">Issue Archive</div>
    <h1 class="pw-archive-title">${escapeHtml(archive.publication)}</h1>
    <p class="pw-archive-summary">${escapeHtml(latestSummary)}</p>
    <div class="pw-archive-meta">${escapeHtml(String(archive.entries.length))} published issue${archive.entries.length === 1 ? "" : "s"} · Updated ${escapeHtml(formatTimestamp(archive.updated_at))}</div>
  </section>

  <div class="pw-red-rule"></div>

  <div class="pw-archive-list">
${archiveItems}
  </div>
</div>
</body>
</html>`;
}

export function populate(templateString, dataRoot) {
  return renderTemplate(templateString, dataRoot, dataRoot);
}

function renderTemplate(templateString, scope, root) {
  let output = templateString;
  output = renderBlocks(output, "each", scope, root, (path, inner, currentScope, currentRoot) => {
    const value = resolvePath(path, currentScope, currentRoot);
    if (!Array.isArray(value)) {
      return "";
    }

    return value.map((item) => renderTemplate(inner, item, currentRoot)).join("");
  });
  output = renderBlocks(output, "if", scope, root, (path, inner, currentScope, currentRoot) => {
    const value = resolvePath(path, currentScope, currentRoot);
    return value ? renderTemplate(inner, currentScope, currentRoot) : "";
  });

  return output.replace(/{{\s*([^#\/][^}]*)\s*}}/g, (_match, path) => {
    const value = resolvePath(path.trim(), scope, root);
    return escapeHtml(value == null ? "" : String(value));
  });
}

function renderBlocks(templateString, blockName, scope, root, replacer) {
  const pattern = new RegExp(`{{#${blockName}\\s+([^}]+)}}([\\s\\S]*?){{\\/${blockName}}}`, "g");
  let previous = "";
  let current = templateString;

  while (current !== previous) {
    previous = current;
    current = current.replace(pattern, (_match, path, inner) => replacer(path.trim(), inner, scope, root));
  }

  return current;
}

function resolvePath(path, scope, root) {
  if (path === "this") {
    return scope;
  }

  const base = path.startsWith("this.") ? scope : root;
  const trimmedPath = path.startsWith("this.") ? path.slice(5) : path;
  if (!trimmedPath) {
    return base;
  }

  return trimmedPath.split(".").reduce((current, segment) => current?.[segment], base);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assertNoUnresolvedTokens(html) {
  const unresolved = html.match(/{{[^}]+}}/g) ?? [];
  if (unresolved.length) {
    throw new Error(`Unresolved template tokens remain: ${unresolved.slice(0, 10).join(", ")}`);
  }
}

function buildStatusPayload(data, archive) {
  return {
    publication: data.meta.publication,
    date: data.meta.date,
    generated_at: data.meta.generated_at,
    off_day: data.meta.off_day ?? false,
    issue_path: `issues/${data.meta.date}/`,
    archive_path: "archive/",
    archive_entries: archive.entries.length,
    status: data.meta.status ?? {},
  };
}

function formatArchiveDate(dateString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${dateString}T12:00:00Z`));
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return "pending";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function copyDirectory(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = `${sourceDir}/${entry}`;
    const targetPath = `${targetDir}/${entry}`;
    const stats = statSync(sourcePath);

    if (stats.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }

    copyFileSync(sourcePath, targetPath);
  }
}
