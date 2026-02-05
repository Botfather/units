const CLASS_MAP = {
  ws: "tok-ws",
  comment: "tok-comment",
  string: "tok-string",
  directive: "tok-directive",
  expr: "tok-expr",
  keyword: "tok-keyword",
  ident: "tok-ident",
  number: "tok-number",
  punct: "tok-punct",
  unknown: "tok-unknown",
};

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

export function highlightTokens(tokens) {
  return tokens.map((t) => {
    const cls = CLASS_MAP[t.type] || "tok-unknown";
    return `<span class=\"${cls}\">${escapeHtml(t.value)}</span>`;
  }).join("");
}
