import { readFileSync, writeFileSync } from "node:fs";

const data = JSON.parse(readFileSync("./phillies-wire-data.json", "utf8"));
const template = readFileSync("./phillies-wire-v2.html", "utf8");

const output = populate(template, data);
writeFileSync("./phillies-wire-output.html", output, "utf8");
console.log("phillies-wire-output.html written");

export function populate(templateString, dataRoot) {
  return renderTemplate(templateString, dataRoot, dataRoot);
}

function renderTemplate(templateString, scope, root) {
  let output = templateString;
  output = renderBlocks(output, "each", scope, root, (path, inner, currentScope, currentRoot) => {
    const value = resolvePath(path, currentScope, currentRoot);
    if (!Array.isArray(value)) {
      return "";
    }

    return value.map((item) => renderTemplate(inner, item, currentRoot)).join("");
  });
  output = renderBlocks(output, "if", scope, root, (path, inner, currentScope, currentRoot) => {
    const value = resolvePath(path, currentScope, currentRoot);
    return value ? renderTemplate(inner, currentScope, currentRoot) : "";
  });

  return output.replace(/{{\s*([^#\/][^}]*)\s*}}/g, (_match, path) => {
    const value = resolvePath(path.trim(), scope, root);
    return escapeHtml(value == null ? "" : String(value));
  });
}

function renderBlocks(templateString, blockName, scope, root, replacer) {
  const pattern = new RegExp(`{{#${blockName}\\s+([^}]+)}}([\\s\\S]*?){{\\/${blockName}}}`, "g");
  let previous = "";
  let current = templateString;

  while (current !== previous) {
    previous = current;
    current = current.replace(pattern, (_match, path, inner) => replacer(path.trim(), inner, scope, root));
  }

  return current;
}

function resolvePath(path, scope, root) {
  if (path === "this") {
    return scope;
  }

  const base = path.startsWith("this.") ? scope : root;
  const trimmedPath = path.startsWith("this.") ? path.slice(5) : path;
  if (!trimmedPath) {
    return base;
  }

  return trimmedPath.split(".").reduce((current, segment) => current?.[segment], base);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
