// Units formatter used by the VS Code extension (CommonJS).
// This duplicates the parser + printer to avoid runtime deps.

function parseUnits(input) {
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
    i++;
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
    let depthParen = 0;
    let depthBrack = 0;
    let depthBrace = 0;
    let hadParen = false;
    const start = i;
    while (i < len) {
      const ch = s[i];
      if (ch === "'") {
        i++; while (i < len && s[i] !== "'") {
          if (s[i] === "\\" && i + 1 < len) i += 2; else i++;
        }
        if (s[i] === "'") i++;
        continue;
      }
      if (ch === "(") {
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
      } else if (ch === "[") depthBrack++;
      else if (ch === "]") depthBrack = Math.max(0, depthBrack - 1);
      else if (ch === "{") depthBrace++;
      else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);

      if (depthParen === 0 && depthBrack === 0 && depthBrace === 0) {
        if (delims.includes(ch)) {
          if (ch === ")") {
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
    i++;
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
        i++;
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
    return { kind: "value", key, value: true };
  }

  function parsePropsInline(stopChars) {
    const props = [];
    while (i < len) {
      skipWS();
      if (i >= len) break;
      const ch = s[i];
      if (stopChars.includes(ch)) break;
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
    if (s[i] !== ")") error("Expected ')' ");
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
      const startArgs = i;
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
      args = s.slice(startArgs, i).trim();
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

function escapeString(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function printProp(prop) {
  if (prop.kind === "event") {
    if (prop.key.startsWith("on:")) return `${prop.key}={ ${prop.expr.raw} }`;
    return `!${prop.key} { ${prop.expr.raw} }`;
  }
  if (prop.kind === "bool") {
    const raw = prop.expr.raw.startsWith("@") ? prop.expr.raw.slice(1) : prop.expr.raw;
    return `${prop.key}?=@${raw}`;
  }
  if (prop.kind === "expr") {
    const raw = prop.expr.raw.startsWith("@") ? prop.expr.raw.slice(1) : prop.expr.raw;
    return `${prop.key}=@${raw}`;
  }
  if (prop.kind === "value") {
    const v = prop.value;
    if (typeof v === "string") return `${prop.key}:'${escapeString(v)}'`;
    if (v === null) return `${prop.key}:null`;
    return `${prop.key}:${String(v)}`;
  }
  return "";
}

const PRINT_WIDTH = Number(process.env.UNITS_PRINT_WIDTH || process.env.RDL_PRINT_WIDTH || 100);

function printNode(node, indent) {
  const pad = "  ".repeat(indent);
  if (node.type === "text") return `${pad}text '${escapeString(node.value)}'`;
  if (node.type === "expr") return `${pad}@${node.value.raw}`;
  if (node.type === "directive") {
    const args = node.args ? ` (${node.args})` : "";
    if (!node.children || node.children.length === 0) return `${pad}#${node.name}${args}`;
    const inner = node.children.map((n) => printNode(n, indent + 1)).join("\n");
    return `${pad}#${node.name}${args} {\n${inner}\n${pad}}`;
  }
  if (node.type === "tag") {
    let props = "";
    if (node.props && node.props.length) {
      const parts = node.props.map(printProp);
      const inline = ` (${parts.join(", ")})`;
      if ((pad.length + node.name.length + inline.length) > PRINT_WIDTH && parts.length > 1) {
        const inner = parts.map((p) => `${pad}  ${p}`).join(",\n");
        props = ` (\n${inner}\n${pad})`;
      } else {
        props = inline;
      }
    }
    if (!node.children || node.children.length === 0) return `${pad}${node.name}${props}`;
    const inner = node.children.map((n) => printNode(n, indent + 1)).join("\n");
    return `${pad}${node.name}${props} {\n${inner}\n${pad}}`;
  }
  return "";
}

function formatUnits(source) {
  const ast = parseUnits(source);
  return ast.body.map((n) => printNode(n, 0)).join("\n") + "\n";
}

function getLineIndent(source, offset) {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const line = source.slice(lineStart, offset);
  const match = line.match(/^[ \t]*/);
  return match ? match[0] : "";
}

function findSmallestNode(ast, startOffset, endOffset) {
  let best = null;
  function visit(node) {
    if (!node || node.start == null || node.end == null) return;
    if (node.start <= startOffset && node.end >= endOffset) {
      if (!best || (node.end - node.start) < (best.end - best.start)) best = node;
      if (node.children) node.children.forEach(visit);
      if (node.body) node.body.forEach(visit);
    }
  }
  visit(ast);
  return best;
}

function formatUnitsRange(source, startOffset, endOffset) {
  const ast = parseUnits(source);
  const target = findSmallestNode(ast, startOffset, endOffset);
  if (!target) {
    return { formatted: formatUnits(source), start: 0, end: source.length };
  }
  if (target.type === "document") {
    return { formatted: formatUnits(source), start: 0, end: source.length };
  }
  const indent = getLineIndent(source, target.start);
  const printed = printNode(target, 0);
  const formatted = printed
    .split("\n")
    .map((line) => (line.length ? indent + line : line))
    .join("\n");
  return { formatted, start: target.start, end: target.end };
}

module.exports = { formatUnits, formatUnitsRange };
