function isIdentifierStart(ch) {
  if (!ch) return false;
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_" || ch === "$";
}

function isIdentifierPart(ch) {
  if (!ch) return false;
  return isIdentifierStart(ch) || (ch >= "0" && ch <= "9");
}

function isPathPart(ch) {
  if (!ch) return false;
  return isIdentifierPart(ch) || ch === "." || ch === "$";
}

function isWhitespace(ch) {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
}

function isTokenBoundary(ch) {
  if (!ch) return true;
  return !isIdentifierPart(ch);
}

function tryConsumeSetAssignment(source, start) {
  if (!source.startsWith("set", start)) return null;

  const prev = start > 0 ? source[start - 1] : "";
  const nextAfterToken = source[start + 3] || "";
  if (!isTokenBoundary(prev) || !isTokenBoundary(nextAfterToken)) return null;

  let i = start + 3;
  while (i < source.length && isWhitespace(source[i])) i++;
  if (source[i] !== "(") return null;

  i++;
  while (i < source.length && isWhitespace(source[i])) i++;
  if (!isIdentifierStart(source[i])) return null;

  const idStart = i;
  i++;
  while (i < source.length && isPathPart(source[i])) i++;
  const keyPath = source.slice(idStart, i);

  while (i < source.length && isWhitespace(source[i])) i++;
  if (source[i] !== ":" || source[i + 1] !== "=") return null;

  return {
    replacement: `set('${keyPath}',`,
    nextIndex: i + 2,
  };
}

export function normalizeUnitsExpression(raw, options = {}) {
  const source = String(raw || "");
  const transformSetAssignment = options.transformSetAssignment === true;

  let out = "";
  let i = 0;
  let quote = null;
  let escaped = false;

  while (i < source.length) {
    const ch = source[i];

    if (quote) {
      out += ch;
      if (escaped) {
        escaped = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        i++;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i++;
      continue;
    }

    if (ch === "'" || ch === "\"" || ch === "`") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }

    if (transformSetAssignment) {
      const setAssign = tryConsumeSetAssignment(source, i);
      if (setAssign) {
        out += setAssign.replacement;
        i = setAssign.nextIndex;
        continue;
      }
    }

    if (ch === "@") {
      const next = source[i + 1];
      if (next === "(") {
        out += "(";
        i += 2;
        continue;
      }
      if (isIdentifierStart(next)) {
        let j = i + 2;
        while (j < source.length && isPathPart(source[j])) j++;
        out += source.slice(i + 1, j);
        i = j;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}
