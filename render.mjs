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
import { pathToFileURL } from "node:url";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

function main() {
  const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const template = readFileSync(TEMPLATE_FILE, "utf8");
  const issueDate = data.meta.date;

  // Compute the archive first so renderIssue can wire prev/next links
  // into the dated issue page based on surrounding entries.
  const archive = upsertArchive(loadArchive(), buildArchiveEntry(data), data);

  const latestHtml = renderIssue(template, data, {
    assetsPrefix: "./",
    latestHref: "./",
    archiveHref: "./archive/",
  }, { archive });
  const issueHtml = renderIssue(template, data, {
    assetsPrefix: "../../",
    latestHref: "../../",
    archiveHref: "../../archive/",
  }, { archive });

  assertNoUnresolvedTokens(latestHtml);
  assertNoUnresolvedTokens(issueHtml);
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

function renderIssue(templateString, data, links, context = {}) {
  const renderData = cloneJson(data);
  renderData.meta = renderData.meta ?? {};
  renderData.meta.assets_prefix = links.assetsPrefix;
  renderData.meta.latest_href = links.latestHref;
  renderData.meta.archive_href = links.archiveHref;
  enrichMetaForSeo(renderData, links);
  enrichMetaForNavigation(renderData, links, context);
  enrichMetaForSharing(renderData);
  return populate(templateString, renderData);
}

function enrichMetaForNavigation(data, links, context) {
  const currentDate = data.meta?.date;
  const entries = context.archive?.entries ?? [];
  const isLatest = links.latestHref === "./";
  const index = entries.findIndex((entry) => entry.date === currentDate);

  // On the latest page we do not surface prev/next — the dated issue
  // pages are the linkable destinations for adjacent issues.
  if (isLatest || index === -1) {
    data.meta.issue_nav = { show: false };
    return;
  }

  const newer = entries[index - 1] ?? null;
  const older = entries[index + 1] ?? null;

  data.meta.issue_nav = {
    show: Boolean(newer || older),
    prev: older
      ? {
          href: `../${older.date}/`,
          label: formatIssueDateLong(older.date),
          headline: older.headline ?? "Previous issue",
        }
      : null,
    next: newer
      ? {
          href: `../${newer.date}/`,
          label: formatIssueDateLong(newer.date),
          headline: newer.headline ?? "Next issue",
        }
      : null,
  };
}

function enrichMetaForSharing(data) {
  const url = data.meta?.canonical_url ?? SITE_URL;
  const headline = data.meta?.og_title ?? data.meta?.publication ?? "Phillies Wire";
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(headline);
  data.meta.share = {
    twitter_url: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    bluesky_url: `https://bsky.app/intent/compose?text=${encodedText}%20${encodedUrl}`,
    mailto_url: `mailto:?subject=${encodedText}&body=${encodedUrl}`,
  };
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
  const entries = archive.entries ?? [];
  const latestEntry = entries[0];
  const latestSummary = latestEntry
    ? `${formatArchiveDate(latestEntry.date)} · ${latestEntry.hero_label} · ${latestEntry.headline}`
    : "No issues published yet.";

  const groups = groupEntriesByMonth(entries);
  const groupHtml = groups
    .map((group) => {
      const itemsHtml = group.entries
        .map((entry) => renderArchiveEntry(entry))
        .join("\n");
      return `<section class="pw-archive-group" data-month="${escapeHtml(group.monthKey)}">
  <h2 class="pw-archive-group-title">${escapeHtml(group.monthLabel)} <span class="pw-archive-group-count">${group.entries.length}</span></h2>
  <div class="pw-archive-list">
${itemsHtml}
  </div>
</section>`;
    })
    .join("\n");

  const canonicalUrl = `${SITE_URL}/archive/`;
  const description = `Phillies Wire issue archive. ${entries.length} published issue${entries.length === 1 ? "" : "s"}.`;
  return `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#e81828">
<title>${escapeHtml(archive.publication)} Archive · ${entries.length} issue${entries.length === 1 ? "" : "s"}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(archive.publication)} RSS" href="../feed.xml">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<meta property="og:title" content="${escapeHtml(archive.publication)} Archive">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:image" content="${escapeHtml(SITE_URL + "/" + DEFAULT_OG_IMAGE_PATH)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../tokens.css">
<link rel="stylesheet" href="../phillies-wire.css">
</head>
<body>
<a class="pw-skip-link" href="#pw-archive-main">Skip to archive content</a>
<div class="pw-page">
  <nav class="pw-shell-nav" aria-label="Primary">
    <a class="pw-shell-link" href="../">Latest</a>
    <a class="pw-shell-link" href="./">Archive</a>
    <a class="pw-shell-link" href="../feed.xml" rel="alternate">RSS</a>
  </nav>

  <main id="pw-archive-main" class="pw-main">
  <section class="pw-archive-page">
    <div class="pw-archive-kicker">Issue Archive</div>
    <h1 class="pw-archive-title">${escapeHtml(archive.publication)}</h1>
    <p class="pw-archive-summary">${escapeHtml(latestSummary)}</p>
    <div class="pw-archive-meta">${escapeHtml(String(entries.length))} published issue${entries.length === 1 ? "" : "s"} · Updated ${escapeHtml(formatTimestamp(archive.updated_at))}</div>
  </section>

  <div class="pw-red-rule"></div>

  <div class="pw-archive-controls">
    <label class="pw-archive-search-label" for="pw-archive-search">
      <span class="pw-archive-search-label-text">Search issues</span>
      <input type="search" id="pw-archive-search" class="pw-archive-search" placeholder="Search by date, headline, or matchup" autocomplete="off">
    </label>
    <p class="pw-archive-empty" id="pw-archive-empty" hidden>No issues match that query.</p>
  </div>

${groupHtml}
  </main>
</div>
<script>
  (function () {
    var input = document.getElementById('pw-archive-search');
    if (!input) return;
    var empty = document.getElementById('pw-archive-empty');
    var items = Array.prototype.slice.call(document.querySelectorAll('.pw-archive-item'));
    var groups = Array.prototype.slice.call(document.querySelectorAll('.pw-archive-group'));
    input.addEventListener('input', function () {
      var query = input.value.trim().toLowerCase();
      var totalVisible = 0;
      items.forEach(function (item) {
        var text = (item.getAttribute('data-search-text') || '').toLowerCase();
        var match = !query || text.indexOf(query) !== -1;
        item.hidden = !match;
        if (match) totalVisible += 1;
      });
      groups.forEach(function (group) {
        var anyVisible = Array.prototype.some.call(group.querySelectorAll('.pw-archive-item'), function (item) {
          return !item.hidden;
        });
        group.hidden = !anyVisible;
      });
      if (empty) empty.hidden = totalVisible > 0;
    });
  })();
</script>
</body>
</html>`;
}

function renderArchiveEntry(entry) {
  const meta = [
    `Vol. ${entry.volume}`,
    `No. ${entry.edition}`,
    entry.mode_label,
    entry.enrich_state,
  ]
    .filter(Boolean)
    .join(" · ");

  const searchText = [
    entry.date,
    formatArchiveDate(entry.date),
    entry.headline,
    entry.dek,
    entry.summary,
    entry.hero_label,
    entry.mode_label,
  ]
    .filter(Boolean)
    .join(" ");

  const ariaLabel = `${formatArchiveDate(entry.date)}: ${entry.headline ?? entry.hero_label ?? "Issue"}`;
  return `<a class="pw-archive-item" href="../${escapeHtml(entry.issue_path)}" data-search-text="${escapeHtml(searchText)}" aria-label="${escapeHtml(ariaLabel)}">
  <div class="pw-archive-item-top">
    <div class="pw-archive-item-date" aria-hidden="true">${escapeHtml(formatArchiveDate(entry.date))}</div>
    <div class="pw-archive-item-badge pw-archive-item-badge--${escapeHtml(entry.mode)}" aria-hidden="true">${escapeHtml(entry.hero_label)}</div>
  </div>
  <div class="pw-archive-item-headline" aria-hidden="true">${escapeHtml(entry.headline)}</div>
  <div class="pw-archive-item-dek" aria-hidden="true">${escapeHtml(entry.dek || entry.summary)}</div>
  <div class="pw-archive-item-meta" aria-hidden="true">${escapeHtml(meta)}</div>
</a>`;
}

function groupEntriesByMonth(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const monthKey = (entry.date ?? "").slice(0, 7);
    if (!groups.has(monthKey)) {
      groups.set(monthKey, { monthKey, monthLabel: formatMonthLabel(monthKey), entries: [] });
    }
    groups.get(monthKey).entries.push(entry);
  }
  // Entries are already sorted newest-first at the archive level.
  return Array.from(groups.values());
}

function formatMonthLabel(monthKey) {
  if (!monthKey || monthKey.length < 7) {
    return "Undated";
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "long",
      year: "numeric",
    }).format(new Date(`${monthKey}-15T12:00:00Z`));
  } catch {
    return monthKey;
  }
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
  // Hand-rolled balanced matcher so nested {{#if}} / {{#each}} blocks
  // expand correctly. A lazy regex would pair the outer open with the
  // first inner close, which produces "Unresolved template tokens".
  const openPattern = new RegExp(`{{#${blockName}\\s+([^}]+)}}`, "g");
  const closeTag = `{{/${blockName}}}`;

  let output = "";
  let cursor = 0;

  while (cursor < templateString.length) {
    openPattern.lastIndex = cursor;
    const openMatch = openPattern.exec(templateString);
    if (!openMatch) {
      output += templateString.slice(cursor);
      break;
    }

    output += templateString.slice(cursor, openMatch.index);
    const innerStart = openMatch.index + openMatch[0].length;
    const closeIndex = findMatchingClose(templateString, innerStart, `{{#${blockName}`, closeTag);
    if (closeIndex === -1) {
      // Unbalanced; bail out and surface an unresolved token so tests
      // fail loudly instead of silently swallowing the rest of the page.
      output += templateString.slice(openMatch.index);
      break;
    }

    const inner = templateString.slice(innerStart, closeIndex);
    output += replacer(openMatch[1].trim(), inner, scope, root);
    cursor = closeIndex + closeTag.length;
  }

  return output;
}

function findMatchingClose(text, startIndex, openPrefix, closeTag) {
  let depth = 1;
  let index = startIndex;
  while (index < text.length) {
    const nextOpen = text.indexOf(openPrefix, index);
    const nextClose = text.indexOf(closeTag, index);
    if (nextClose === -1) {
      return -1;
    }
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      // Advance past the full open tag so we don't count it again.
      const openEnd = text.indexOf("}}", nextOpen);
      index = openEnd === -1 ? nextOpen + openPrefix.length : openEnd + 2;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return nextClose;
    }
    index = nextClose + closeTag.length;
  }
  return -1;
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
