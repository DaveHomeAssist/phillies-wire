import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const OUTPUT_FILE = "./phillies-wire-output.html";
const DATA_FILE = "./phillies-wire-data.json";
const CSS_FILES = ["./tokens.css", "./phillies-wire.css"];

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
    return;
  }

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    console.error("SMTP_USER and SMTP_PASS are required for delivery; skipping delivery.");
    return;
  }

  const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const rawHtml = readFileSync(OUTPUT_FILE, "utf8");
  const inlinedHtml = inlineStyles(rawHtml, CSS_FILES);

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
    html: inlinedHtml,
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

function inlineStyles(html, cssFiles) {
  let css = "";
  for (const file of cssFiles) {
    if (existsSync(file)) {
      css += readFileSync(file, "utf8") + "\n";
    }
  }

  // Strip external stylesheet links and inject inline <style> block
  let output = html.replace(/<link[^>]*rel="stylesheet"[^>]*>/gi, "");
  output = output.replace("</head>", `<style>\n${css}</style>\n</head>`);

  // Strip Google Fonts preconnect links — email clients ignore them
  output = output.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi, "");
  output = output.replace(/<link[^>]*fonts\.gstatic\.com[^>]*>/gi, "");

  return output;
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
