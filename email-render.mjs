// Email renderer — a self-contained, table-based, fully inline-styled HTML
// email built from the issue data. Mail clients (notably the Gmail app) strip
// <style> blocks and never resolve CSS custom properties, so this document
// uses ZERO <style> blocks and ZERO var(): every rule is an inline style=""
// with a concrete hex/px value. It also drops all site-only chrome (the
// scrolling ticker marquee, skip link, nav, JS preloads). Ported from the
// design project's email.html. Track A correctness is preserved: transit is
// shown only on home games; broadcast/weather come straight from the data.

import { SUBSCRIBE_URL } from "./config.mjs";

const DISPLAY = "'Barlow Condensed','Arial Narrow',Arial,sans-serif";
const BODY = "'Inter',Helvetica,Arial,sans-serif";
const SITE_URL = "https://phillieswire.com";

const EMAIL = {
  page: "#e7e0d3",
  paper: "#fff9f0",
  navy: "#002d72",
  red: "#e81828",
  gold: "#c4973a",
  ink: "#17120a",
  dim: "#5c5446",
  faint: "#9b9184",
  line: "#ece4d5",
  edge: "#e7e0d2",
  footer: "#001440",
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function longDate(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return esc(isoDate);
  }
  const wk = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()];
  return `${wk}, ${mo} ${date.getDate()}, ${date.getFullYear()}`;
}

function masthead(meta, record) {
  return `
  <tr><td bgcolor="${EMAIL.navy}" style="background:${EMAIL.navy}; background-image:repeating-linear-gradient(90deg, rgba(255,255,255,0) 0, rgba(255,255,255,0) 5px, rgba(255,255,255,0.05) 5px, rgba(255,255,255,0.05) 6px);">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:22px 28px 20px; border-bottom:3px solid ${EMAIL.gold};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle">
            <div style="font-family:${DISPLAY}; font-weight:800; font-size:33px; line-height:0.94; letter-spacing:0.01em; text-transform:uppercase; color:#ffffff;">${esc(meta.publication)}</div>
            <div style="font-family:${DISPLAY}; font-weight:600; font-size:11px; line-height:1; letter-spacing:0.18em; text-transform:uppercase; color:#d4ac58; padding-top:5px;">Vol. ${esc(meta.volume)} &middot; No. ${esc(meta.edition)} &middot; ${longDate(meta.date)}</div>
          </td>
          <td valign="middle" align="right" width="84" style="width:84px;">
            <table role="presentation" align="right" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL.red}" style="background:${EMAIL.red}; border:1px solid #f06472; border-radius:4px;"><tr><td align="center" style="padding:6px 12px;">
              <div style="font-family:${DISPLAY}; font-weight:800; font-size:22px; line-height:1; color:#ffffff;">${esc(record.wins)}&#8211;${esc(record.losses)}</div>
              <div style="font-family:${DISPLAY}; font-weight:700; font-size:9px; line-height:1; letter-spacing:0.16em; color:#ffd2d7; padding-top:3px;">SEASON</div>
            </td></tr></table>
          </td>
        </tr></table>
      </td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="${EMAIL.navy}" style="background:${EMAIL.navy}; padding:9px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-bottom:1px solid #7a5f2c;">&nbsp;</td>
      <td align="center" style="white-space:nowrap; padding:0 12px; font-family:${DISPLAY}; font-weight:600; font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:rgba(255,255,255,0.82);">
        <span style="color:#d4ac58;">Philadelphia, Pennsylvania</span> &nbsp;<span style="color:${EMAIL.gold};">&#9670;</span>&nbsp; Est. 2026 &nbsp;<span style="color:${EMAIL.gold};">&#9670;</span>&nbsp; Ring the Bell
      </td>
      <td style="border-bottom:1px solid #7a5f2c;">&nbsp;</td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:13px 28px; border-bottom:1px solid ${EMAIL.line};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle">
        <span style="display:inline-block; background:${EMAIL.red}; color:#ffffff; font-family:${DISPLAY}; font-weight:800; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; padding:3px 9px; border-radius:3px;">${esc(meta.status?.mode_label || "Pregame")}</span>
        <span style="font-family:${DISPLAY}; font-weight:700; font-size:12px; letter-spacing:0.06em; color:${EMAIL.navy}; padding-left:10px;">PHI ${esc(record.wins)}-${esc(record.losses)}</span>
        ${record.streak ? `<span style="font-family:${BODY}; font-size:12px; color:${EMAIL.dim}; padding-left:6px;">&middot; ${esc(record.streak)}</span>` : ""}
      </td>
      <td valign="middle" align="right" style="font-family:${BODY}; font-size:12px; color:#8a8173;">${esc(meta.status?.generated_at_et || meta.status?.enrich_label || "")}</td>
    </tr></table>
  </td></tr>`;
}

function sectionHeader(num, title) {
  return `
  <tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:24px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" width="30" style="width:30px;"><span style="display:inline-block; font-family:${DISPLAY}; font-weight:800; font-size:12px; letter-spacing:0.06em; color:${EMAIL.red}; border:1px solid #d9cfbc; border-radius:3px; padding:2px 5px;">${esc(num)}</span></td>
      <td valign="middle" style="font-family:${DISPLAY}; font-weight:800; font-size:20px; letter-spacing:0.04em; text-transform:uppercase; color:${EMAIL.navy}; padding-left:9px; white-space:nowrap;">${esc(title)}</td>
      <td valign="middle" style="padding-left:13px;"><div style="border-bottom:2px solid #e7dfd0; font-size:0; line-height:0;">&nbsp;</div></td>
    </tr></table>
  </td></tr>`;
}

function infoCard(accent, label, value) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background:#ffffff; border:1px solid ${EMAIL.edge};">
          <tr><td height="4" style="height:4px; line-height:4px; font-size:1px; background:${accent};">&nbsp;</td></tr>
          <tr><td style="padding:9px 12px 11px;">
            <div style="font-family:${DISPLAY}; font-weight:700; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:${EMAIL.faint};">${label}</div>
            <div style="font-family:${DISPLAY}; font-weight:800; font-size:18px; line-height:1.05; color:${EMAIL.ink}; padding-top:2px;">${value}</div>
          </td></tr>
        </table>`;
}

function statCell(label, value, align) {
  const pad = align === "right" ? "padding-left:22px;" : "padding-right:22px;";
  return `<td align="${align}" style="${pad}">
            <div style="font-family:${DISPLAY}; font-weight:700; font-size:9px; letter-spacing:0.12em; text-transform:uppercase; color:${EMAIL.faint};">${esc(label)}</div>
            <div style="font-family:${DISPLAY}; font-weight:800; font-size:20px; line-height:1; color:${EMAIL.ink};">${esc(value)}</div>
          </td>`;
}

function taleOfTheTape(tape) {
  if (!tape || !tape.away || !tape.home) {
    return "";
  }
  const side = (s, align) => {
    const teamColor = align === "right" ? EMAIL.red : EMAIL.faint;
    const stats = `<table role="presentation"${align === "right" ? ' align="right"' : ""} cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr>
          ${statCell("ERA", s.era, align)}${statCell("W–L", s.record, align)}${statCell("WHIP", s.whip, align)}
        </tr></table>`;
    return `<td valign="top"${align === "right" ? ' align="right" style="padding:15px 16px 17px; text-align:right;"' : ' style="padding:15px 16px 17px;"'}>
        <div style="font-family:${DISPLAY}; font-weight:800; font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:${teamColor};">${esc(s.team)} &middot; ${align === "right" ? "Home" : "Away"}</div>
        <div style="font-family:${DISPLAY}; font-weight:800; font-size:23px; line-height:1.04; letter-spacing:-0.01em; color:${EMAIL.navy}; padding-top:3px;">${esc(s.name)}</div>
        <div style="font-family:${DISPLAY}; font-weight:700; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:#7a7264; padding-top:1px;">${esc(s.hand)}HP</div>
        ${stats}
      </td>`;
  };
  return `
  <tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:18px 28px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background:#ffffff; border:1px solid ${EMAIL.edge};"><tr>
      ${side(tape.away, "left")}
      <td width="72" bgcolor="${EMAIL.navy}" align="center" valign="middle" style="width:72px; background:${EMAIL.navy};">
        <div style="width:12px; height:12px; background:${EMAIL.gold}; margin:0 auto 8px; font-size:0; line-height:0; mso-hide:all;">&nbsp;</div>
        <div style="font-family:${DISPLAY}; font-weight:800; font-size:16px; letter-spacing:0.10em; color:#ffffff;">VS</div>
      </td>
      ${side(tape.home, "right")}
    </tr></table>
  </td></tr>`;
}

function standingsBlock(teams) {
  if (!teams.length) {
    return "";
  }
  const rows = teams.map((t) => {
    const phi = t.is_phi;
    const tdColor = phi ? "#a8001a" : EMAIL.dim;
    const weight = phi ? "700" : "400";
    const bg = phi ? ' bgcolor="#fdeef0" style="background:#fdeef0;"' : ' style="border-top:1px solid #ece4d5;"';
    const cell = (v, last) => `<td align="center" style="padding:8px ${last ? "14px 8px 6px" : "6px"}; font-family:${BODY}; font-size:13px; font-weight:${weight}; color:${tdColor}; font-variant-numeric:tabular-nums;">${esc(v)}</td>`;
    const nameStyle = phi ? `padding:8px 14px; border-left:3px solid ${EMAIL.red}; font-family:${BODY}; font-size:13px; font-weight:700; color:#a8001a;` : `padding:8px 14px; font-family:${BODY}; font-size:13px; font-weight:600; color:${EMAIL.ink};`;
    return `<tr${bg}>
        <td style="${nameStyle}">${esc(t.abbr)}</td>
        ${cell(t.wins)}${cell(t.losses)}${cell(t.pct)}${cell(t.gb)}${cell(t.streak, true)}
      </tr>`;
  }).join("");
  const th = (label, last) => `<th align="${label === "Team" ? "left" : "center"}" style="padding:7px ${last ? "14px 7px 6px" : label === "Team" ? "14px" : "6px"}; font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#ffffff;">${label}</th>`;
  return `${sectionHeader("02", "NL East")}
  <tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:12px 28px 2px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background:#ffffff; border:1px solid ${EMAIL.edge};">
      <tr bgcolor="${EMAIL.navy}" style="background:${EMAIL.navy};">${th("Team")}${th("W")}${th("L")}${th("Pct")}${th("GB")}${th("Strk", true)}</tr>
      ${rows}
    </table>
  </td></tr>`;
}

function injuryBlock(entries) {
  if (!entries.length) {
    return "";
  }
  const rows = entries.map((e, i) => {
    const last = i === entries.length - 1;
    const border = last ? "" : "border-bottom:1px solid #ece4d5;";
    return `<tr><td style="padding:11px 0 11px; ${border}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="top">
            <div style="font-family:${BODY}; font-size:14px; font-weight:600; color:${EMAIL.ink};">${esc(e.name)} <span style="color:${EMAIL.faint}; font-weight:500;">&middot; ${esc(e.position)}</span></div>
            <div style="font-family:${BODY}; font-size:12.5px; color:#6b6354; padding-top:2px;">${esc(e.injury)}</div>
          </td>
          <td valign="middle" align="right" width="78" style="width:78px;"><span style="display:inline-block; background:#fde8ea; color:#7a0012; font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.06em; text-transform:uppercase; padding:3px 9px; border-radius:999px;">${esc(e.il_type)} IL</span></td>
        </tr></table>
      </td></tr>`;
  }).join("");
  return `${sectionHeader("03", "Injury Report")}
  <tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:8px 28px 2px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
  </td></tr>`;
}

function upNextBlock(nextGame, moreRows, label) {
  const more = moreRows.map((r, i) => {
    const last = i === moreRows.length - 1;
    const border = last ? "" : "border-bottom:1px solid #ece4d5;";
    return `<tr><td style="padding:9px 0; ${border}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle" width="92" style="width:92px; font-family:${DISPLAY}; font-weight:700; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${EMAIL.faint};">${esc(r.date)}</td>
          <td valign="middle" style="font-family:${BODY}; font-size:13px; color:${EMAIL.ink};">${esc(r.matchup)} &middot; ${esc(r.time)}${r.broadcast ? ` &middot; ${esc(r.broadcast)}` : ""}</td>
        </tr></table>
      </td></tr>`;
  }).join("");
  return `${sectionHeader("04", label)}
  <tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:12px 28px 2px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL.navy}" style="background:${EMAIL.navy};"><tr><td style="padding:14px 16px;">
      <div style="font-family:${DISPLAY}; font-weight:700; font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:#d4ac58;">${esc(nextGame.label || "Next Game")} &middot; ${esc(nextGame.date)}</div>
      <div style="font-family:${DISPLAY}; font-weight:800; font-size:21px; line-height:1.06; color:#ffffff; padding-top:3px;">${esc(nextGame.matchup)}</div>
      <div style="font-family:${BODY}; font-size:12.5px; color:#aebbe0; padding-top:5px;">${esc(nextGame.time)}${nextGame.broadcast ? ` &middot; ${esc(nextGame.broadcast)}` : ""}${nextGame.venue ? ` &middot; ${esc(nextGame.venue)}` : ""}</div>
    </td></tr></table>
  </td></tr>
  ${more ? `<tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:6px 28px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${more}</table></td></tr>` : ""}`;
}

function ctaAndFooter(meta, issueUrl) {
  return `
  <tr><td bgcolor="${EMAIL.navy}" align="center" style="background:${EMAIL.navy}; padding:30px 28px 32px; border-top:3px solid ${EMAIL.gold};">
    <div style="font-family:${DISPLAY}; font-weight:800; font-size:30px; line-height:1; letter-spacing:0.01em; text-transform:uppercase; color:#ffffff;">Ring the Bell</div>
    <div style="font-family:${BODY}; font-size:13.5px; line-height:1.55; color:#aebbe0; padding:9px 0 20px;">Live box score, confirmed lineups, and park updates the moment they post.</div>
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(issueUrl)}" style="height:46px;v-text-anchor:middle;width:230px;" arcsize="11%" strokecolor="${EMAIL.red}" fillcolor="${EMAIL.red}">
    <w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;letter-spacing:1px;">RING THE BELL &#8594;</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <a href="${esc(issueUrl)}" style="display:inline-block; background:${EMAIL.red}; color:#ffffff; font-family:${DISPLAY}; font-weight:800; font-size:16px; letter-spacing:0.10em; text-transform:uppercase; padding:13px 32px; border-radius:5px; text-decoration:none;">Ring the Bell &#8594;</a>
    <!--<![endif]-->
  </td></tr>
  <tr><td bgcolor="${EMAIL.footer}" style="background:${EMAIL.footer}; padding:24px 28px 26px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" style="padding-bottom:4px;">
        <div style="font-family:${DISPLAY}; font-weight:800; font-size:19px; letter-spacing:0.04em; text-transform:uppercase; color:#ffffff;">${esc(meta.publication)}</div>
        <div style="font-family:${DISPLAY}; font-weight:700; font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:${EMAIL.gold}; padding-top:5px;">Ring the Bell &middot; Est. 2026</div>
      </td></tr>
      <tr><td align="center" style="padding:12px 0 12px;"><div style="border-top:3px double rgba(255,255,255,0.18); width:60%; margin:0 auto; font-size:0; line-height:0;">&nbsp;</div></td></tr>
      <tr><td align="center" style="font-family:${BODY}; font-size:11.5px; line-height:1.5; color:#8aa0c8;">Vol. ${esc(meta.volume)} &middot; No. ${esc(meta.edition)} &middot; ${esc(meta.date)}</td></tr>
      <tr><td align="center" style="padding:10px 0 0; font-family:${DISPLAY}; font-weight:600; font-size:12px; letter-spacing:0.10em; text-transform:uppercase;">
        <a href="${esc(issueUrl)}" style="color:#d4ac58; text-decoration:none;">View online</a>
        <span style="color:#3a5286;">&nbsp;&middot;&nbsp;</span>
        <a href="${SITE_URL}/archive/" style="color:#d4ac58; text-decoration:none;">Archive</a>
        <span style="color:#3a5286;">&nbsp;&middot;&nbsp;</span>
        <a href="${esc(SUBSCRIBE_URL)}" style="color:#d4ac58; text-decoration:none;">Subscribe</a>
      </td></tr>
      <tr><td align="center" style="padding:14px 0 0; font-family:${BODY}; font-size:11px; line-height:1.55; color:#5e76a6;">Phillies Wire &middot; Citizens Bank Park &middot; Philadelphia, PA 19148</td></tr>
    </table>
  </td></tr>`;
}

function shell(meta, record, preheader, inner) {
  const issueUrl = meta.canonical_url || `${SITE_URL}/issues/${meta.date}/`;
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<title>${esc(meta.publication)} &middot; ${esc(meta.date)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0; padding:0; background:${EMAIL.page};">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${EMAIL.page};">${esc(preheader)} &mdash; PHI ${esc(record.wins)}-${esc(record.losses)}. Ring the bell.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL.page}" style="background:${EMAIL.page};">
<tr><td align="center" style="padding:22px 12px 30px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;"><tr>
  <td align="left" style="font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#9a8f7c; padding:0 4px 8px;">${esc(meta.publication)} &middot; The Pregame Wire</td>
  <td align="right" style="font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.10em; text-transform:uppercase; padding:0 4px 8px;"><a href="${esc(issueUrl)}" style="color:#9a8f7c; text-decoration:none;">View in browser &#8594;</a></td>
</tr></table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL.paper}" style="width:600px; max-width:600px; background:${EMAIL.paper}; border:1px solid #ded6c6;">
${masthead(meta, record)}
${inner}
${ctaAndFooter(meta, issueUrl)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

export function buildEmailHtml(data) {
  const meta = data.meta ?? {};
  const record = data.record ?? {};
  const hero = data.hero ?? {};
  const gs = data.sections?.game_status?.content ?? null;
  const nextGame = data.next_game ?? {};
  const isOffDay = meta.off_day === true || !gs;

  if (isOffDay) {
    const inner = `
  <tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:30px 28px 10px;">
    <div style="font-family:${DISPLAY}; font-weight:700; font-size:13px; letter-spacing:0.16em; text-transform:uppercase; color:${EMAIL.red};">Off Day</div>
    <div style="font-family:${DISPLAY}; font-weight:800; font-size:40px; line-height:1; text-transform:uppercase; color:${EMAIL.navy}; padding-top:10px;">No game today.</div>
    <div style="font-family:${BODY}; font-size:14px; line-height:1.55; color:${EMAIL.dim}; padding-top:11px;">${esc(hero.summary || "The Phillies are off. Here's what's next.")}</div>
  </td></tr>
  ${nextGame.matchup ? upNextBlock(nextGame, [], "Next Game") : ""}`;
    return shell(meta, record, hero.dek || "No game today", inner);
  }

  const starters = gs.starters ?? {};
  const phi = starters.phi ?? {};
  const opp = starters.opp ?? {};
  const matchupLine = phi.name && opp.name
    ? `${esc(phi.name)} (${esc(phi.hand)}HP) vs ${esc(opp.name)} (${esc(opp.hand)}HP)`
    : esc(hero.dek);
  const broadcast = gs.broadcast ?? {};
  const watchListen = [broadcast.tv, broadcast.radio].filter(Boolean).map(esc).join(" · ") || "TBD";
  const weather = gs.weather ?? {};
  const parkBits = [`${esc(weather.temp_f)}&deg; &middot; ${esc(weather.condition)} &middot; gusts ${esc(weather.gusts_mph)} mph`];
  if (gs.venue_is_home && gs.transit) {
    parkBits.push(`SEPTA: ${esc(gs.transit)}`);
  }
  const pullQuote = data.sections?.preview?.content?.pull_quote;
  const standings = data.sections?.standings?.content?.teams ?? [];
  const injuries = data.sections?.injury_report?.content?.il_entries ?? [];
  const upNext = data.sections?.preview?.content?.up_next ?? [];
  const moreRows = upNext.length > 1 ? upNext.slice(1) : [];

  const hero_block = `
  <tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:26px 28px 6px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="padding-right:9px;"><div style="width:22px; height:3px; background:${EMAIL.red}; font-size:0; line-height:0;">&nbsp;</div></td>
      <td valign="middle" style="font-family:${DISPLAY}; font-weight:700; font-size:13px; letter-spacing:0.16em; text-transform:uppercase; color:${EMAIL.red};">${esc(hero.label || gs.series?.label || "Pregame")}</td>
    </tr></table>
    <div style="font-family:${DISPLAY}; font-weight:800; font-size:46px; line-height:0.95; letter-spacing:-0.01em; text-transform:uppercase; color:${EMAIL.navy}; padding-top:10px;">${esc(hero.headline || gs.matchup)}</div>
    <div style="font-family:${DISPLAY}; font-weight:700; font-size:24px; line-height:1.04; color:${EMAIL.ink}; padding-top:9px;">${matchupLine}</div>
    ${hero.dek && phi.name ? `<div style="font-family:${BODY}; font-size:14px; line-height:1.55; color:${EMAIL.dim}; padding-top:10px;">${esc(hero.dek)}</div>` : ""}
  </td></tr>`;

  const pull_block = pullQuote
    ? `<tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:14px 28px 2px;">
        <div style="font-family:${BODY}; font-style:italic; font-size:16px; line-height:1.5; color:${EMAIL.navy}; border-left:4px solid ${EMAIL.red}; padding:4px 0 4px 14px;">&ldquo;${esc(pullQuote)}&rdquo;</div>
      </td></tr>`
    : "";

  const gameInfo = `${sectionHeader("01", "Game Info")}
  <tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:13px 28px 2px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="top" width="33%" style="width:33%; padding-right:7px;">${infoCard(EMAIL.red, "First Pitch", esc(gs.first_pitch))}</td>
      <td valign="top" width="34%" style="width:34%; padding:0 4px;">${infoCard(EMAIL.navy, "Venue", esc(gs.venue))}</td>
      <td valign="top" width="33%" style="width:33%; padding-left:7px;">${infoCard(EMAIL.gold, "Watch &middot; Listen", watchListen)}</td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="${EMAIL.paper}" style="background:${EMAIL.paper}; padding:9px 28px 2px;">
    <div style="font-family:${BODY}; font-size:12.5px; line-height:1.55; color:#6b6354;"><strong style="color:${EMAIL.ink}; font-weight:700;">Park notes &mdash;</strong> ${parkBits.join(". ")}.</div>
  </td></tr>`;

  const inner = `${hero_block}${taleOfTheTape(gs.matchup_tape)}${pull_block}${gameInfo}${standingsBlock(standings)}${injuryBlock(injuries)}${nextGame.matchup ? upNextBlock(nextGame, moreRows, "Up Next") : ""}`;
  return shell(meta, record, hero.dek || matchupLine.replace(/<[^>]*>/g, ""), inner);
}
