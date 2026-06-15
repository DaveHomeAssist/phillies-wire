// RELIABILITY: render token resolution and artifact safety (audit P0/P1/P2-RENDER)
//
// populate() resolves {{token}} via `value == null ? "" : String(value)`.
// Two reliability gaps:
//   1. A token whose value is an OBJECT renders the literal "[object Object]"
//      into the page. verify.mjs only rejects leftover {{...}}, never this.
//   2. A missing nested key silently renders "" with no way to mark a token
//      required, so a blank hero headline can ship unnoticed.
// The guards below lock in the safe behavior that already works; the pins
// document the open gaps and will go green once render.mjs hardens token
// resolution (reject objects / sentinel for required tokens).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSiteArtifact,
  escapeHtml,
  formatArchiveDate,
  populate,
  upsertArchive,
  validateRenderInput,
} from "../../render.mjs";
import { test, run, assert, refuteIncludes } from "./_harness.mjs";

// --- Guards (must always pass) ---

test("resolves a normal nested token", () => {
  assert.equal(populate("Hi {{hero.headline}}!", { hero: { headline: "Phils win" } }), "Hi Phils win!");
});

test("empty {{ }} expression throws instead of stringifying the scope", () => {
  assert.throws(() => populate("{{ }}", { a: 1 }), /Empty/);
});

test("a null/undefined value renders empty, never the literal 'undefined'", () => {
  refuteIncludes(populate("[{{hero.dek}}]", { hero: { dek: undefined } }), "undefined", "render");
  refuteIncludes(populate("[{{hero.dek}}]", { hero: {} }), "undefined", "render");
});

test("HTML-escapes interpolated values", () => {
  assert.equal(populate("{{x}}", { x: "<b>&" }), "&lt;b&gt;&amp;");
});

test("P0-RENDER-2: site artifact is staged before replacing site/", () => {
  const work = mkdtempSync(join(tmpdir(), "pw-render-site-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(work);
    mkdirSync("site", { recursive: true });
    mkdirSync("site/archive", { recursive: true });
    buildSiteArtifact({
      latestHtml: "<html>new</html>",
      archive: { entries: [], publication: "Phillies Wire", updated_at: "2026-06-14T12:00:00Z" },
      archiveHtml: "<html>archive</html>",
      status: { ok: true },
      latest: { ok: true },
      robotsTxt: "User-agent: *\n",
      sitemapXml: "<xml />",
      feedXml: "<feed />",
      manifest: { name: "Phillies Wire" },
      faviconSvg: "<svg></svg>",
      ogSvg: "<svg></svg>",
    });
    assert.equal(readFileSync("site/index.html", "utf8"), "<html>new</html>");
    assert.equal(existsSync("site.tmp"), false);
    assert.equal(existsSync("site.bak"), false);
  } finally {
    process.chdir(previousCwd);
    rmSync(work, { recursive: true, force: true });
  }
});

test("P1-RENDER-3: archive escaping accepts null and numeric legacy fields", () => {
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(42), "42");
});

test("P1-RENDER-4: archive entries without valid dates are skipped safely", () => {
  assert.equal(formatArchiveDate(undefined), "Undated");
  const archive = upsertArchive(
    { entries: [{ headline: "Bad legacy row" }] },
    { date: "2026-06-14", headline: "Good row" },
    { meta: { date: "2026-06-14", generated_at: "2026-06-14T12:00:00Z", publication: "Phillies Wire" } },
  );
  assert.deepEqual(archive.entries.map((entry) => entry.date), ["2026-06-14"]);
});

test("P1-RENDER-5: render input fails fast on missing required keys", () => {
  assert.throws(() => validateRenderInput({ meta: { publication: "Phillies Wire" } }), /meta\.date/);
});

test("P2-RENDER-6: raw triple-brace tokens are allowlisted", () => {
  assert.equal(populate("{{{meta.json_ld}}}", { meta: { json_ld: "{\"ok\":true}" } }), "{\"ok\":true}");
  assert.throws(() => populate("{{{meta.unsafe}}}", { meta: { unsafe: "<script></script>" } }), /not allowlisted/);
});

// --- Pins (currently FAIL — open audit findings) ---

test("PIN P0: an object-valued token must fail instead of rendering '[object Object]'", () => {
  // {{hero}} where hero is an object (author mistake / partial data) should be
  // caught, not silently leaked into the page.
  assert.throws(() => populate("{{hero}}", { hero: { headline: "H" } }), /non-scalar/);
});

test("PIN P1: an array-valued token must fail instead of rendering comma-joined soup", () => {
  assert.throws(() => populate("{{ticker}}", { ticker: ["a", "b", "c"] }), /non-scalar/);
});

await run();
