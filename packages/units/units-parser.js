// Minimal, dependency-free parser for Units.
// Single-pass, O(n) over input size.

export function parseUnits(input) {
  const s = String(input ?? "");
  const len = s.length;
  let i = 0;

  function isWS(ch) {
    return ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
  }

  function isIdentStart(ch) {
    return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
  }

  function isIdent(ch) {
    return isIdentStart(ch) || (ch >= "0" && ch <= "9") || ch === ":" || ch === "." || ch === "-";
  }

  function skipWS() {
    while (i < len) {
      const ch = s[i];
      if (isWS(ch)) {
        i++;
        continue;
      }
      // line comments: //...
      if (ch === "/" && s[i + 1] === "/") {
        i += 2;
        while (i < len && s[i] !== "\n") i++;
        continue;
      }
      break;
    }
  }

  function error(msg) {
    const snippet = s.slice(Math.max(0, i - 20), Math.min(len, i + 20));
    throw new Error(`${msg} at ${i}: ...${snippet}...`);
  }

  function readIdent() {
    if (!isIdentStart(s[i])) error("Expected identifier");
    const start = i;
    i++;
    while (i < len && isIdent(s[i])) i++;
    return s.slice(start, i);
  }

  function isValueStart(ch, idx) {
    if (!ch) return false;
    if (ch === "'" || ch === "@" || ch === "{" || ch === "-" || (ch >= "0" && ch <= "9")) return true;
    if (s.startsWith("true", idx)) return true;
    if (s.startsWith("false", idx)) return true;
    if (s.startsWith("null", idx)) return true;
    return false;
  }

  function readPropKey() {
    if (!isIdentStart(s[i])) error("Expected identifier");
    const start = i;
    i++;
    while (i < len) {
      const ch = s[i];
      if (!isIdent(ch)) break;
      if (ch === ":") {
        // If ":" is followed by a value (after optional whitespace), treat as separator.
        let j = i + 1;
        while (j < len && isWS(s[j])) j++;
        if (isValueStart(s[j], j)) break;
      }
      i++;
    }
    return s.slice(start, i);
  }

  function readString() {
    if (s[i] !== "'") error("Expected string");
    i++; // skip '
    let out = "";
    while (i < len) {
      const ch = s[i];
      if (ch === "'") {
        i++;
        return out;
      }
      if (ch === "\\") {
        const next = s[i + 1];
        if (next === "'" || next === "\\") {
          out += next;
          i += 2;
          continue;
        }
      }
      out += ch;
      i++;
    }
    error("Unterminated string");
  }

  function readNumber() {
    const start = i;
    if (s[i] === "-") i++;
    while (i < len && s[i] >= "0" && s[i] <= "9") i++;
    if (s[i] === ".") {
      i++;
      while (i < len && s[i] >= "0" && s[i] <= "9") i++;
    }
    const raw = s.slice(start, i);
    const n = Number(raw);
    if (Number.isNaN(n)) error("Invalid number");
    return n;
  }

  function readExprUntil(delims) {
    // Read raw expression until encountering a delimiter (one of delims) at depth 0.
    // This keeps parsing fast and leaves expression semantics to runtime.
    let depthParen = 0;
    let depthBrack = 0;
    let depthBrace = 0;
    let hadParen = false;
    const start = i;
    while (i < len) {
      const ch = s[i];
      if (ch === "'" ) {
        // skip strings inside expressions
        i++; while (i < len && s[i] !== "'") {
          if (s[i] === "\\" && i + 1 < len) i += 2; else i++;
        }
        if (s[i] === "'") i++;
        continue;
      }
      if (ch === "(" ) {
        depthParen++;
        hadParen = true;
      } else if (ch === ")") {
        if (depthParen > 0) {
          depthParen--;
          if (depthParen === 0 && hadParen) {
            i++;
            continue;
          }
        }
      }
      else if (ch === "[") depthBrack++;
      else if (ch === "]") depthBrack = Math.max(0, depthBrack - 1);
      else if (ch === "{") depthBrace++;
      else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);

      if (depthParen === 0 && depthBrack === 0 && depthBrace === 0) {
        if (delims.includes(ch)) {
          if (ch === ")") {
            // If followed by chaining, treat ')' as part of the expression.
            let j = i + 1;
            while (j < len && isWS(s[j])) j++;
            const next = s[j];
            if (next === "." || next === "?" || next === "[" || next === "(") {
              i++;
              continue;
            }
          }
          break;
        }
      }
      i++;
    }
    return s.slice(start, i).trim();
  }

  function readBracedRaw() {
    if (s[i] !== "{") error("Expected '{' block");
    i++; // skip '{'
    const start = i;
    let depth = 1;
    while (i < len) {
      const ch = s[i];
      if (ch === "'") {
        i++; while (i < len && s[i] !== "'") {
          if (s[i] === "\\" && i + 1 < len) i += 2; else i++;
        }
        if (s[i] === "'") i++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) {
        const raw = s.slice(start, i).trim();
        i++; // consume '}'
        return raw;
      }
      i++;
    }
    error("Unterminated '{' block");
  }

  function parseValue() {
    skipWS();
    const ch = s[i];
    if (ch === "'") return { kind: "value", value: readString() };
    if (ch === "-" || (ch >= "0" && ch <= "9")) return { kind: "value", value: readNumber() };
    if (ch === "@") {
      i++;
      return { kind: "expr", expr: { raw: readExprUntil([",", ")", "}"]) } };
    }
    if (s.startsWith("true", i)) { i += 4; return { kind: "value", value: true }; }
    if (s.startsWith("false", i)) { i += 5; return { kind: "value", value: false }; }
    if (s.startsWith("null", i)) { i += 4; return { kind: "value", value: null }; }
    error("Unexpected value");
  }

  function parseProp(delims) {
    skipWS();
    const exprDelims = delims.includes(",") ? delims : [...delims, ","];
    if (s[i] === "!") {
      i++;
      const eventName = readIdent();
      skipWS();
      const body = readBracedRaw();
      return { kind: "event", key: eventName, expr: { raw: body } };
    }
    const key = readPropKey();
    skipWS();
    if (s[i] === "?" && s[i + 1] === "=") {
      i += 2;
      const raw = readExprUntil(exprDelims);
      return { kind: "bool", key, expr: { raw } };
    }
    if (s[i] === "=") {
      i++;
      skipWS();
      if (s[i] === "{" && key.startsWith("on:")) {
        const body = readBracedRaw();
        return { kind: "event", key, expr: { raw: body } };
      }
      const raw = readExprUntil(exprDelims);
      return { kind: "expr", key, expr: { raw } };
    }
    if (s[i] === ":") {
      i++;
      skipWS();
      if (s[i] === "{") {
        const body = readBracedRaw();
        return { kind: "event", key, expr: { raw: body } };
      }
      const val = parseValue();
      return { kind: val.kind, key, value: val.value, expr: val.expr };
    }
    // bare boolean true prop (present implies true)
    return { kind: "value", key, value: true };
  }

  function parsePropsInline(stopChars) {
    const props = [];
    while (i < len) {
      skipWS();
      if (i >= len) break;
      // DEBUG: uncomment to trace
      // console.log("parsePropsInline at", i, JSON.stringify(s.slice(i, i + 20)));
      const ch = s[i];
      if (stopChars.includes(ch)) break;
      // Props must start with an identifier or event shorthand.
      if (!(isIdentStart(ch) || ch === "!")) break;
      props.push(parseProp(stopChars));
      skipWS();
      if (s[i] === ",") i++;
    }
    return props;
  }

  function parsePropsParen() {
    if (s[i] !== "(") error("Expected '('");
    i++;
    const props = parsePropsInline([")"]);
    if (s[i] !== ")") error("Expected ')'");
    i++;
    return props;
  }

  function parseChildren() {
    if (s[i] !== "{") error("Expected '{'");
    i++;
    const children = [];
    while (i < len) {
      skipWS();
      if (s[i] === "}") { i++; break; }
      children.push(parseNode());
    }
    return children;
  }

  function parseDirective() {
    if (s[i] !== "#") error("Expected '#'");
    const start = i;
    i++;
    const name = readIdent();
    skipWS();
    let args = "";
    if (s[i] === "(") {
      i++;
      const start = i;
      let depth = 1;
      while (i < len && depth > 0) {
        const ch = s[i];
        if (ch === "'") {
          i++; while (i < len && s[i] !== "'") {
            if (s[i] === "\\" && i + 1 < len) i += 2; else i++;
          }
          if (s[i] === "'") i++;
          continue;
        }
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth === 0) break;
        i++;
      }
      args = s.slice(start, i).trim();
      if (s[i] === ")") i++;
    }
    skipWS();
    let children = [];
    if (s[i] === "{") children = parseChildren();
    return { type: "directive", name, args, children, start, end: i };
  }

  function parseTextNode() {
    const start = i;
    const ident = readIdent();
    if (ident !== "text") error("Unknown keyword");
    skipWS();
    const value = readString();
    return { type: "text", value, start, end: i };
  }

  function parseExprNode() {
    if (s[i] !== "@") error("Expected '@'");
    const start = i;
    i++;
    const raw = readExprUntil(["}", "\n"]);
    return { type: "expr", value: { raw }, start, end: i };
  }

  function parseTagNode() {
    const start = i;
    const name = readIdent();
    skipWS();
    let props = [];
    if (s[i] === "(") {
      props = parsePropsParen();
      skipWS();
    } else if (s[i] !== "{" && s[i] !== "}" && i < len) {
      // inline props until '{' or '}' or end
      props = parsePropsInline(["{", "}"]);
      skipWS();
    }
    let children = [];
    if (s[i] === "{") children = parseChildren();
    return { type: "tag", name, props, children, start, end: i };
  }

  function parseNode() {
    skipWS();
    const ch = s[i];
    if (ch === "#") return parseDirective();
    if (ch === "@") return parseExprNode();
    if (isIdentStart(ch)) {
      // 'text' keyword or tag
      const save = i;
      const ident = readIdent();
      i = save;
      if (ident === "text") return parseTextNode();
      return parseTagNode();
    }
    error("Unexpected token");
  }

  const body = [];
  while (i < len) {
    skipWS();
    if (i >= len) break;
    body.push(parseNode());
  }

  return { type: "document", body, start: 0, end: len };
}

export function parseUnitsOrThrow(input) {
  return parseUnits(input);
}
