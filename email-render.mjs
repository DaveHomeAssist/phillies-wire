// Email renderer — produces a self-contained, inline-styled, table-based
// HTML email from the issue data. Mail clients (Gmail, Outlook, Apple Mail)
// do not honor <style> blocks or CSS custom properties reliably, so every
// element carries inline style="" with concrete hex; the <style> block is
// limited to resets, dark mode, and responsive tweaks. Ported from the
// design project's email.html. Track A correctness is preserved: transit is
// shown only on home games, and broadcast/weather come straight from data.

const DISPLAY = "'Barlow Condensed','Arial Narrow',Arial,sans-serif";
const BODY = "'Inter',Helvetica,Arial,sans-serif";
const SITE = "https://davehomeassist.github.io/phillies-wire";

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

function sectionHeader(num, title) {
  return `
  <tr><td class="pw-px d-card" bgcolor="#fff9f0" style="background:#fff9f0; padding:24px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" width="30" style="width:30px;"><span class="d-edge" style="display:inline-block; font-family:${DISPLAY}; font-weight:800; font-size:12px; letter-spacing:0.06em; color:#e81828; border:1px solid #d9cfbc; border-radius:3px; padding:2px 5px;">${esc(num)}</span></td>
      <td valign="middle" class="d-navytext" style="font-family:${DISPLAY}; font-weight:800; font-size:20px; letter-spacing:0.04em; text-transform:uppercase; color:#002d72; padding-left:9px; white-space:nowrap;">${esc(title)}</td>
      <td valign="middle" style="padding-left:13px;"><div class="d-line" style="border-bottom:2px solid #e7dfd0; font-size:0; line-height:0;">&nbsp;</div></td>
    </tr></table>
  </td></tr>`;
}

function statCol(label, value, align = "left") {
  const pad = align === "right" ? "padding-left:22px;" : "padding-right:22px;";
  return `<td align="${align}" style="${pad}">
            <div class="d-faint" style="font-family:${DISPLAY}; font-weight:700; font-size:9px; letter-spacing:0.12em; text-transform:uppercase; color:#9b9184;">${esc(label)}</div>
            <div class="d-ink" style="font-family:${DISPLAY}; font-weight:800; font-size:20px; line-height:1; color:#17120a;">${esc(value)}</div>
          </td>`;
}

function taleOfTheTape(tape) {
  if (!tape || !tape.away || !tape.home) {
    return "";
  }
  const side = (s, align) => {
    const teamColor = align === "right" ? "#e81828" : "#9b9184";
    const stats = `<table role="presentation"${align === "right" ? ' align="right"' : ""} cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr>
          ${statCol("ERA", s.era, align)}${statCol("W–L", s.record, align)}${statCol("WHIP", s.whip, align)}
        </tr></table>`;
    return `<td class="mu-side" valign="top"${align === "right" ? ' align="right" style="padding:15px 16px 17px; text-align:right;"' : ' style="padding:15px 16px 17px;"'}>
        <div style="font-family:${DISPLAY}; font-weight:800; font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:${teamColor};">${esc(s.team)} &middot; ${align === "right" ? "Home" : "Away"}</div>
        <div class="d-navytext" style="font-family:${DISPLAY}; font-weight:800; font-size:23px; line-height:1.04; letter-spacing:-0.01em; color:#002d72; padding-top:3px;">${esc(s.name)}</div>
        <div class="d-dim" style="font-family:${DISPLAY}; font-weight:700; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:#7a7264; padding-top:1px;">${esc(s.hand)}HP</div>
        ${stats}
      </td>`;
  };
  return `
  <tr>
  <td class="pw-px d-card" bgcolor="#fff9f0" style="background:#fff9f0; padding:18px 28px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="d-card2 d-edge" bgcolor="#ffffff" style="background:#ffffff; border:1px solid #e7e0d2;">
    <tr>
      ${side(tape.away, "left")}
      <td class="d-navband" width="72" bgcolor="#002d72" align="center" valign="middle" style="width:72px; background:#002d72;">
        <div style="width:12px; height:12px; background:#c4973a; margin:0 auto 8px; font-size:0; line-height:0; mso-hide:all;">&nbsp;</div>
        <div style="font-family:${DISPLAY}; font-weight:800; font-size:16px; letter-spacing:0.10em; color:#ffffff;">VS</div>
      </td>
      ${side(tape.home, "right")}
    </tr>
    </table>
  </td>
  </tr>`;
}

// label and value are already-safe HTML (caller escapes data values).
function infoCard(accent, label, value) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="d-capcard d-edge" bgcolor="#ffffff" style="background:#ffffff; border:1px solid #e7e0d2;">
          <tr><td height="4" style="height:4px; line-height:4px; font-size:1px; background:${accent};">&nbsp;</td></tr>
          <tr><td style="padding:9px 12px 11px;">
            <div class="d-faint" style="font-family:${DISPLAY}; font-weight:700; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:#9b9184;">${label}</div>
            <div class="d-ink" style="font-family:${DISPLAY}; font-weight:800; font-size:18px; line-height:1.05; color:#17120a; padding-top:2px;">${value}</div>
          </td></tr>
        </table>`;
}

function standingsRows(teams) {
  return (teams || []).map((t) => {
    if (t.is_phi) {
      const cell = (v, extra = "") => `<td align="center" class="d-phitext" style="padding:8px 6px; font-family:${BODY}; font-size:13px; font-weight:700; color:#a8001a; ${extra}">${esc(v)}</td>`;
      return `<tr class="d-phirow" bgcolor="#fdeef0" style="background:#fdeef0;">
        <td style="padding:8px 14px; border-left:3px solid #e81828; font-family:${BODY}; font-size:13px; font-weight:700; color:#a8001a;" class="d-phitext">${esc(t.abbr)}</td>
        ${cell(t.wins, "font-variant-numeric:tabular-nums;")}${cell(t.losses, "font-variant-numeric:tabular-nums;")}${cell(t.pct, "font-variant-numeric:tabular-nums;")}${cell(t.gb, "font-variant-numeric:tabular-nums;")}
        <td align="center" class="d-phitext" style="padding:8px 14px 8px 6px; font-family:${BODY}; font-size:13px; font-weight:700; color:#a8001a;">${esc(t.streak)}</td>
      </tr>`;
    }
    const cell = (v) => `<td align="center" class="d-dim" style="padding:8px 6px; font-family:${BODY}; font-size:13px; color:#5c5446; font-variant-numeric:tabular-nums;">${esc(v)}</td>`;
    return `<tr class="d-line" style="border-top:1px solid #ece4d5;">
        <td style="padding:8px 14px; font-family:${BODY}; font-size:13px; font-weight:600; color:#17120a;" class="d-ink">${esc(t.abbr)}</td>
        ${cell(t.wins)}${cell(t.losses)}${cell(t.pct)}${cell(t.gb)}
        <td align="center" class="d-dim" style="padding:8px 14px 8px 6px; font-family:${BODY}; font-size:13px; color:#5c5446;">${esc(t.streak)}</td>
      </tr>`;
  }).join("");
}

function injuryRows(entries) {
  const list = entries || [];
  if (!list.length) {
    return `<tr><td style="padding:11px 0 4px; font-family:${BODY}; font-size:13px; color:#6b6354;" class="d-dim">No active injured list entries.</td></tr>`;
  }
  return list.map((e, i) => {
    const last = i === list.length - 1;
    const border = last ? "" : "border-bottom:1px solid #ece4d5;";
    return `<tr><td class="d-line" style="padding:11px 0 11px; ${border}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="top">
            <div class="d-ink" style="font-family:${BODY}; font-size:14px; font-weight:600; color:#17120a;">${esc(e.name)} <span class="d-faint" style="color:#9b9184; font-weight:500;">&middot; ${esc(e.position)}</span></div>
            <div class="d-dim" style="font-family:${BODY}; font-size:12.5px; color:#6b6354; padding-top:2px;">${esc(e.injury)}</div>
          </td>
          <td valign="middle" align="right" width="78" style="width:78px;"><span class="d-il" style="display:inline-block; background:#fde8ea; color:#7a0012; font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.06em; text-transform:uppercase; padding:3px 9px; border-radius:999px;">${esc(e.il_type)} IL</span></td>
        </tr></table>
      </td></tr>`;
  }).join("");
}

function upNextRows(rows) {
  return (rows || []).map((r, i) => {
    const last = i === rows.length - 1;
    const border = last ? "" : "border-bottom:1px solid #ece4d5;";
    return `<tr><td class="d-line" style="padding:9px 0; ${border}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle" width="92" class="d-faint" style="width:92px; font-family:${DISPLAY}; font-weight:700; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#9b9184;">${esc(r.date)}</td>
          <td valign="middle" class="d-ink" style="font-family:${BODY}; font-size:13px; color:#17120a;">${esc(r.matchup)} &middot; ${esc(r.time)}${r.broadcast ? ` &middot; ${esc(r.broadcast)}` : ""}</td>
        </tr></table>
      </td></tr>`;
  }).join("");
}

export function buildEmailHtml(data) {
  const meta = data.meta ?? {};
  const record = data.record ?? {};
  const hero = data.hero ?? {};
  const gs = data.sections?.game_status?.content ?? {};
  const standings = data.sections?.standings?.content?.teams ?? [];
  const injuries = data.sections?.injury_report?.content?.il_entries ?? [];
  const nextGame = data.next_game ?? {};
  const upNext = data.sections?.preview?.content?.up_next ?? [];
  const issueUrl = meta.canonical_url || `${SITE}/issues/${meta.date}/`;

  const weather = gs.weather ?? {};
  const parkBits = [`${esc(weather.temp_f)}&deg; &middot; ${esc(weather.condition)} &middot; gusts ${esc(weather.gusts_mph)} mph`];
  if (gs.venue_is_home && gs.transit) {
    parkBits.push(`SEPTA: ${esc(gs.transit)}`);
  }
  const broadcast = gs.broadcast ?? {};
  const watchListen = [broadcast.tv, broadcast.radio].filter(Boolean).map(esc).join(" · ");

  // Up Next: lead card uses next_game (real team matchup); the smaller rows
  // use the remaining scheduled games.
  const moreRows = upNext.length > 1 ? upNext.slice(1) : [];

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${esc(meta.publication)} &middot; ${esc(gs.matchup || hero.headline)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  td { mso-line-height-rule:exactly; }
  img { border:0; outline:none; line-height:100%; -ms-interpolation-mode:bicubic; display:block; }
  a { text-decoration:none; }
  .pw-cta:hover { background:#c8001f !important; }
  .pw-link:hover { color:#a8001a !important; }
  @media (prefers-color-scheme: dark) {
    .d-page{background:#070a15!important;} .d-card{background:#121a34!important;} .d-card2{background:#1a2444!important;}
    .d-ink{color:#eef1f8!important;} .d-dim{color:#99a3c4!important;} .d-faint{color:#6c779c!important;}
    .d-line{border-color:#28335c!important;} .d-edge{border-color:#28335c!important;} .d-navytext{color:#9ec0ff!important;}
    .d-navband{background:#06112e!important;} .d-phirow{background:#2a1020!important;} .d-phitext{color:#f6a8b0!important;}
    .d-il{background:#3d1010!important;color:#f6a8b0!important;} .d-capcard{background:#1a2444!important;} .d-footer{background:#04102e!important;}
  }
  [data-ogsc] .d-page{background:#070a15!important;} [data-ogsc] .d-card{background:#121a34!important;}
  [data-ogsc] .d-card2{background:#1a2444!important;} [data-ogsc] .d-ink{color:#eef1f8!important;}
  [data-ogsc] .d-dim{color:#99a3c4!important;} [data-ogsc] .d-navytext{color:#9ec0ff!important;}
  [data-ogsc] .d-line{border-color:#28335c!important;} [data-ogsc] .d-phirow{background:#2a1020!important;}
  @media screen and (max-width:620px) {
    .pw-container { width:100% !important; }
    .pw-px { padding-left:20px !important; padding-right:20px !important; }
    .pw-h1 { font-size:42px !important; line-height:0.96 !important; }
    .sb-stack { display:block !important; width:100% !important; box-sizing:border-box !important; padding:0 0 8px 0 !important; }
    .mu-side { padding-left:16px !important; padding-right:16px !important; }
  }
</style>
</head>
<body class="d-page" style="margin:0; padding:0; background:#e7e0d3;">

<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#e7e0d3; opacity:0;">
  ${esc(hero.dek || hero.summary || "Tonight's Phillies Wire.")} &mdash; standings, injuries, and what's next. Ring the bell.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="d-page" bgcolor="#e7e0d3" style="background:#e7e0d3;">
<tr><td align="center" style="padding:22px 12px 30px;">

<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="pw-container" style="width:600px; max-width:600px;">
<tr>
  <td align="left" style="font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#9a8f7c; padding:0 4px 8px;">${esc(meta.publication)} &middot; The Pregame Wire</td>
  <td align="right" style="font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.10em; text-transform:uppercase; padding:0 4px 8px;"><a class="pw-link" href="${esc(issueUrl)}" style="color:#9a8f7c;">View in browser &#8594;</a></td>
</tr>
</table>

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="pw-container d-card d-edge" bgcolor="#fff9f0" style="width:600px; max-width:600px; background:#fff9f0; border:1px solid #ded6c6;">

  <!-- masthead -->
  <tr><td class="d-navband" bgcolor="#002d72" style="background:#002d72; background-image:repeating-linear-gradient(90deg, rgba(255,255,255,0) 0, rgba(255,255,255,0) 5px, rgba(255,255,255,0.05) 5px, rgba(255,255,255,0.05) 6px);">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="pw-px" style="padding:22px 28px 20px; border-bottom:3px solid #c4973a;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle">
            <div style="font-family:${DISPLAY}; font-weight:800; font-size:33px; line-height:0.94; letter-spacing:0.01em; text-transform:uppercase; color:#ffffff;">${esc(meta.publication)}</div>
            <div style="font-family:${DISPLAY}; font-weight:600; font-size:11px; line-height:1; letter-spacing:0.18em; text-transform:uppercase; color:#d4ac58; padding-top:5px;">Vol. ${esc(meta.volume)} &middot; No. ${esc(meta.edition)} &middot; ${longDate(meta.date)}</div>
          </td>
          <td valign="middle" align="right" width="78" style="width:78px;">
            <table role="presentation" align="right" cellpadding="0" cellspacing="0" border="0" bgcolor="#e81828" style="background:#e81828; border:1px solid #f06472; border-radius:4px;"><tr><td align="center" style="padding:6px 12px;">
              <div style="font-family:${DISPLAY}; font-weight:800; font-size:22px; line-height:1; color:#ffffff;">${esc(record.wins)}&#8211;${esc(record.losses)}</div>
              <div style="font-family:${DISPLAY}; font-weight:700; font-size:9px; line-height:1; letter-spacing:0.16em; color:#ffd2d7; padding-top:3px;">SEASON</div>
            </td></tr></table>
          </td>
        </tr></table>
      </td>
    </tr></table>
  </td></tr>

  <!-- gazette dateline -->
  <tr><td class="d-navband" bgcolor="#002d72" style="background:#002d72; padding:9px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-bottom:1px solid #7a5f2c;">&nbsp;</td>
      <td align="center" style="white-space:nowrap; padding:0 12px; font-family:${DISPLAY}; font-weight:600; font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:rgba(255,255,255,0.82);">
        <span style="color:#d4ac58;">Philadelphia, Pennsylvania</span> &nbsp;<span style="color:#c4973a;">&#9670;</span>&nbsp; Est. 2026 &nbsp;<span style="color:#c4973a;">&#9670;</span>&nbsp; Ring the Bell
      </td>
      <td style="border-bottom:1px solid #7a5f2c;">&nbsp;</td>
    </tr></table>
  </td></tr>

  <!-- edition status -->
  <tr><td class="pw-px d-card" bgcolor="#fff9f0" style="background:#fff9f0; padding:13px 28px; border-bottom:1px solid #ece4d5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle">
        <span style="display:inline-block; background:#e81828; color:#ffffff; font-family:${DISPLAY}; font-weight:800; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; padding:3px 9px; border-radius:3px;">${esc(meta.status?.mode_label || "Pregame")}</span>
        <span class="d-dim" style="font-family:${BODY}; font-size:12px; color:#8a8173; padding-left:9px;">${esc(meta.status?.enrich_label || "")}</span>
      </td>
      <td valign="middle" align="right" class="d-dim" style="font-family:${BODY}; font-size:12px; color:#8a8173;">${esc(meta.status?.generated_at_et || "")}</td>
    </tr></table>
  </td></tr>

  <!-- hero -->
  <tr><td class="pw-px d-card" bgcolor="#fff9f0" style="background:#fff9f0; padding:26px 28px 6px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="padding-right:9px;"><div style="width:22px; height:3px; background:#e81828; font-size:0; line-height:0;">&nbsp;</div></td>
      <td valign="middle" style="font-family:${DISPLAY}; font-weight:700; font-size:13px; letter-spacing:0.16em; text-transform:uppercase; color:#e81828;">${esc(hero.label)}</td>
    </tr></table>
    <div class="pw-h1 d-navytext" style="font-family:${DISPLAY}; font-weight:800; font-size:50px; line-height:0.95; letter-spacing:-0.01em; text-transform:uppercase; color:#002d72; padding-top:10px;">${esc(hero.headline)}</div>
    <div class="d-ink" style="font-family:${DISPLAY}; font-weight:700; font-size:25px; line-height:1.04; color:#17120a; padding-top:9px;">${esc(hero.dek)}</div>
    <div class="d-dim" style="font-family:${BODY}; font-size:14px; line-height:1.55; color:#5c5446; padding-top:11px; max-width:480px;">${esc(hero.summary)}</div>
  </td></tr>

  ${taleOfTheTape(gs.matchup_tape)}

  ${sectionHeader("01", "Game Info")}
  <tr><td class="pw-px d-card" bgcolor="#fff9f0" style="background:#fff9f0; padding:13px 28px 2px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="sb-stack" valign="top" width="33%" style="width:33%; padding-right:7px;">${infoCard("#e81828", "First Pitch", esc(gs.first_pitch))}</td>
      <td class="sb-stack" valign="top" width="34%" style="width:34%; padding:0 4px;">${infoCard("#002d72", "Venue", esc(gs.venue))}</td>
      <td class="sb-stack" valign="top" width="33%" style="width:33%; padding-left:7px;">${infoCard("#c4973a", "Watch &middot; Listen", watchListen || "TBD")}</td>
    </tr></table>
  </td></tr>
  <tr><td class="pw-px d-card" bgcolor="#fff9f0" style="background:#fff9f0; padding:9px 28px 2px;">
    <div class="d-dim" style="font-family:${BODY}; font-size:12.5px; line-height:1.55; color:#6b6354;"><strong class="d-ink" style="color:#17120a; font-weight:700;">Park notes &mdash;</strong> ${parkBits.join(". ")}.</div>
  </td></tr>

  ${sectionHeader("02", "NL East")}
  <tr><td class="pw-px d-card" bgcolor="#fff9f0" style="background:#fff9f0; padding:12px 28px 2px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="d-card2 d-edge" bgcolor="#ffffff" style="background:#ffffff; border:1px solid #e7e0d2;">
      <tr class="d-navband" bgcolor="#002d72" style="background:#002d72;">
        <th align="left" style="padding:7px 14px; font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.10em; text-transform:uppercase; color:#ffffff;">Team</th>
        <th align="center" style="padding:7px 6px; font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#ffffff;">W</th>
        <th align="center" style="padding:7px 6px; font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#ffffff;">L</th>
        <th align="center" style="padding:7px 6px; font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#ffffff;">Pct</th>
        <th align="center" style="padding:7px 6px; font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#ffffff;">GB</th>
        <th align="center" style="padding:7px 14px 7px 6px; font-family:${DISPLAY}; font-weight:700; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#ffffff;">Strk</th>
      </tr>
      ${standingsRows(standings)}
    </table>
  </td></tr>

  ${sectionHeader("03", "Injury Report")}
  <tr><td class="pw-px d-card" bgcolor="#fff9f0" style="background:#fff9f0; padding:8px 28px 2px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${injuryRows(injuries)}</table>
  </td></tr>

  ${sectionHeader("04", "Up Next")}
  <tr><td class="pw-px d-card" bgcolor="#fff9f0" style="background:#fff9f0; padding:12px 28px 2px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="d-navband" bgcolor="#002d72" style="background:#002d72;"><tr><td style="padding:14px 16px;">
      <div style="font-family:${DISPLAY}; font-weight:700; font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:#d4ac58;">${esc(nextGame.label)} &middot; ${esc(nextGame.date)}</div>
      <div style="font-family:${DISPLAY}; font-weight:800; font-size:21px; line-height:1.06; color:#ffffff; padding-top:3px;">${esc(nextGame.matchup)}</div>
      <div style="font-family:${BODY}; font-size:12.5px; color:#aebbe0; padding-top:5px;">${esc(nextGame.time)}${nextGame.broadcast ? ` &middot; ${esc(nextGame.broadcast)}` : ""}${nextGame.venue ? ` &middot; ${esc(nextGame.venue)}` : ""}</div>
    </td></tr></table>
  </td></tr>
  ${moreRows.length ? `<tr><td class="pw-px d-card" bgcolor="#fff9f0" style="background:#fff9f0; padding:6px 28px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${upNextRows(moreRows)}</table>
  </td></tr>` : ""}

  <!-- CTA -->
  <tr><td class="d-navband" bgcolor="#002d72" align="center" style="background:#002d72; padding:30px 28px 32px; border-top:3px solid #c4973a;">
    <div style="font-family:${DISPLAY}; font-weight:800; font-size:30px; line-height:1; letter-spacing:0.01em; text-transform:uppercase; color:#ffffff;">Ring the Bell</div>
    <div style="font-family:${BODY}; font-size:13.5px; line-height:1.55; color:#aebbe0; padding:9px 0 20px; max-width:380px; margin:0 auto;">Live box score, confirmed lineups, and park updates the moment they post &mdash; open tonight's full issue.</div>
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(issueUrl)}" style="height:46px;v-text-anchor:middle;width:230px;" arcsize="11%" strokecolor="#e81828" fillcolor="#e81828">
    <w:anchorlock/>
    <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;letter-spacing:1px;">RING THE BELL &#8594;</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <a class="pw-cta" href="${esc(issueUrl)}" style="display:inline-block; background:#e81828; color:#ffffff; font-family:${DISPLAY}; font-weight:800; font-size:16px; letter-spacing:0.10em; text-transform:uppercase; padding:13px 32px; border-radius:5px;">Ring the Bell &#8594;</a>
    <!--<![endif]-->
  </td></tr>

  <!-- footer -->
  <tr><td class="d-footer" bgcolor="#001440" style="background:#001440; padding:24px 28px 26px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" style="padding-bottom:4px;">
        <div style="font-family:${DISPLAY}; font-weight:800; font-size:19px; letter-spacing:0.04em; text-transform:uppercase; color:#ffffff;">${esc(meta.publication)}</div>
        <div style="font-family:${DISPLAY}; font-weight:700; font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:#c4973a; padding-top:5px;">Ring the Bell &middot; Est. 2026</div>
      </td></tr>
      <tr><td align="center" style="padding:12px 0 12px;"><div style="border-top:3px double rgba(255,255,255,0.18); width:60%; margin:0 auto; font-size:0; line-height:0;">&nbsp;</div></td></tr>
      <tr><td align="center" style="font-family:${BODY}; font-size:11.5px; line-height:1.5; color:#8aa0c8;">Vol. ${esc(meta.volume)} &middot; No. ${esc(meta.edition)} &middot; ${esc(meta.date)} &middot; ${esc(meta.status?.enrich_label || "")}</td></tr>
      <tr><td align="center" style="padding:10px 0 0; font-family:${DISPLAY}; font-weight:600; font-size:12px; letter-spacing:0.10em; text-transform:uppercase;">
        <a class="pw-link" href="${esc(issueUrl)}" style="color:#d4ac58;">View online</a>
        <span style="color:#3a5286;">&nbsp;&middot;&nbsp;</span>
        <a class="pw-link" href="${SITE}/archive/" style="color:#d4ac58;">Archive</a>
      </td></tr>
      <tr><td align="center" style="padding:14px 0 0; font-family:${BODY}; font-size:11px; line-height:1.55; color:#5e76a6;">Phillies Wire &middot; Citizens Bank Park &middot; Philadelphia, PA 19148</td></tr>
    </table>
  </td></tr>

</table>

<!--[if mso]></td></tr></table><![endif]-->

</td></tr>
</table>

</body>
</html>`;
}
