import fs from "node:fs";
import path from "node:path";
import { formatUnits } from "./units-print.js";

function tokenizeUnits(input) {
  const s = String(input ?? "");
  const tokens = [];
  let i = 0;

  const isWS = (ch) => ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
  const isIdentStart = (ch) => (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
  const isIdent = (ch) => isIdentStart(ch) || (ch >= "0" && ch <= "9") || ch === ":" || ch === "." || ch === "-";

  while (i < s.length) {
    const ch = s[i];
    if (isWS(ch)) {
      let start = i;
      while (i < s.length && isWS(s[i])) i++;
      tokens.push({ type: "ws", value: s.slice(start, i) });
      continue;
    }
    if (ch === "/" && s[i + 1] === "/") {
      let start = i;
      i += 2;
      while (i < s.length && s[i] !== "\n") i++;
      tokens.push({ type: "comment", value: s.slice(start, i) });
      continue;
    }
    if (ch === "'") {
      let start = i++;
      while (i < s.length) {
        if (s[i] === "\\" && i + 1 < s.length) { i += 2; continue; }
        if (s[i] === "'") { i++; break; }
        i++;
      }
      tokens.push({ type: "string", value: s.slice(start, i) });
      continue;
    }
    if (ch === "#") {
      let start = i++;
      while (i < s.length && isIdent(s[i])) i++;
      tokens.push({ type: "directive", value: s.slice(start, i) });
      continue;
    }
    if (ch === "@") {
      let start = i++;
      while (i < s.length && /[A-Za-z0-9_.$]/.test(s[i])) i++;
      tokens.push({ type: "expr", value: s.slice(start, i) });
      continue;
    }
    if (isIdentStart(ch)) {
      let start = i++;
      while (i < s.length && isIdent(s[i])) i++;
      const value = s.slice(start, i);
      const type = value === "text" ? "keyword" : "ident";
      tokens.push({ type, value });
      continue;
    }
    if ((ch >= "0" && ch <= "9") || (ch === "-" && s[i + 1] >= "0" && s[i + 1] <= "9")) {
      let start = i++;
      while (i < s.length && /[0-9.]/.test(s[i])) i++;
      tokens.push({ type: "number", value: s.slice(start, i) });
      continue;
    }

    const punct = "(){}[],:=!?";
    if (punct.includes(ch)) {
      tokens.push({ type: "punct", value: ch });
      i++;
      continue;
    }

    tokens.push({ type: "unknown", value: ch });
    i++;
  }

  return tokens;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function highlightTokens(tokens, classPrefix) {
  const prefix = classPrefix ? `${classPrefix}-` : "";
  return tokens.map((t) => {
    const cls = `${prefix}tok-${t.type}`;
    return `<span class=\"${cls}\">${escapeHtml(t.value)}</span>`;
  }).join("");
}

export default function unitsTools(options = {}) {
  const include = options.include;
  const exclude = options.exclude;
  const classPrefix = options.classPrefix || "";

  function isAllowed(id) {
    if (!id.endsWith(".ui")) return false;
    if (include && !include.test(id)) return false;
    if (exclude && exclude.test(id)) return false;
    return true;
  }

  return {
    name: "units-tools",
    enforce: "pre",
    resolveId(source, importer) {
      if (source.endsWith(".ui?format") || source.endsWith(".ui?tokens") || source.endsWith(".ui?highlight")) {
        const base = source.replace(/\?.*$/, "");
        const resolved = importer ? path.resolve(path.dirname(importer), base) : path.resolve(base);
        return resolved + source.slice(base.length);
      }
      return null;
    },
    load(id) {
      if (id.endsWith(".ui?format")) {
        const file = id.replace(/\?.*$/, "");
        if (!isAllowed(file)) return null;
        const code = fs.readFileSync(file, "utf-8");
        const formatted = formatUnits(code);
        return `export default ${JSON.stringify(formatted)};\n`;
      }
      if (id.endsWith(".ui?tokens")) {
        const file = id.replace(/\?.*$/, "");
        if (!isAllowed(file)) return null;
        const code = fs.readFileSync(file, "utf-8");
        const tokens = tokenizeUnits(code);
        return `export default ${JSON.stringify(tokens)};\n`;
      }
      if (id.endsWith(".ui?highlight")) {
        const file = id.replace(/\?.*$/, "");
        if (!isAllowed(file)) return null;
        const code = fs.readFileSync(file, "utf-8");
        const tokens = tokenizeUnits(code);
        const html = highlightTokens(tokens, classPrefix);
        return `export default ${JSON.stringify(html)};\n`;
      }
      return null;
    },
  };
}
