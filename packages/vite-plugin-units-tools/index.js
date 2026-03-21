import fs from "node:fs";
import path from "node:path";
import { formatUnits } from "@botfather/units/print";

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

function estimatePromptTokens(source) {
  const text = String(source ?? "").trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

function parseToolQuery(id) {
  const text = String(id || "");
  const qidx = text.indexOf("?");
  if (qidx === -1) return null;

  const file = text.slice(0, qidx);
  const queryRaw = text.slice(qidx + 1);
  if (!file.endsWith(".ui")) return null;

  const params = new URLSearchParams(queryRaw);
  const first = [...params.keys()][0] || "";
  const kind = String(first || "").toLowerCase();
  if (!["format", "tokens", "highlight", "agent"].includes(kind)) return null;

  return {
    file,
    kind,
    params,
  };
}

export default function unitsTools(options = {}) {
  const include = options.include;
  const exclude = options.exclude;
  const classPrefix = options.classPrefix || "";
  const loadCache = new Map();

  function isRelOrAbs(id) {
    return id.startsWith(".") || id.startsWith("/");
  }

  function isAllowed(id) {
    if (!id.endsWith(".ui")) return false;
    if (include && !include.test(id)) return false;
    if (exclude && exclude.test(id)) return false;
    return true;
  }

  function getFileEntry(file) {
    const stat = fs.statSync(file);
    const cached = loadCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached;
    const fresh = {
      mtimeMs: stat.mtimeMs,
      code: fs.readFileSync(file, "utf-8"),
      formatted: null,
      tokens: null,
      highlighted: null,
    };
    loadCache.set(file, fresh);
    return fresh;
  }

  return {
    name: "units-tools",
    enforce: "pre",
    async resolveId(source, importer) {
      const parsed = parseToolQuery(source);
      if (!parsed) return null;
      const base = parsed.file;
      if (isRelOrAbs(base)) {
        const resolved = importer ? path.resolve(path.dirname(importer), base) : path.resolve(base);
        return resolved + source.slice(base.length);
      }
      const resolved = await this.resolve(base, importer, { skipSelf: true });
      if (!resolved) return null;
      return resolved.id + source.slice(base.length);
    },
    load(id) {
      const parsed = parseToolQuery(id);
      if (!parsed) return null;

      const file = parsed.file;
      const kind = parsed.kind;
      const params = parsed.params;
      if (!isAllowed(file)) return null;

      const entry = getFileEntry(file);
      const code = entry.code;

      if (kind === "format") {
        if (entry.formatted == null) entry.formatted = formatUnits(code);
        return `export default ${JSON.stringify(entry.formatted)};\n`;
      }
      if (kind === "tokens") {
        if (!entry.tokens) entry.tokens = tokenizeUnits(code);
        return `export default ${JSON.stringify(entry.tokens)};\n`;
      }
      if (kind === "highlight") {
        if (!entry.tokens) entry.tokens = tokenizeUnits(code);
        if (entry.highlighted == null) entry.highlighted = highlightTokens(entry.tokens, classPrefix);
        return `export default ${JSON.stringify(entry.highlighted)};\n`;
      }
      if (kind === "agent") {
        if (entry.formatted == null) entry.formatted = formatUnits(code);
        const dsl = entry.formatted;
        const target = String(params.get("target") || options.agentTarget || "chat").toLowerCase();
        const sourceTokenEstimate = estimatePromptTokens(code);
        const tokenEstimate = estimatePromptTokens(dsl);
        const tokenReduction = sourceTokenEstimate > 0
          ? (sourceTokenEstimate - tokenEstimate) / sourceTokenEstimate
          : 0;

        const payload = {
          dsl,
          target,
          sourceTokenEstimate,
          tokenEstimate,
          tokenReduction,
        };

        return `export default ${JSON.stringify(payload)};\n`;
      }
      return null;
    },
  };
}
