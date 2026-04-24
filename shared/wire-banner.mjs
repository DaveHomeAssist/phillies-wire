/* ============================================================
   PHILLIES WIRE — WIRE BANNER (client)
   shared/wire-banner.mjs
   Mounts a top-of-page ticker. Items sourced from:
     1. latest.json .ticker[]        (canonical, fresh)
     2. window.__WIRE_BANNER_ITEMS__  (optional inline override)
     3. STATIC_FALLBACK               (hard-coded last resort)
   Loads no styles of its own — consumer links wire-banner.css.
   ============================================================ */

const STATIC_FALLBACK = [
  { text: "Phillies Wire", highlight: true },
  { text: "Daily filings · beat + insider", highlight: false },
  { text: "Scores · schedule · injuries", highlight: false },
  { text: "Built on public data · no login", highlight: false },
];

const DUPLICATE_COUNT = 2;

function escape(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeItems(raw) {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .filter((item) => item && typeof item === "object" && typeof item.text === "string")
    .map((item) => ({
      text: item.text,
      highlight: item.highlight === true,
    }));
  return items.length ? items : null;
}

async function loadItems(url) {
  if (Array.isArray(window.__WIRE_BANNER_ITEMS__)) {
    const overridden = normalizeItems(window.__WIRE_BANNER_ITEMS__);
    if (overridden) return overridden;
  }
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return STATIC_FALLBACK;
    const payload = await res.json();
    return normalizeItems(payload && payload.ticker) || STATIC_FALLBACK;
  } catch {
    return STATIC_FALLBACK;
  }
}

function renderItem(item) {
  const hi = item.highlight ? " pw-wire-banner-item--hi" : "";
  return `
    <span class="pw-wire-banner-item${hi}">
      <span class="pw-wire-banner-sep" aria-hidden="true">·</span>
      ${escape(item.text)}
    </span>
  `;
}

function renderBanner(items) {
  const body = items.map(renderItem).join("");
  const loop = Array.from({ length: DUPLICATE_COUNT }, () => body).join("");
  return `
    <span class="pw-wire-banner-label">The Wire</span>
    <div class="pw-wire-banner-track" role="marquee" aria-live="off">
      <div class="pw-wire-banner-ticker" aria-hidden="true">${loop}</div>
    </div>
    <span class="pw-visually-hidden" aria-live="polite">
      ${items.map((i) => escape(i.text)).join(" · ")}
    </span>
  `;
}

/**
 * Mount the Wire banner.
 * @param {Element|string} [target="[data-wire-banner]"] - element or selector
 * @param {object} [opts]
 * @param {string} [opts.feedUrl="/latest.json"] - relative or absolute
 * @param {Array}  [opts.items] - skip fetching, render these verbatim
 */
export async function mountWireBanner(target, opts = {}) {
  const host =
    typeof target === "string"
      ? document.querySelector(target)
      : target || document.querySelector("[data-wire-banner]");
  if (!host) return null;

  host.classList.add("pw-wire-banner");
  host.setAttribute("aria-label", "Phillies Wire ticker");

  const items = Array.isArray(opts.items)
    ? normalizeItems(opts.items) || STATIC_FALLBACK
    : await loadItems(opts.feedUrl || resolveFeedUrl(host));

  host.innerHTML = renderBanner(items);
  host.removeAttribute("hidden");
  return host;
}

function resolveFeedUrl(host) {
  const explicit = host.getAttribute("data-feed-url");
  if (explicit) return explicit;
  // Resolve ../latest.json relative to current page if nested, else /latest.json
  const depth = window.location.pathname.split("/").filter(Boolean).length;
  if (window.location.pathname.endsWith("/")) {
    if (depth === 0) return "latest.json";
    return "../".repeat(depth - 1) + "latest.json";
  }
  return depth > 1 ? "../".repeat(depth - 1) + "latest.json" : "latest.json";
}

// Auto-mount if the consumer includes `data-wire-banner-auto` on the host.
if (typeof document !== "undefined") {
  const ready = () => {
    document.querySelectorAll("[data-wire-banner-auto]").forEach((el) => {
      mountWireBanner(el);
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  } else {
    ready();
  }
}
