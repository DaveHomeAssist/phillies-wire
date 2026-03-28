import { readFileSync } from "node:fs";

const html = readFileSync("./phillies-wire-output.html", "utf8");
const unresolved = html.match(/{{[^}]+}}/g) ?? [];

if (unresolved.length) {
  console.error(`Unresolved template tokens remain: ${unresolved.slice(0, 10).join(", ")}`);
  process.exit(1);
}

if (!/Phillies Wire/.test(html)) {
  console.error("Rendered HTML is missing the publication name.");
  process.exit(1);
}

console.log("Rendered HTML verified");
