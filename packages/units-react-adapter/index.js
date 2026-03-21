let uiIrMod;

try {
  uiIrMod = await import("@botfather/units-ui-ir");
} catch {
  // Monorepo fallback for direct node execution without workspace linking.
  uiIrMod = await import("../units-ui-ir/index.js");
}

const { inferRoleFromTag, normalizeUiNode } = uiIrMod;

const REACT_ELEMENT_TYPE = Symbol.for("react.element");
const REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function collapseWhitespace(value) {
  return cleanText(value).replace(/\s+/g, " ");
}

function toPathId(path, prefix = "r") {
  if (!Array.isArray(path) || path.length === 0) return `${prefix}0`;
  return `${prefix}${path.join("_")}`;
}

function isReactElementLike(value) {
  if (!isObject(value)) return false;
  if (value.$$typeof === REACT_ELEMENT_TYPE) return true;
  if (!("type" in value) || !("props" in value)) return false;
  if ("tagName" in value || "attributes" in value || "nodeType" in value) return false;
  return true;
}

function isFragmentType(type) {
  if (type === REACT_FRAGMENT_TYPE) return true;
  if (isObject(type) && type.$$typeof === REACT_FRAGMENT_TYPE) return true;
  return false;
}

function typeNameFromType(type) {
  if (typeof type === "string") return type;
  if (isFragmentType(type)) return "Fragment";
  if (typeof type === "function") return cleanText(type.displayName || type.name || "Component") || "Component";
  if (isObject(type)) {
    const direct = cleanText(type.displayName || type.name);
    if (direct) return direct;
    const rendered = cleanText(type.render?.displayName || type.render?.name);
    if (rendered) return rendered;
  }
  return cleanText(type) || "Component";
}

function extractPrimitiveText(value, out) {
  if (value == null || typeof value === "boolean") return;

  if (Array.isArray(value)) {
    for (const child of value) {
      extractPrimitiveText(child, out);
    }
    return;
  }

  if (typeof value === "string" || typeof value === "number") {
    const text = collapseWhitespace(value);
    if (text) out.push(text);
  }
}

function extractTextContent(children) {
  const parts = [];
  extractPrimitiveText(children, parts);
  return collapseWhitespace(parts.join(" "));
}

function inferActions(role, props) {
  const mapped = [];

  const eventMap = {
    onClick: "click",
    onPress: "click",
    onChange: "input",
    onInput: "input",
    onSubmit: "submit",
    onFocus: "focus",
    onBlur: "blur",
    onKeyDown: "keydown",
    onKeyUp: "keyup",
  };

  for (const [eventName, actionName] of Object.entries(eventMap)) {
    if (typeof props?.[eventName] === "function") mapped.push(actionName);
  }

  if (mapped.length > 0) {
    return [...new Set(mapped)];
  }

  if (role === "button" || role === "link") return ["click"];
  if (role === "input") return ["input"];
  if (role === "checkbox" || role === "radio" || role === "switch") return ["toggle"];
  return [];
}

function inferState(props) {
  const out = {};

  const boolKeys = [
    "hidden",
    "disabled",
    "expanded",
    "checked",
    "selected",
    "focused",
    "pressed",
    "required",
  ];

  for (const key of boolKeys) {
    if (typeof props?.[key] === "boolean") out[key] = props[key];
  }

  if (typeof props?.readOnly === "boolean") out.readonly = props.readOnly;
  if (typeof props?.readonly === "boolean") out.readonly = props.readonly;

  const ariaMap = {
    "aria-hidden": "hidden",
    "aria-expanded": "expanded",
    "aria-checked": "checked",
    "aria-selected": "selected",
    "aria-pressed": "pressed",
    "aria-required": "required",
    "aria-readonly": "readonly",
  };

  for (const [ariaKey, stateKey] of Object.entries(ariaMap)) {
    if (props?.[ariaKey] == null) continue;
    out[stateKey] = String(props[ariaKey]) === "true";
  }

  return out;
}

function normalizeProps(props) {
  const out = {};

  const allowList = new Set([
    "id",
    "className",
    "href",
    "type",
    "value",
    "placeholder",
    "title",
    "alt",
    "name",
    "role",
    "tabIndex",
    "htmlFor",
    "aria-label",
    "aria-hidden",
    "aria-expanded",
    "aria-checked",
    "aria-selected",
    "aria-pressed",
    "aria-required",
    "aria-readonly",
  ]);

  for (const [key, value] of Object.entries(isObject(props) ? props : {})) {
    if (key === "children" || key === "ref" || key === "key") continue;
    if (key.startsWith("on") && typeof value === "function") continue;

    const isDataAttr = key.startsWith("data-");
    const isAriaAttr = key.startsWith("aria-");
    const isAllowed = allowList.has(key) || isDataAttr || isAriaAttr;

    if (!isAllowed) continue;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }

  if (isObject(props?.style)) {
    const style = {};
    const styleKeys = ["display", "visibility", "opacity"];
    for (const key of styleKeys) {
      const value = props.style[key];
      if (value == null || value === "") continue;
      style[key] = String(value);
    }
    if (Object.keys(style).length > 0) out.style = style;
  }

  return out;
}

function inferName({ props, role, fallback }) {
  const direct = collapseWhitespace(
    props?.["aria-label"]
    || props?.ariaLabel
    || props?.name
    || props?.title
    || props?.alt,
  );

  if (direct) return direct;
  if (role === "button" || role === "link" || role === "input" || role === "label") {
    const fromText = collapseWhitespace(fallback);
    if (fromText) return fromText;
  }

  return "";
}

function normalizeChildren(children, path, options) {
  const out = [];
  const flat = asArray(children);

  for (let index = 0; index < flat.length; index++) {
    const child = flat[index];

    if (Array.isArray(child)) {
      const nested = normalizeChildren(child, [...path, index], options);
      out.push(...nested);
      continue;
    }

    const normalized = normalizeReactNode(child, [...path, index], options);
    if (normalized) out.push(normalized);
  }

  return out;
}

function normalizeUnknownObject(input, path) {
  if (input?.type === "text" || input?.role === "text") {
    const text = collapseWhitespace(input?.text || input?.value || input?.textContent);
    if (!text) return null;
    return normalizeUiNode({
      id: cleanText(input?.id || toPathId(path, "t")),
      role: "text",
      name: "",
      text,
      props: {},
      state: {},
      actions: [],
      children: [],
      meta: {
        source: "react",
        kind: "text",
      },
    });
  }

  if ("role" in input || "props" in input || "state" in input || "actions" in input) {
    return normalizeUiNode({
      ...input,
      meta: {
        ...(isObject(input.meta) ? input.meta : {}),
        source: "react",
      },
    });
  }

  return null;
}

function normalizeReactNode(input, path, options = {}) {
  if (input == null || typeof input === "boolean") return null;

  if (typeof input === "string" || typeof input === "number") {
    const text = collapseWhitespace(input);
    if (!text) return null;
    return normalizeUiNode({
      id: toPathId(path, "t"),
      role: "text",
      name: "",
      text,
      props: {},
      state: {},
      actions: [],
      children: [],
      meta: {
        source: "react",
        kind: "text",
      },
    });
  }

  if (!isObject(input)) return null;

  if (!isReactElementLike(input)) {
    return normalizeUnknownObject(input, path);
  }

  const type = input.type;
  const props = isObject(input.props) ? input.props : {};
  const key = input.key != null ? String(input.key) : cleanText(props.key);

  const fragment = isFragmentType(type);
  const hostTag = typeof type === "string" ? type : "";
  const typeName = typeNameFromType(type);

  const explicitRole = cleanText(props.role || props["aria-role"]);
  const role = fragment
    ? "container"
    : inferRoleFromTag(hostTag, explicitRole || (typeof type === "string" ? "" : "container"));

  const children = normalizeChildren(props.children, path, options);
  const text = extractTextContent(props.children);

  let name = inferName({
    props,
    role,
    fallback: text,
  });

  if (!name && !fragment && typeof type !== "string" && options.includeComponentNames !== false) {
    name = typeName;
  }

  const nodeId = cleanText(props.id || key || toPathId(path));
  const nodeProps = normalizeProps(props);
  const nodeState = inferState(props);
  const nodeActions = inferActions(role, props);

  const kind = fragment ? "fragment" : typeof type === "string" ? "host" : "component";

  const meta = {
    source: "react",
    kind,
    type: typeName,
  };

  if (key) meta.key = key;

  return normalizeUiNode({
    id: nodeId,
    role,
    name,
    text,
    props: nodeProps,
    state: nodeState,
    actions: nodeActions,
    children,
    meta,
  });
}

export function normalizeReactTree(input, options = {}) {
  if (input == null) {
    return normalizeUiNode({
      id: "r0",
      role: "container",
      name: "",
      text: "",
      props: {},
      state: {},
      actions: [],
      children: [],
      meta: {
        source: "react",
        empty: true,
      },
    });
  }

  if (Array.isArray(input)) {
    const children = normalizeChildren(input, [0], options);
    return normalizeUiNode({
      id: "r0",
      role: "container",
      name: "",
      text: "",
      props: {},
      state: {},
      actions: [],
      children,
      meta: {
        source: "react",
        kind: "root",
      },
    });
  }

  const normalized = normalizeReactNode(input, [0], options);
  if (normalized) return normalized;

  return normalizeUiNode({
    id: "r0",
    role: "container",
    name: "",
    text: "",
    props: {},
    state: {},
    actions: [],
    children: [],
    meta: {
      source: "react",
      unsupported: true,
    },
  });
}

export {
  isReactElementLike,
  normalizeReactNode,
  normalizeReactTree as reactElementToUiNode,
};
