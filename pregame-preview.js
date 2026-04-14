const SEPARATOR = " \u00b7 ";

export function buildPregamePreviewContent(context) {
  const data = context || {};
  const starters = data.starters || {};
  // Prefer the editorial phi/opp aliases, fall back to home/away for
  // backwards-compatibility with fixtures that predate the rename.
  const phiStarter = getStarterName(starters, ["phi", "home"]);
  const oppStarter = getStarterName(starters, ["opp", "away"]);
  const matchup = data.matchup || "Phillies game";
  const firstPitch = data.firstPitch || "TBD";
  const venue = data.venue || "Citizens Bank Park";
  const seriesLabel = data.seriesLabel || "Series update pending";

  return {
    preview: phiStarter + " vs " + oppStarter + SEPARATOR + matchup,
    content: {
      narrative: [
        phiStarter + " draws the assignment for Philadelphia against " + oppStarter + " in " + matchup + ".",
        "First pitch is " + firstPitch + " at " + venue + ". " + seriesLabel + ".",
      ],
      pull_quote: phiStarter + " vs " + oppStarter + " drives today's matchup.",
    },
  };
}

export function buildRecapPullQuote(context) {
  const data = context || {};
  const summaryLine = data.summaryLine || "Final score pending.";
  const venue = data.venue || "Citizens Bank Park";
  const seriesLabel = data.seriesLabel || "Series update pending";

  return summaryLine + " Final at " + venue + ". " + seriesLabel + ".";
}

function getStarterName(starters, preferredKeys) {
  if (!starters) {
    return "TBD";
  }

  const keys = Array.isArray(preferredKeys) ? preferredKeys : [preferredKeys];
  for (const key of keys) {
    const starter = starters[key];
    if (starter && starter.name) {
      return starter.name;
    }
  }

  return "TBD";
}
