import assert from "assert";

import { buildGameSnapshot, shouldPoll, syncLiveShell } from "../live-feed.js";

const SEP = " \u00b7 ";

runTest("buildGameSnapshot maps an in-progress game to live shell copy", () => {
  const snapshot = buildGameSnapshot({
    linescore: {
      currentInning: 7,
      isTopInning: true,
      outs: 1,
      teams: {
        away: { abbreviation: "TEX", runs: 2 },
        home: { abbreviation: "PHI", runs: 3 },
      },
    },
    feed: {
      gameData: {
        status: {
          detailedState: "In Progress",
        },
        teams: {
          away: { teamName: "Rangers", abbreviation: "TEX" },
          home: { teamName: "Phillies", abbreviation: "PHI" },
        },
      },
    },
    venue: "Citizens Bank Park",
  });

  assert.strictEqual(snapshot.mode, "live");
  assert.strictEqual(snapshot.isLive, true);
  assert.strictEqual(snapshot.isFinal, false);
  assert.strictEqual(snapshot.lineText, "TEX 2, PHI 3");
  assert.strictEqual(snapshot.detailText, "Top 7" + SEP + "1 out");
  assert.strictEqual(snapshot.heroLabel, "Live");
  assert.strictEqual(snapshot.heroHeadline, "Rangers 2, Phillies 3");
  assert.strictEqual(snapshot.heroDek, "Top 7" + SEP + "1 out");
  assert.strictEqual(snapshot.previewText, "Rangers 2, Phillies 3" + SEP + "Top 7" + SEP + "1 out");
  assert.ok(/Citizens Bank Park/.test(snapshot.heroSummary));
});

runTest("buildGameSnapshot maps a final game to final shell copy", () => {
  const snapshot = buildGameSnapshot({
    linescore: {
      currentInning: 9,
      isTopInning: false,
      outs: 3,
      teams: {
        away: { abbreviation: "TEX", runs: 2 },
        home: { abbreviation: "PHI", runs: 5 },
      },
    },
    feed: {
      gameData: {
        status: {
          detailedState: "Final",
        },
        teams: {
          away: { teamName: "Rangers", abbreviation: "TEX" },
          home: { teamName: "Phillies", abbreviation: "PHI" },
        },
      },
    },
    venue: "Citizens Bank Park",
  });

  assert.strictEqual(snapshot.mode, "final");
  assert.strictEqual(snapshot.isLive, false);
  assert.strictEqual(snapshot.isFinal, true);
  assert.strictEqual(snapshot.detailText, "Final");
  assert.strictEqual(snapshot.heroLabel, "Final");
  assert.strictEqual(snapshot.heroHeadline, "Rangers 2, Phillies 5");
  assert.strictEqual(snapshot.heroDek, "Final");
  assert.strictEqual(snapshot.previewText, "Rangers 2, Phillies 5" + SEP + "Final");
});

runTest("buildGameSnapshot uses feed team abbreviations when linescore omits them", () => {
  const snapshot = buildGameSnapshot({
    linescore: {
      currentInning: 2,
      isTopInning: false,
      outs: 2,
      teams: {
        away: { runs: 5 },
        home: { runs: 0 },
      },
    },
    feed: {
      gameData: {
        status: {
          detailedState: "In Progress",
        },
        teams: {
          away: { teamName: "Nationals", abbreviation: "WSH" },
          home: { teamName: "Phillies", abbreviation: "PHI" },
        },
      },
    },
    venue: "Citizens Bank Park",
  });

  assert.strictEqual(snapshot.lineText, "WSH 5, PHI 0");
  assert.strictEqual(snapshot.heroHeadline, "Nationals 5, Phillies 0");
  assert.strictEqual(snapshot.previewText, "Nationals 5, Phillies 0" + SEP + "Bot 2" + SEP + "2 outs");
});

runTest("syncLiveShell promotes a stale pregame shell to live", () => {
  const doc = createFakeDocument();
  const snapshot = buildGameSnapshot({
    linescore: {
      currentInning: 4,
      isTopInning: false,
      outs: 2,
      teams: {
        away: { abbreviation: "TEX", runs: 1 },
        home: { abbreviation: "PHI", runs: 4 },
      },
    },
    feed: {
      gameData: {
        status: {
          detailedState: "In Progress",
        },
        teams: {
          away: { teamName: "Rangers", abbreviation: "TEX" },
          home: { teamName: "Phillies", abbreviation: "PHI" },
        },
      },
    },
    venue: "Citizens Bank Park",
  });

  syncLiveShell(doc, snapshot);

  assert.strictEqual(doc.getElementById("pw-status-mode-chip").textContent, "Live");
  assert.strictEqual(doc.getElementById("pw-status-text").textContent, "Updated live" + SEP + "Bot 4" + SEP + "2 outs");
  assert.strictEqual(doc.getElementById("pw-hero-label").textContent, "Live");
  assert.strictEqual(doc.getElementById("pw-hero-headline").textContent, "Rangers 1, Phillies 4");
  assert.strictEqual(doc.getElementById("pw-hero-dek").textContent, "Bot 4" + SEP + "2 outs");
  assert.strictEqual(doc.getElementById("pw-hero-summary").textContent, "Live from Citizens Bank Park.");
  assert.strictEqual(doc.getElementById("pw-game-status-preview").textContent, "Rangers 1, Phillies 4" + SEP + "Bot 4" + SEP + "2 outs");
  assert.strictEqual(doc.getElementById("pw-live-line").textContent, "TEX 1, PHI 4");
  assert.strictEqual(doc.getElementById("pw-live-detail").textContent, "Bot 4" + SEP + "2 outs");
  assert.strictEqual(doc.body.dataset.pageMode, "live");
  assert.strictEqual(doc.getElementById("pw-hero-section").dataset.liveMode, "live");
  assert.ok(doc.getElementById("pw-hero-section").classList.contains("pw-hero--live"));
  assert.ok(!doc.getElementById("pw-hero-section").classList.contains("pw-hero--pregame"));
  assert.ok(doc.getElementById("pw-live-score").classList.contains("pw-live-score--active"));
});

runTest("buildGameSnapshot treats Delayed state as paused", () => {
  const snapshot = buildGameSnapshot({
    linescore: {
      currentInning: 4,
      isTopInning: true,
      outs: 2,
      teams: {
        away: { abbreviation: "TEX", runs: 1 },
        home: { abbreviation: "PHI", runs: 0 },
      },
    },
    feed: {
      gameData: {
        status: { detailedState: "Delayed: Rain" },
        teams: {
          away: { teamName: "Rangers", abbreviation: "TEX" },
          home: { teamName: "Phillies", abbreviation: "PHI" },
        },
      },
    },
    venue: "Citizens Bank Park",
  });

  assert.strictEqual(snapshot.isLive, false);
  assert.strictEqual(snapshot.isFinal, false);
  assert.strictEqual(snapshot.heroLabel, "Delayed");
  assert.strictEqual(snapshot.detailText, "Delayed");
});

runTest("shouldPoll keeps a pregame tab eligible for live updates", () => {
  const firstPitch = "2026-03-29T17:35:00Z";
  const ninetyMinutesEarly = Date.parse("2026-03-29T16:05:00Z");

  assert.strictEqual(shouldPoll(firstPitch, ninetyMinutesEarly), true);
});

function createFakeDocument() {
  const elements = new Map();

  function addElement(id, options = {}) {
    const element = {
      id,
      textContent: options.textContent ?? "",
      dataset: { ...(options.dataset ?? {}) },
      attributes: {},
      classList: createClassList(options.classNames ?? []),
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      getAttribute(name) {
        return this.attributes[name];
      },
    };
    elements.set(id, element);
    return element;
  }

  addElement("pw-status-mode-chip", { textContent: "Pregame" });
  addElement("pw-status-text", { textContent: "Updated Mar 29, 2026, 12:12 PM ET" });
  addElement("pw-hero-section", {
    classNames: ["pw-hero", "pw-hero--pregame"],
    dataset: { liveMode: "pregame" },
  });
  addElement("pw-hero-label", { textContent: "Pregame" });
  addElement("pw-hero-headline", { textContent: "Phillies vs Rangers - Game 3" });
  addElement("pw-hero-dek", { textContent: "Jesus Luzardo vs MacKenzie Gore" });
  addElement("pw-hero-summary", { textContent: "Nola's redemption bid." });
  addElement("pw-game-status-preview", { textContent: "PHI vs TEX" + SEP + "1:35 PM" + SEP + "Citizens Bank Park" });
  addElement("pw-live-score");
  addElement("pw-live-line");
  addElement("pw-live-detail");

  return {
    body: {
      dataset: {
        pageMode: "pregame",
      },
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
  };
}

function createClassList(initial) {
  const values = new Set(initial);
  return {
    add(...classes) {
      for (const cls of classes) {
        values.add(cls);
      }
    },
    remove(...classes) {
      for (const cls of classes) {
        values.delete(cls);
      }
    },
    contains(cls) {
      return values.has(cls);
    },
  };
}

function runTest(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (error) {
    console.error("FAIL", name);
    throw error;
  }
}
