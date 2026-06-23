import { snapshotUi } from "@botfather/units-dom-snapshot";

function countNodes(node) {
  if (!node || typeof node !== "object") return 0;
  let total = 1;
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) total += countNodes(child);
  return total;
}

function normalizeError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error.message) return String(error.message);
  return String(error);
}

function indent(depth) {
  return "  ".repeat(depth);
}

function escapeLiteral(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value, max = 140) {
  const text = escapeLiteral(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function roleToTag(role) {
  const raw = String(role || "container")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join("");
  return raw || "Container";
}

function summarizeList(values) {
  const out = Array.isArray(values)
    ? values.map((item) => compactText(item, 32)).filter(Boolean)
    : [];
  return out.join(",");
}

function summarizeState(state) {
  if (!state || typeof state !== "object") return "";
  const out = [];
  for (const [key, value] of Object.entries(state)) {
    if (value === false || value == null) continue;
    out.push(`${compactText(key, 20)}=${compactText(value, 20)}`);
  }
  return out.join(";");
}

function nodeProps(node) {
  const props = [];

  const name = compactText(node?.name, 80);
  if (name) props.push(`name:'${name}'`);

  const text = node?.role === "text" ? "" : compactText(node?.text, 100);
  if (text) props.push(`text:'${text}'`);

  const actions = summarizeList(node?.actions);
  if (actions) props.push(`actions:'${actions}'`);

  const state = summarizeState(node?.state);
  if (state) props.push(`state:'${state}'`);

  return props;
}

function renderNode(node, depth = 0) {
  if (!node || typeof node !== "object") return "";
  const space = indent(depth);
  const children = Array.isArray(node.children) ? node.children : [];

  if (node.role === "text") {
    const text = compactText(node.text, 180);
    if (!text) return "";
    return `${space}text '${text}'`;
  }

  const tag = roleToTag(node.role);
  const props = nodeProps(node);
  const head = props.length > 0
    ? `${space}${tag} (${props.join(" ")})`
    : `${space}${tag}`;

  const renderedChildren = children
    .map((child) => renderNode(child, depth + 1))
    .filter(Boolean);

  if (renderedChildren.length === 0) return head;
  return `${head} {\n${renderedChildren.join("\n")}\n${space}}`;
}

function toUnitsDsl(rootNode) {
  const body = renderNode(rootNode, 0);
  if (!body) return "Container\n";
  return `${body}\n`;
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    browser.runtime.onMessage.addListener((message) => {
      if (!message || message.type !== "UNITS_CAPTURE_DOM") return undefined;

      try {
        const uiTree = snapshotUi({
          rootSelector: "body",
          maxDepth: 45,
          pruneInvisible: true,
          pruneOffscreen: true,
          includeStyleSummary: false,
        });

        const dsl = toUnitsDsl(uiTree);

        return Promise.resolve({
          ok: true,
          url: window.location.href,
          title: document.title || "page",
          dsl,
          stats: {
            nodeCount: countNodes(uiTree),
            dslChars: dsl.length,
          },
        });
      } catch (error) {
        return Promise.resolve({
          ok: false,
          error: normalizeError(error),
        });
      }
    });
  },
});
