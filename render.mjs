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
const STATIC_ASSET_FILES = ["./tokens.css", "./phillies-wire.css", "./live-feed.js"];
const SITE_URL = process.env.PHILLIES_WIRE_BASE_URL ?? "https://davehomeassist.github.io/phillies-wire";
const DEFAULT_OG_IMAGE_PATH = "og-default.svg";

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

  const robotsTxt = buildRobotsTxt();
  const sitemapXml = buildSitemapXml(archive);
  const feedXml = buildFeedXml(archive, data);
  const manifest = buildManifest(data);
  const faviconSvg = buildFaviconSvg();
  const ogSvg = buildOgDefaultSvg(data);

  writeFileSync("./robots.txt", robotsTxt, "utf8");
  writeFileSync("./sitemap.xml", sitemapXml, "utf8");
  writeFileSync("./feed.xml", feedXml, "utf8");
  writeFileSync("./manifest.webmanifest", `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync("./favicon.svg", faviconSvg, "utf8");
  writeFileSync(`./${DEFAULT_OG_IMAGE_PATH}`, ogSvg, "utf8");

  buildSiteArtifact({
    latestHtml,
    archive,
    archiveHtml,
    status,
    robotsTxt,
    sitemapXml,
    feedXml,
    manifest,
    faviconSvg,
    ogSvg,
  });

  console.log("Rendered latest issue, dated issue page, archive, RSS, sitemap, and site artifact");
}

function buildSiteArtifact({
  latestHtml,
  archive,
  archiveHtml,
  status,
  robotsTxt,
  sitemapXml,
  feedXml,
  manifest,
  faviconSvg,
  ogSvg,
}) {
  rmSync(SITE_DIR, { recursive: true, force: true });
  mkdirSync(SITE_DIR, { recursive: true });

  writeFileSync(`${SITE_DIR}/index.html`, latestHtml, "utf8");
  writeFileSync(`${SITE_DIR}/archive.json`, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
  writeFileSync(`${SITE_DIR}/status.json`, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  writeFileSync(`${SITE_DIR}/robots.txt`, robotsTxt, "utf8");
  writeFileSync(`${SITE_DIR}/sitemap.xml`, sitemapXml, "utf8");
  writeFileSync(`${SITE_DIR}/feed.xml`, feedXml, "utf8");
  writeFileSync(`${SITE_DIR}/manifest.webmanifest`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(`${SITE_DIR}/favicon.svg`, faviconSvg, "utf8");
  writeFileSync(`${SITE_DIR}/${DEFAULT_OG_IMAGE_PATH}`, ogSvg, "utf8");

  for (const asset of STATIC_ASSET_FILES) {
    copyFileSync(asset, `${SITE_DIR}/${asset.replace("./", "")}`);
  }

  if (existsSync(ISSUES_DIR)) {
    copyDirectory(ISSUES_DIR, `${SITE_DIR}/issues`);
  }

  mkdirSync(`${SITE_DIR}/archive`, { recursive: true });
  writeFileSync(`${SITE_DIR}/archive/index.html`, archiveHtml, "utf8");
}

function buildRobotsTxt() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

function buildSitemapXml(archive) {
  const urls = [];
  urls.push({ loc: `${SITE_URL}/`, changefreq: "hourly", priority: "1.0", lastmod: archive.updated_at });
  urls.push({ loc: `${SITE_URL}/archive/`, changefreq: "daily", priority: "0.6", lastmod: archive.updated_at });
  for (const entry of archive.entries ?? []) {
    urls.push({
      loc: `${SITE_URL}/issues/${entry.date}/`,
      changefreq: "weekly",
      priority: "0.8",
      lastmod: entry.generated_at ?? `${entry.date}T12:00:00Z`,
    });
  }

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  for (const url of urls) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(url.loc)}</loc>`);
    if (url.lastmod) {
      lines.push(`    <lastmod>${escapeXml(url.lastmod)}</lastmod>`);
    }
    lines.push(`    <changefreq>${url.changefreq}</changefreq>`);
    lines.push(`    <priority>${url.priority}</priority>`);
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return `${lines.join("\n")}\n`;
}

function buildFeedXml(archive, data) {
  const publication = data.meta?.publication ?? "Phillies Wire";
  const updated = archive.updated_at ?? new Date().toISOString();
  const entries = (archive.entries ?? []).slice(0, 30);

  const items = entries
    .map((entry) => {
      const url = `${SITE_URL}/issues/${entry.date}/`;
      const title = `${publication}: ${entry.headline ?? entry.hero_label}`;
      const description = entry.dek || entry.summary || "";
      return `  <entry>
    <title>${escapeXml(title)}</title>
    <link href="${escapeXml(url)}"/>
    <id>${escapeXml(url)}</id>
    <updated>${escapeXml(entry.generated_at ?? `${entry.date}T12:00:00Z`)}</updated>
    <summary>${escapeXml(description)}</summary>
    <author><name>${escapeXml(publication)}</name></author>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(publication)}</title>
  <link href="${escapeXml(SITE_URL + "/")}"/>
  <link rel="self" href="${escapeXml(SITE_URL + "/feed.xml")}"/>
  <updated>${escapeXml(updated)}</updated>
  <id>${escapeXml(SITE_URL + "/")}</id>
  <generator>phillies-wire/render.mjs</generator>
${items}
</feed>
`;
}

function buildManifest(data) {
  return {
    name: data.meta?.publication ?? "Phillies Wire",
    short_name: "PhilliesWire",
    description: "Daily Philadelphia Phillies newsletter.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fffbf3",
    theme_color: "#e81828",
    icons: [
      { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}

function buildFaviconSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#002d72"/>
  <path d="M7 24L7 8h8.2c3.2 0 5.3 1.9 5.3 5 0 3.2-2.1 5.1-5.3 5.1H11v5.9z" fill="#e81828"/>
</svg>
`;
}

function buildOgDefaultSvg(data) {
  const publication = data.meta?.publication ?? "Phillies Wire";
  const headline = data.hero?.headline ?? "";
  const dek = data.hero?.dek ?? "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#002d72"/>
  <rect y="480" width="1200" height="6" fill="#e81828"/>
  <text x="72" y="180" font-family="Barlow Condensed, Impact, sans-serif" font-size="120" font-weight="900" fill="#fffbf3" letter-spacing="-2">${escapeXml(publication.toUpperCase())}</text>
  <text x="72" y="320" font-family="Inter, Helvetica, sans-serif" font-size="56" fill="#fffbf3">${escapeXml(headline.slice(0, 40))}</text>
  <text x="72" y="400" font-family="Inter, Helvetica, sans-serif" font-size="36" fill="rgba(255,255,255,0.7)">${escapeXml(dek.slice(0, 60))}</text>
  <text x="72" y="560" font-family="Inter, Helvetica, sans-serif" font-size="28" fill="#e81828" font-weight="600">${escapeXml((data.meta?.date ?? "").toString())}</text>
</svg>
`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderIssue(templateString, data, links) {
  const renderData = cloneJson(data);
  renderData.meta = renderData.meta ?? {};
  renderData.meta.assets_prefix = links.assetsPrefix;
  renderData.meta.latest_href = links.latestHref;
  renderData.meta.archive_href = links.archiveHref;
  enrichMetaForSeo(renderData, links);
  return populate(templateString, renderData);
}

function enrichMetaForSeo(data, links) {
  const meta = data.meta;
  const hero = data.hero ?? {};
  const publication = meta.publication ?? "Phillies Wire";
  const issueDate = meta.date ?? "";
  const headline = hero.headline ?? publication;
  const dek = hero.dek ?? "";
  const summary = (hero.summary ?? "").toString();
  const description = truncate(
    [dek, summary].filter(Boolean).join(" ").replace(/\s+/g, " "),
    200,
  ) || `${publication} daily Phillies newsletter.`;

  const isLatest = links.latestHref === "./";
  const canonicalPath = isLatest ? "/" : `/issues/${issueDate}/`;
  const canonicalUrl = `${SITE_URL}${canonicalPath}`;
  const ogImageUrl = `${SITE_URL}/${DEFAULT_OG_IMAGE_PATH}`;

  const formattedDate = formatIssueDateLong(issueDate);

  meta.page_title = `${publication} · ${headline}${formattedDate ? ` · ${formattedDate}` : ""}`;
  meta.page_description = description;
  meta.canonical_url = canonicalUrl;
  meta.og_title = `${publication}: ${headline}`;
  meta.og_description = description;
  meta.og_image = ogImageUrl;
  meta.og_image_alt = `${publication} masthead`;
  meta.json_ld = buildJsonLd(data, {
    canonicalUrl,
    ogImageUrl,
    description,
    formattedDate,
  });
}

function buildJsonLd(data, context) {
  const publication = data.meta?.publication ?? "Phillies Wire";
  const issueDate = data.meta?.date ?? "";
  const hero = data.hero ?? {};
  const gameStatus = data.sections?.game_status?.content ?? {};
  const firstPitchIso = data.meta?.first_pitch_iso ?? null;

  const articleNode = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: `${publication}: ${hero.headline ?? publication}`,
    description: context.description,
    datePublished: data.meta?.generated_at ?? `${issueDate}T12:00:00Z`,
    dateModified: data.meta?.generated_at ?? `${issueDate}T12:00:00Z`,
    mainEntityOfPage: context.canonicalUrl,
    url: context.canonicalUrl,
    image: [context.ogImageUrl],
    author: { "@type": "Organization", name: publication },
    publisher: {
      "@type": "Organization",
      name: publication,
      logo: { "@type": "ImageObject", url: context.ogImageUrl },
    },
    isPartOf: { "@type": "PublicationIssue", issueNumber: data.meta?.edition, datePublished: issueDate },
    articleSection: "Sports",
    keywords: ["Philadelphia Phillies", "MLB", "baseball", publication],
  };

  const nodes = [articleNode];

  if (!data.meta?.off_day && firstPitchIso) {
    const homeStarter = gameStatus.starters?.home?.name;
    const awayStarter = gameStatus.starters?.away?.name;
    const venue = gameStatus.venue ?? "Citizens Bank Park, Philadelphia";
    const sportsEventNode = {
      "@context": "https://schema.org",
      "@type": "SportsEvent",
      name: hero.headline ?? "Philadelphia Phillies game",
      startDate: firstPitchIso,
      sport: "Baseball",
      location: {
        "@type": "Place",
        name: venue.split(",")[0] ?? venue,
        address: { "@type": "PostalAddress", addressLocality: "Philadelphia", addressRegion: "PA" },
      },
      description: homeStarter && awayStarter ? `Probable starters: ${homeStarter} vs ${awayStarter}.` : hero.dek ?? "",
    };
    nodes.push(sportsEventNode);
  }

  const json = JSON.stringify(nodes.length === 1 ? nodes[0] : nodes, null, 2);
  // Harden against stray `</script>` sequences and HTML entity breakage
  // inside the embedded JSON-LD block. Triple-brace rendering emits raw
  // output, so any <, >, or & must be replaced with unicode escapes.
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function formatIssueDateLong(dateString) {
  if (!dateString) {
    return "";
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${dateString}T12:00:00Z`));
  } catch {
    return dateString;
  }
}

function truncate(text, max) {
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1).trimEnd()}\u2026`;
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

  // Triple-brace tokens emit raw (unescaped) output, used for pre-sanitized
  // JSON-LD blocks and inline SVG. Callers are responsible for escaping any
  // content that could terminate the surrounding element.
  output = output.replace(/{{{\s*([^}]+)\s*}}}/g, (_match, path) => {
    const value = resolvePath(path.trim(), scope, root);
    return value == null ? "" : String(value);
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
