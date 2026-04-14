import { readFileSync, existsSync } from "node:fs";
import { createTransport } from "nodemailer";

const OUTPUT_FILE = "./phillies-wire-output.html";
const DATA_FILE = "./phillies-wire-data.json";
const CSS_FILES = ["./tokens.css", "./phillies-wire.css"];

main().catch((error) => {
  console.error(redactSmtp(error.message));
  process.exit(1);
});

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

async function main() {
  const recipients = process.env.DELIVERY_RECIPIENTS;
  if (!recipients) {
    console.log("DELIVERY_RECIPIENTS not set — skipping delivery.");
    process.exit(0);
  }

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    throw new Error("SMTP_USER and SMTP_PASS are required for delivery.");
  }

  const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const rawHtml = readFileSync(OUTPUT_FILE, "utf8");
  const inlinedHtml = inlineStyles(rawHtml, CSS_FILES);

  const subject = `${data.meta.publication} · ${data.meta.date} · PHI ${data.record.wins}-${data.record.losses}`;
  const plainText = buildPlainText(data);

  const smtpPort = Number(process.env.SMTP_PORT ?? 587);
  const transport = createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: smtpPort,
    secure: smtpPort === 465,
    requireTLS: true,
    auth: { user: smtpUser, pass: smtpPass },
    tls: {
      minVersion: "TLSv1.2",
    },
  });

  try {
    await transport.verify();
  } catch (error) {
    // Some SMTP servers block VRFY / EHLO introspection even when
    // the underlying connection works for sendMail. Log the warning
    // so it surfaces in CI and move on.
    console.warn(`SMTP verification warning: ${redactSmtp(error.message)}`);
  }

  await transport.sendMail({
    from: `"${data.meta.publication}" <${smtpUser}>`,
    to: recipients,
    subject,
    text: plainText,
    html: inlinedHtml,
  });

  console.log(`Delivered to ${recipients}`);
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
