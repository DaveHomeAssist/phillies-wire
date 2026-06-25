// RELIABILITY: email is inline-styled, not the rendered site page.
//
// The email used to be the full site page with a single <style> block. Mail
// clients (notably the Gmail app) strip <style>, so it collapsed to unstyled
// text, and the page carried site-only chrome — the scrolling-ticker marquee
// (duplicated for animation, separated by U+25A0 ■ glyphs), the skip link,
// nav, and JS preloads. The fix is a dedicated document with inline style=""
// attributes. These cases pin that contract so it can't silently regress.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEmailHtml } from "../../deliver.mjs";
import { test, run, assert } from "./_harness.mjs";

function fullPayload() {
  return {
    meta: { publication: "Phillies Wire", date: "2026-06-25", volume: 1, edition: 86, status: { mode_label: "Pregame" } },
    record: { wins: 44, losses: 36, streak: "W2", division_rank: 2, division: "NL East" },
    hero: { headline: "Phillies @ Nationals", dek: "Series finale" },
    sections: {
      game_status: {
        content: {
          matchup: "Phillies @ Nationals · Game 4 of 4",
          first_pitch: "6:45 PM",
          venue: "Nationals Park",
          starters: { phi: { name: "Cristopher Sánchez", hand: "L" }, opp: { name: "Cade Cavalli", hand: "R" } },
          broadcast: { tv: "NBCSP", radio: "94 WIP" },
          weather: { temp_f: 74, condition: "Overcast", gusts_mph: 10 },
          series: { label: "Phillies lead 2-1" },
        },
      },
      preview: { content: { narrative: ["Para one.", "Para two."], pull_quote: "Quote here." } },
      recap: { show: false, content: {} },
    },
    next_game: { label: "Next Game", matchup: "PHI vs MIA", date: "2026-06-27", time: "7:05 PM", broadcast: "NBCSP" },
  };
}

test("email carries no <style> block and uses inline style attributes", () => {
  const html = buildEmailHtml(fullPayload());
  assert.ok(!/<style[\s>]/i.test(html), "email must not rely on a <style> block (clients strip it)");
  assert.ok((html.match(/ style="/g) || []).length > 20, "email must style elements inline");
  assert.ok(!html.includes("var("), "email must not contain unresolved CSS custom properties");
});

test("email drops site-only chrome and the ticker marquee", () => {
  const html = buildEmailHtml(fullPayload());
  assert.ok(!html.includes("■"), "U+25A0 ticker separator must not appear");
  assert.ok(!/Skip to main content/i.test(html), "skip link must not appear");
  assert.ok(!/pw-ticker|modulepreload|live-feed\.js/.test(html), "marquee/JS chrome must not appear");
});

test("email surfaces the matchup, starters, and pull quote", () => {
  const html = buildEmailHtml(fullPayload());
  assert.ok(html.includes("Cristopher Sánchez"), "Phillies starter present");
  assert.ok(html.includes("Cade Cavalli"), "opponent starter present");
  assert.ok(html.includes("PHI 44-36"), "record present");
  assert.ok(html.includes("Quote here."), "preview pull quote present");
});

test("email escapes HTML in data values", () => {
  const payload = fullPayload();
  payload.sections.preview.content.pull_quote = "<script>alert(1)</script>";
  const html = buildEmailHtml(payload);
  assert.ok(!html.includes("<script>alert(1)</script>"), "raw markup from data must be escaped");
  assert.ok(html.includes("&lt;script&gt;"), "value should be HTML-escaped");
});

test("off-day payload renders without throwing and shows next game", () => {
  const html = buildEmailHtml({
    meta: { publication: "Phillies Wire", date: "2026-06-13", off_day: true },
    record: { wins: 40, losses: 28 },
    next_game: { matchup: "PHI vs NYM", date: "2026-06-14", time: "7:05 PM" },
    sections: {},
  });
  assert.ok(/No game/i.test(html), "off-day notice present");
  assert.ok(html.includes("PHI vs NYM"), "next game present");
  assert.ok(!/<style[\s>]/i.test(html), "still no <style> block on off-days");
});

// Guard the module load order: deliver.mjs invokes main() at the top of the
// file when run directly, and main() calls buildEmailHtml synchronously. Any
// const it depends on (EMAIL palette, SITE_URL) must be declared before that
// guard or the real `node deliver.mjs` run dies with a temporal-dead-zone
// "Cannot access 'X' before initialization" — which an in-process import of
// buildEmailHtml (every test above) cannot reproduce. Run it as a subprocess.
test("running deliver.mjs directly does not hit a temporal-dead-zone error", () => {
  const work = mkdtempSync(join(tmpdir(), "pw-deliver-direct-"));
  try {
    writeFileSync(
      join(work, "phillies-wire-data.json"),
      JSON.stringify({
        meta: { publication: "Phillies Wire", date: "2026-06-25" },
        record: { wins: 1, losses: 0 },
        sections: { preview: { content: { narrative: ["x"] } } },
        next_game: {},
      }),
    );
    const res = spawnSync(process.execPath, [join(process.cwd(), "deliver.mjs")], {
      cwd: work,
      encoding: "utf8",
      env: {
        ...process.env,
        DELIVERY_RECIPIENTS: "test@example.com",
        SMTP_USER: "u@example.com",
        SMTP_PASS: "x",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1",
        SMTP_TIMEOUT_MS: "300",
      },
    });
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    assert.ok(!/before initialization/.test(output), `module load-order regression: ${output}`);
    assert.ok(!/is not defined/.test(output), `undefined reference at load: ${output}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

await run();
