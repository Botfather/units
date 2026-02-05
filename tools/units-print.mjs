import { parseUnits } from "../lib/units-parser.js";

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

export function formatUnits(source) {
  const ast = parseUnits(source);
  return ast.body.map((n) => printNode(n, 0)).join("\n") + "\n";
}
