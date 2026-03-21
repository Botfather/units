function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function coerceString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function cleanText(value) {
  return coerceString(value).trim();
}

export function inferRoleFromTag(tagName, explicitRole = "") {
  const role = cleanText(explicitRole).toLowerCase();
  if (role) return role;

  const tag = cleanText(tagName).toLowerCase();
  if (!tag) return "container";

  if (tag === "#text" || tag === "text") return "text";
  if (tag === "button") return "button";
  if (tag === "input" || tag === "textarea" || tag === "select") return "input";
  if (tag === "a") return "link";
  if (tag === "img") return "image";
  if (tag === "label") return "label";
  if (tag === "li") return "listitem";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "table") return "table";
  if (tag === "tr") return "row";
  if (tag === "td" || tag === "th") return "cell";
  return "container";
}

function inferActions(role, inputActions) {
  const explicit = asArray(inputActions)
    .map((item) => (typeof item === "string" ? item : item?.name))
    .map((item) => cleanText(item))
    .filter(Boolean);

  if (explicit.length > 0) return [...new Set(explicit)];

  if (role === "button" || role === "link") return ["click"];
  if (role === "input") return ["input"];
  if (role === "checkbox" || role === "radio" || role === "switch") return ["toggle"];
  return [];
}

function inferDomName(node, tagName) {
  return cleanText(
    node?.name
    || node?.label
    || node?.ariaLabel
    || node?.attributes?.["aria-label"]
    || node?.attributes?.title
    || node?.attributes?.alt
    || tagName,
  );
}

function inferDomText(node, role) {
  if (role === "text") return cleanText(node?.text || node?.textContent || node?.value);
  return cleanText(node?.text || node?.textContent || "");
}

function buildDomProps(node, tagName) {
  const attrs = isObject(node?.attributes) ? node.attributes : {};
  const props = isObject(node?.props) ? node.props : {};

  const out = {
    ...attrs,
    ...props,
  };

  if (tagName) out.tagName = tagName;
  if (node?.className) out.className = node.className;
  if (node?.type) out.type = node.type;
  if (node?.href) out.href = node.href;
  if (node?.placeholder) out.placeholder = node.placeholder;

  return out;
}

function buildDomState(node) {
  const attrs = isObject(node?.attributes) ? node.attributes : {};
  const rawState = isObject(node?.state) ? node.state : {};
  const out = {
    ...rawState,
  };

  const keys = ["hidden", "disabled", "expanded", "checked", "selected", "focused", "pressed", "readonly", "required"];
  for (const key of keys) {
    if (typeof node?.[key] === "boolean") out[key] = node[key];
  }

  if (attrs["aria-hidden"] != null) out.hidden = String(attrs["aria-hidden"]) === "true";
  if (attrs["aria-expanded"] != null) out.expanded = String(attrs["aria-expanded"]) === "true";
  if (attrs["aria-checked"] != null) out.checked = String(attrs["aria-checked"]) === "true";
  if (attrs["aria-selected"] != null) out.selected = String(attrs["aria-selected"]) === "true";

  return out;
}

export function normalizeUiNode(node, defaults = {}) {
  const children = asArray(node?.children)
    .filter((child) => isObject(child))
    .map((child) => normalizeUiNode(child));

  return {
    id: cleanText(node?.id || defaults.id || ""),
    role: cleanText(node?.role || defaults.role || "unknown") || "unknown",
    name: cleanText(node?.name || defaults.name || ""),
    text: cleanText(node?.text || defaults.text || ""),
    props: isObject(node?.props) ? { ...node.props } : {},
    state: isObject(node?.state) ? { ...node.state } : {},
    actions: asArray(node?.actions).map((value) => cleanText(value)).filter(Boolean),
    children,
    meta: isObject(node?.meta) ? { ...node.meta } : {},
  };
}

function normalizeDomNode(input, path) {
  const sourceNode = isObject(input) ? input : {};
  const tagName = cleanText(sourceNode?.tagName || sourceNode?.nodeName || sourceNode?.type).toLowerCase();
  const role = inferRoleFromTag(tagName, sourceNode?.role || sourceNode?.attributes?.role || sourceNode?.props?.role);
  const id = cleanText(sourceNode?.id || sourceNode?.uid || sourceNode?.nodeId || `n${path.join("_")}`);

  const out = normalizeUiNode({
    id,
    role,
    name: inferDomName(sourceNode, tagName),
    text: inferDomText(sourceNode, role),
    props: buildDomProps(sourceNode, tagName),
    state: buildDomState(sourceNode),
    actions: inferActions(role, sourceNode?.actions),
    children: [],
    meta: {
      source: "dom",
      tagName,
    },
  });

  const rawChildren = asArray(sourceNode?.children || sourceNode?.nodes || sourceNode?.childNodes);
  out.children = rawChildren
    .map((child, index) => normalizeDomNode(child, [...path, index]))
    .filter(Boolean);

  return out;
}

function normalizeA11yNode(input, path) {
  const sourceNode = isObject(input) ? input : {};
  const role = cleanText(sourceNode?.role || sourceNode?.type || "unknown").toLowerCase() || "unknown";
  const id = cleanText(sourceNode?.id || sourceNode?.uid || sourceNode?.nodeId || `a${path.join("_")}`);

  const out = normalizeUiNode({
    id,
    role,
    name: cleanText(sourceNode?.name || sourceNode?.label || sourceNode?.title),
    text: cleanText(sourceNode?.text || sourceNode?.value || sourceNode?.description),
    props: isObject(sourceNode?.props) ? sourceNode.props : {},
    state: isObject(sourceNode?.state) ? sourceNode.state : {},
    actions: inferActions(role, sourceNode?.actions),
    children: [],
    meta: {
      source: "a11y",
    },
  });

  const rawChildren = asArray(sourceNode?.children || sourceNode?.nodes);
  out.children = rawChildren
    .map((child, index) => normalizeA11yNode(child, [...path, index]))
    .filter(Boolean);

  return out;
}

function compactUiNode(node, options) {
  const includeProps = options.includeProps === true;
  const includeMeta = options.includeMeta === true;
  const includeIds = options.includeIds !== false;
  const includeState = options.includeState !== false;

  const out = {
    role: node.role,
  };

  if (includeIds && node.id) out.id = node.id;
  if (node.name) out.name = node.name;
  if (node.text) out.text = node.text;
  if (includeState && node.state && Object.keys(node.state).length > 0) out.state = node.state;
  if (node.actions && node.actions.length > 0) out.actions = node.actions;
  if (includeProps && node.props && Object.keys(node.props).length > 0) out.props = node.props;
  if (includeMeta && node.meta && Object.keys(node.meta).length > 0) out.meta = node.meta;

  const children = (node.children || []).map((child) => compactUiNode(child, options));
  if (children.length > 0) out.children = children;

  return out;
}

export function normalizeDomUiTree(input) {
  return normalizeDomNode(input, [0]);
}

export function normalizeA11yUiTree(input) {
  return normalizeA11yNode(input, [0]);
}

export function normalizeUiTree(input, sourceType = "ir") {
  const normalizedType = cleanText(sourceType).toLowerCase();
  if (normalizedType === "dom") return normalizeDomUiTree(input);
  if (normalizedType === "a11y" || normalizedType === "accessibility" || normalizedType === "ax") {
    return normalizeA11yUiTree(input);
  }
  return normalizeUiNode(input);
}

export function serializeCompactUiTree(uiTree, options = {}) {
  const normalized = normalizeUiNode(uiTree);
  return compactUiNode(normalized, options);
}

export {
  normalizeUiNode as normalizeIrNode,
  normalizeDomUiTree as normalizeDomTree,
  normalizeA11yUiTree as normalizeA11yTree,
  serializeCompactUiTree as serializeAgentTree,
};
