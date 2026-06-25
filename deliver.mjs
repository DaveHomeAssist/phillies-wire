import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DATA_FILE = "./phillies-wire-data.json";
const SITE_DELIVERY_STATUS_FILE = "./site/delivery-status.json";

// Brand palette (concrete hex — email clients do not resolve CSS custom
// properties, so every color is a literal). Mirrors tokens.css. Declared
// before the run guard below: when deliver.mjs is run directly, main()
// executes during module evaluation and calls buildEmailHtml synchronously,
// so these must be initialized first (a const after the guard would TDZ).
const EMAIL = {
  red: "#e81828",
  navy: "#002d72",
  cream: "#fff9f0",
  paper: "#ffffff",
  ink: "#1a1a1a",
  muted: "#6b7280",
  line: "#e3d9c6",
  gold: "#a87010",
};
const SITE_URL = "https://davehomeassist.github.io/phillies-wire/";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(redactSmtp(error.message));
    process.exit(1);
  });
}

function redactSmtp(message) {
  if (!message) {
    return message;
  }
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  let redacted = String(message);
  if (user) {
    redacted = redacted.split(user).join("[smtp_user]");
  }
  if (pass) {
    redacted = redacted.split(pass).join("[smtp_pass]");
  }
  return redacted;
}

export async function main({ createTransportImpl = null } = {}) {
  const recipients = process.env.DELIVERY_RECIPIENTS;
  if (!recipients) {
    console.log("DELIVERY_RECIPIENTS not set — skipping delivery.");
    writeDeliveryStatus({ state: "sent", required: false });
    return;
  }

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    console.error("SMTP_USER and SMTP_PASS are required for delivery; skipping delivery.");
    writeDeliveryStatus({ state: "failed", required: true });
    return;
  }

  const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  // Build a dedicated, inline-styled email document from the issue data.
  // We deliberately do NOT email the rendered site page: mail clients
  // (notably the Gmail app) strip <style> blocks, so the var()-driven,
  // class-based site CSS collapses to unstyled text — and the page also
  // carries site-only chrome (skip link, nav, the scrolling-ticker marquee
  // duplicated for animation, JS preloads). Inline styles on a purpose-built
  // document are the only thing those clients reliably honor.
  const emailHtml = buildEmailHtml(data);

  const subject = `${data.meta.publication} · ${data.meta.date} · PHI ${data.record.wins}-${data.record.losses}`;
  const plainText = buildPlainText(data);

  const smtpPort = Number(process.env.SMTP_PORT ?? 587);
  const makeTransport = createTransportImpl ?? (await import("nodemailer")).createTransport;
  const transport = makeTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: smtpPort,
    secure: smtpPort === 465,
    requireTLS: true,
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: Number(process.env.SMTP_TIMEOUT_MS ?? 10000),
    greetingTimeout: Number(process.env.SMTP_TIMEOUT_MS ?? 10000),
    socketTimeout: Number(process.env.SMTP_TIMEOUT_MS ?? 10000),
    tls: {
      minVersion: "TLSv1.2",
    },
  });

  const delivery = await sendDelivery(transport, {
    from: `"${data.meta.publication}" <${smtpUser}>`,
    to: recipients,
    subject,
    text: plainText,
    html: emailHtml,
  });
  writeDeliveryStatus({
    state: delivery.delivered === 0 ? "failed" : delivery.failed > 0 ? "partial" : "sent",
    required: true,
    delivered: delivery.delivered,
    failed: delivery.failed,
  });
  if (delivery.delivered === 0) {
    return;
  }

  // Log the count, not the list. Action logs are retained and emails
  // are PII — a recipient list dumped to stdout ends up searchable in
  // CI history indefinitely.
  const count = delivery.delivered;
  console.log(`Delivered to ${count} recipient${count === 1 ? "" : "s"}`);
}

export function writeDeliveryStatus(status = {}) {
  const state = ["sent", "partial", "failed"].includes(status.state) ? status.state : "failed";
  const payload = {
    schema_version: "delivery-1.0.0",
    generated_at: new Date().toISOString(),
    state,
    required: Boolean(status.required),
    delivered: Number(status.delivered ?? 0),
    failed: Number(status.failed ?? 0),
  };
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync("./delivery-status.json", text, "utf8");
  if (existsSync("./site")) {
    writeFileSync(SITE_DELIVERY_STATUS_FILE, text, "utf8");
  }
  return payload;
}

export async function sendDelivery(transport, message, { retries = 1 } = {}) {
  try {
    await transport.verify();
  } catch (error) {
    // Some SMTP servers block VRFY / EHLO introspection even when
    // the underlying connection works for sendMail. Log the warning
    // so it surfaces in CI and move on.
    console.warn(`SMTP verification warning: ${redactSmtp(error.message)}`);
  }

  const recipients = parseRecipients(message.to);
  let delivered = 0;
  let failed = 0;
  try {
    for (const [index, recipient] of recipients.entries()) {
      const ok = await sendOneRecipient(transport, { ...message, to: recipient }, { retries, index });
      if (ok) {
        delivered += 1;
      } else {
        failed += 1;
      }
    }
    return { delivered, failed };
  } finally {
    transport.close?.();
  }
}

function parseRecipients(value) {
  return String(value ?? "")
    .split(",")
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

async function sendOneRecipient(transport, message, { retries, index }) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await transport.sendMail(message);
      return true;
    } catch (error) {
      if (attempt < retries) {
        console.warn(`SMTP delivery warning for recipient #${index + 1}, retrying: ${redactSmtp(error.message)}`);
        continue;
      }
      console.error(`SMTP delivery failed for recipient #${index + 1}: ${redactSmtp(error.message)}`);
      return false;
    }
  }
  return false;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isFilled(value) {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function handLabel(hand) {
  if (hand === "L") return "LHP";
  if (hand === "R") return "RHP";
  return "";
}

function starterLabel(starter) {
  if (!starter || !isFilled(starter.name) || starter.name === "TBD") {
    return "TBD";
  }
  const hand = handLabel(starter.hand);
  return hand ? `${starter.name} (${hand})` : String(starter.name);
}

// Build a dedicated, inline-styled HTML email from the issue data. Every
// element carries a `style="..."` attribute (no <style> block, no var()) so
// it renders consistently in clients that strip embedded styles — Gmail app,
// Outlook, Apple Mail. Layout is a single centered table, the email standard.
export function buildEmailHtml(data) {
  const meta = data.meta ?? {};
  const record = data.record ?? {};
  const sections = data.sections ?? {};
  const gameStatus = sections.game_status?.content ?? {};
  const preview = sections.preview?.content ?? {};
  const recap = sections.recap ?? {};
  const recapContent = recap.content ?? {};
  const nextGame = data.next_game ?? {};

  const publication = isFilled(meta.publication) ? meta.publication : "Phillies Wire";
  const editionBits = [
    meta.volume != null ? `Vol. ${esc(meta.volume)}` : null,
    meta.edition != null ? `No. ${esc(meta.edition)}` : null,
    isFilled(meta.date) ? esc(meta.date) : null,
  ].filter(Boolean);

  const recordParts = [
    `PHI ${esc(record.wins ?? 0)}-${esc(record.losses ?? 0)}`,
    isFilled(record.streak) ? esc(record.streak) : null,
    record.division_rank ? `${esc(ordinal(record.division_rank))} ${esc(record.division ?? "")}`.trim() : null,
  ].filter(Boolean);

  const blocks = [];

  if (meta.off_day) {
    blocks.push(emailParagraph("No game on the schedule today."));
    blocks.push(nextGameBlock(nextGame));
  } else {
    // Matchup / dek
    const headline = isFilled(gameStatus.matchup) ? gameStatus.matchup : data.hero?.headline;
    if (isFilled(headline)) {
      blocks.push(sectionHeading(headline));
    }
    if (isFilled(data.hero?.dek)) {
      blocks.push(emailParagraph(data.hero.dek, EMAIL.muted));
    }

    // Tale of the Tape (starting pitchers)
    const phi = starterLabel(gameStatus.starters?.phi);
    const opp = starterLabel(gameStatus.starters?.opp);
    if (phi !== "TBD" || opp !== "TBD") {
      blocks.push(taleOfTheTape(phi, opp));
    }

    // Game detail rows
    const details = [
      ["First pitch", gameStatus.first_pitch],
      ["Venue", gameStatus.venue],
      ["TV", gameStatus.broadcast?.tv],
      ["Radio", gameStatus.broadcast?.radio],
      ["Weather", buildWeather(gameStatus.weather)],
      ["Series", gameStatus.series?.label],
    ].filter(([, v]) => isFilled(v) && String(v).trim().toUpperCase() !== "TBD");
    if (details.length) {
      blocks.push(detailTable(details));
    }

    // Preview narrative
    const narrative = Array.isArray(preview.narrative) ? preview.narrative.filter(isFilled) : [];
    for (const paragraph of narrative) {
      blocks.push(emailParagraph(paragraph));
    }
    if (isFilled(preview.pull_quote)) {
      blocks.push(pullQuote(preview.pull_quote));
    }

    // Recap (only when a final exists)
    if (recap.show) {
      if (isFilled(recapContent.result?.summary_line)) {
        blocks.push(emailParagraph(recapContent.result.summary_line));
      }
      if (isFilled(recapContent.pull_quote)) {
        blocks.push(pullQuote(recapContent.pull_quote));
      }
    }

    blocks.push(nextGameBlock(nextGame));
  }

  const editionLine = editionBits.join(" &middot; ");
  const recordLine = recordParts.join(" &middot; ");
  const modeLabel = isFilled(meta.status?.mode_label) ? esc(meta.status.mode_label) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>${esc(publication)}</title>
</head>
<body style="margin:0; padding:0; background:${EMAIL.cream}; -webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL.cream};">
<tr><td align="center" style="padding:20px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:100%; background:${EMAIL.paper}; border:1px solid ${EMAIL.line};">
  <tr>
    <td style="background:${EMAIL.red}; padding:22px 28px;">
      <div style="font-family:Georgia,'Times New Roman',serif; font-size:30px; line-height:1.1; font-weight:700; letter-spacing:0.5px; color:#ffffff;">${esc(publication)}</div>
      ${editionLine ? `<div style="font-family:Georgia,serif; font-size:13px; color:#ffe2e5; margin-top:6px; letter-spacing:0.4px;">${editionLine}</div>` : ""}
    </td>
  </tr>
  <tr>
    <td style="background:${EMAIL.navy}; padding:12px 28px; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:700; color:#ffffff; letter-spacing:0.5px;">
      ${recordLine}${modeLabel ? ` <span style="color:#c0d4f0; font-weight:400;">&middot; ${modeLabel}</span>` : ""}
    </td>
  </tr>
  <tr>
    <td style="padding:24px 28px; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:1.55; color:${EMAIL.ink};">
      ${blocks.join("\n      ")}
    </td>
  </tr>
  <tr>
    <td style="background:${EMAIL.navy}; padding:18px 28px; text-align:center; font-family:Georgia,serif; font-size:13px; color:#c0d4f0;">
      <div style="color:${EMAIL.gold}; font-weight:700; letter-spacing:1px; text-transform:uppercase; font-size:12px;">Ring the Bell</div>
      <div style="margin-top:8px;"><a href="${SITE_URL}" style="color:#ffffff; text-decoration:underline;">Read this issue online</a></div>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  switch (num % 10) {
    case 1: return `${num}st`;
    case 2: return `${num}nd`;
    case 3: return `${num}rd`;
    default: return `${num}th`;
  }
}

function buildWeather(weather) {
  if (!weather) return "";
  const parts = [];
  if (isFilled(weather.temp_f)) parts.push(`${esc(weather.temp_f)}°`);
  if (isFilled(weather.condition) && weather.condition !== "Weather unavailable") parts.push(esc(weather.condition));
  if (isFilled(weather.gusts_mph) && Number(weather.gusts_mph) > 0) parts.push(`gusts ${esc(weather.gusts_mph)} mph`);
  return parts.join(" · ");
}

function sectionHeading(text) {
  return `<h1 style="margin:0 0 12px; font-family:Georgia,serif; font-size:22px; line-height:1.25; font-weight:700; color:${EMAIL.navy};">${esc(text)}</h1>`;
}

function emailParagraph(text, color = EMAIL.ink) {
  return `<p style="margin:0 0 14px; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:1.55; color:${color};">${esc(text)}</p>`;
}

function taleOfTheTape(phi, opp) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px; border-top:2px solid ${EMAIL.red}; border-bottom:2px solid ${EMAIL.red};">
        <tr>
          <td width="50%" style="padding:12px 10px; font-family:Arial,Helvetica,sans-serif; vertical-align:top;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:${EMAIL.red}; font-weight:700;">Phillies</div>
            <div style="font-size:16px; color:${EMAIL.ink}; margin-top:4px; font-weight:700;">${esc(phi)}</div>
          </td>
          <td width="50%" style="padding:12px 10px; font-family:Arial,Helvetica,sans-serif; vertical-align:top; border-left:1px solid ${EMAIL.line};">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:${EMAIL.muted}; font-weight:700;">Opponent</div>
            <div style="font-size:16px; color:${EMAIL.ink}; margin-top:4px; font-weight:700;">${esc(opp)}</div>
          </td>
        </tr>
      </table>`;
}

function detailTable(rows) {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:6px 12px 6px 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:${EMAIL.muted}; text-transform:uppercase; letter-spacing:0.5px; white-space:nowrap; vertical-align:top;">${esc(label)}</td>
          <td style="padding:6px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; color:${EMAIL.ink}; vertical-align:top;">${esc(value)}</td>
        </tr>`,
    )
    .join("\n        ");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px; border-top:1px solid ${EMAIL.line};">
        ${body}
      </table>`;
}

function pullQuote(text) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;">
        <tr><td style="padding:8px 18px; border-left:4px solid ${EMAIL.gold}; font-family:Georgia,serif; font-style:italic; font-size:18px; line-height:1.4; color:${EMAIL.navy};">${esc(text)}</td></tr>
      </table>`;
}

function nextGameBlock(nextGame) {
  if (!nextGame || !isFilled(nextGame.matchup) || nextGame.matchup === "Schedule refresh required") {
    return "";
  }
  const meta = [nextGame.date, nextGame.time, nextGame.broadcast]
    .filter((v) => isFilled(v) && String(v).trim().toUpperCase() !== "TBD")
    .map(esc)
    .join(" · ");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0; background:${EMAIL.cream}; border:1px solid ${EMAIL.line};">
        <tr><td style="padding:14px 16px; font-family:Arial,Helvetica,sans-serif;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:${EMAIL.red}; font-weight:700;">${esc(nextGame.label ?? "Next Game")}</div>
          <div style="font-size:16px; color:${EMAIL.ink}; margin-top:4px; font-weight:700;">${esc(nextGame.matchup)}</div>
          ${meta ? `<div style="font-size:13px; color:${EMAIL.muted}; margin-top:4px;">${meta}</div>` : ""}
        </td></tr>
      </table>`;
}

function buildPlainText(data) {
  const lines = [
    `${data.meta.publication} — ${data.meta.date}`,
    `PHI ${data.record.wins}-${data.record.losses}`,
    "",
  ];

  if (data.meta.off_day) {
    lines.push("No game today.");
    if (data.next_game?.matchup) {
      lines.push(`Next game: ${data.next_game.matchup} — ${data.next_game.date} ${data.next_game.time}`);
    }
  } else {
    const narrative = data.sections?.preview?.content?.narrative ?? [];
    for (const paragraph of narrative) {
      lines.push(paragraph);
      lines.push("");
    }
  }

  return lines.join("\n");
}
