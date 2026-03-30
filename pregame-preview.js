const SEPARATOR = " \u00b7 ";

export function buildPregamePreviewContent(context) {
  const data = context || {};
  const homeStarter = getStarterName(data.starters, "home");
  const awayStarter = getStarterName(data.starters, "away");
  const matchup = data.matchup || "Phillies game";
  const firstPitch = data.firstPitch || "TBD";
  const venue = data.venue || "Citizens Bank Park";
  const seriesLabel = data.seriesLabel || "Series update pending";

  return {
    preview: homeStarter + " vs " + awayStarter + SEPARATOR + matchup,
    content: {
      narrative: [
        homeStarter + " draws the assignment for Philadelphia against " + awayStarter + " in " + matchup + ".",
        "First pitch is " + firstPitch + " at " + venue + ". " + seriesLabel + ".",
      ],
      pull_quote: homeStarter + " vs " + awayStarter + " drives today's matchup.",
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

function getStarterName(starters, side) {
  const starter = starters && starters[side] ? starters[side].name : null;
  return starter || "TBD";
}
