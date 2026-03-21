let parserMod;
let printMod;
let treeIrMod;
let transformMod;

try {
  parserMod = await import("@botfather/units/parser");
  printMod = await import("@botfather/units/print");
  treeIrMod = await import("@botfather/units/tree-ir");
  transformMod = await import("@botfather/units/transform");
} catch {
  // Monorepo fallback for direct node execution without workspace linking.
  parserMod = await import("../units/units-parser.js");
  printMod = await import("../units/units-print.js");
  treeIrMod = await import("../units/tree-ir.js");
  transformMod = await import("../units/transform.js");
}

const { parseUnits } = parserMod;
const { formatUnits } = printMod;
const {
  normalizeDomTree,
  normalizeA11yTree,
  normalizeIrNode,
} = treeIrMod;
const { runTransformProgram } = transformMod;

const ROLE_TAG_MAP = {
  root: "UI",
  container: "Container",
  button: "Button",
  input: "Input",
  textbox: "Input",
  link: "Link",
  form: "Form",
  image: "Image",
  img: "Image",
  dialog: "Dialog",
  alertdialog: "Dialog",
  heading: "Heading",
  list: "List",
  listitem: "ListItem",
  item: "ListItem",
  table: "Table",
  row: "Row",
  cell: "Cell",
  checkbox: "Checkbox",
  radio: "Radio",
  switch: "Switch",
};

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

function escapeUnitsString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function escapeJsString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function isIdentifier(value) {
  return /^[A-Za-z_$][\w$]*$/.test(String(value || ""));
}

function toJsLiteral(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return `'${escapeJsString(value)}'`;

  if (Array.isArray(value)) {
    return `[${value.map((item) => toJsLiteral(item)).join(", ")}]`;
  }

  if (isObject(value)) {
    const entries = Object.entries(value).map(([key, oneValue]) => {
      const prop = isIdentifier(key)
        ? key
        : `'${escapeJsString(key)}'`;
      return `${prop}: ${toJsLiteral(oneValue)}`;
    });
    return `{ ${entries.join(", ")} }`;
  }

  return "null";
}

function countNodes(root) {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    count++;
    for (const child of asArray(node.children)) stack.push(child);
  }
  return count;
}

function detectSourceType(input, preferred) {
  const normalizedPreferred = cleanText(preferred || "auto").toLowerCase();
  if (normalizedPreferred && normalizedPreferred !== "auto") return normalizedPreferred;

  const root = isObject(input) ? input : {};

  const sourceMeta = cleanText(root?.meta?.source).toLowerCase();
  if (sourceMeta === "dom" || sourceMeta === "a11y" || sourceMeta === "ir") return sourceMeta;

  const hasIrShape = "role" in root && ("props" in root || "state" in root || "actions" in root || "meta" in root);
  if (hasIrShape) return "ir";

  const hasDomShape = "tagName" in root
    || "attributes" in root
    || "dataset" in root
    || root.type === "element"
    || root.type === "text";
  if (hasDomShape) return "dom";

  const hasA11yShape = "role" in root && ("name" in root || "label" in root || "description" in root);
  if (hasA11yShape) return "a11y";

  return "ir";
}

function normalizeInputTree(tree, sourceType) {
  if (sourceType === "dom") return normalizeDomTree(tree);
  if (sourceType === "a11y") return normalizeA11yTree(tree);
  return normalizeIrNode(tree);
}

function normalizeExpression(raw) {
  const text = cleanText(raw);
  if (!text) return "true";
  if (text.startsWith("@")) return text;
  return `@(${text})`;
}

function shouldSkipNode(node, config) {
  if (!isObject(node)) return true;
  if (config.includeHidden) return false;
  if (node?.state?.hidden === true) return true;
  return false;
}

function resolveTag(role) {
  const normalizedRole = cleanText(role || "unknown").toLowerCase();
  const mapped = ROLE_TAG_MAP[normalizedRole];
  if (mapped) {
    return {
      tag: mapped,
      known: true,
      role: normalizedRole,
    };
  }

  const parts = normalizedRole
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      tag: "Node",
      known: false,
      role: normalizedRole || "unknown",
    };
  }

  const tag = parts
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join("");

  return {
    tag: /^[0-9]/.test(tag) ? `Node${tag}` : tag,
    known: false,
    role: normalizedRole,
  };
}

function nodeLeafSignature(node) {
  if (!isObject(node)) return "";
  if (asArray(node.children).length > 0) return "";

  const role = cleanText(node.role).toLowerCase();
  if (!role) return "";

  const actions = asArray(node.actions)
    .map((action) => cleanText(action))
    .filter(Boolean)
    .sort()
    .join("|");

  const state = Object.entries(isObject(node.state) ? node.state : {})
    .filter(([key, value]) => key !== "hidden" && (typeof value === "boolean" || typeof value === "number" || typeof value === "string"))
    .map(([key, value]) => `${key}:${String(value)}`)
    .sort()
    .join("|");

  const hasName = cleanText(node.name) ? "1" : "0";
  const hasText = cleanText(node.text) ? "1" : "0";

  return `${role};a=${actions};s=${state};n=${hasName};t=${hasText}`;
}

function findLoopGroup(children, start, config) {
  if (!config.enableLoopHeuristic) return null;

  const first = children[start];
  const signature = nodeLeafSignature(first);
  if (!signature) return null;

  const group = [first];
  for (let index = start + 1; index < children.length; index++) {
    const next = children[index];
    if (nodeLeafSignature(next) !== signature) break;
    group.push(next);
  }

  if (group.length < config.minLoopGroupSize) return null;

  const names = group.map((node) => cleanText(node.name));
  const texts = group.map((node) => cleanText(node.text));

  const dynamicFields = [];
  if (new Set(names).size > 1) dynamicFields.push("name");
  if (new Set(texts).size > 1) dynamicFields.push("text");

  if (dynamicFields.length === 0) return null;

  const items = group.map((node) => {
    const out = {};
    for (const field of dynamicFields) {
      out[field] = cleanText(node[field]);
    }
    return out;
  });

  return {
    length: group.length,
    template: group[0],
    dynamicFields,
    items,
  };
}

function printValueProp(key, value) {
  if (typeof value === "string") {
    return `${key}:'${escapeUnitsString(value)}'`;
  }
  if (value === null) {
    return `${key}:null`;
  }
  return `${key}:${String(value)}`;
}

function printExprProp(key, rawExpr) {
  const expr = String(rawExpr || "").replace(/^@+/, "");
  return `${key}=@${expr}`;
}

function buildNodeProps(node, tagInfo, ctx, config) {
  const props = [];

  const dynamicFields = ctx.dynamicFields || new Set();
  const loopVar = ctx.loopVar || "item";

  const addValue = (key, value) => {
    if (value === "" || value == null) return;
    props.push(printValueProp(key, value));
  };

  const addExpr = (key, expr) => {
    if (!expr) return;
    props.push(printExprProp(key, expr));
  };

  if (config.includeId) {
    const id = cleanText(node.id);
    if (id) addValue("id", id);
  }

  const name = cleanText(node.name);
  if (dynamicFields.has("name")) {
    addExpr("name", `${loopVar}.name`);
  } else if (name) {
    addValue("name", name);
  }

  if (config.includeActions) {
    const actions = asArray(node.actions).map((value) => cleanText(value)).filter(Boolean);
    if (actions.length > 0) addValue("actions", actions.join("|"));
  }

  if (config.includeState) {
    const state = isObject(node.state) ? node.state : {};
    const keys = Object.keys(state).sort();
    for (const key of keys) {
      if (key === "hidden") continue;
      const value = state[key];
      if (typeof value === "boolean") {
        if (value === true) addValue(key, true);
        continue;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        addValue(key, value);
        continue;
      }
      if (typeof value === "string" && cleanText(value)) {
        addValue(key, cleanText(value));
      }
    }
  }

  const sourceProps = isObject(node.props) ? node.props : {};
  const allowedPropKeys = ["placeholder", "href", "type", "value", "title", "alt", "aria-label", "ariaLabel"];
  for (const key of allowedPropKeys) {
    if (!(key in sourceProps)) continue;
    const value = sourceProps[key];
    if (typeof value === "string" && cleanText(value)) addValue(key, cleanText(value));
    else if (typeof value === "number" && Number.isFinite(value)) addValue(key, value);
    else if (typeof value === "boolean" && value) addValue(key, true);
  }

  if (config.includeRoleProp && !tagInfo.known && tagInfo.role) {
    addValue("role", tagInfo.role);
  }

  return props;
}

function emitNode(node, indent, config, state, ctx = {}) {
  if (!isObject(node)) return [];
  if (shouldSkipNode(node, config)) return [];

  const pad = "  ".repeat(indent);

  const condition = !ctx.ignoreCondition && config.enableIfHeuristic
    ? cleanText(node?.state?.if || node?.state?.when || node?.meta?.if || node?.meta?.when)
    : "";

  if (condition) {
    const inner = emitNode(node, indent + 1, config, state, {
      ...ctx,
      ignoreCondition: true,
    });

    if (inner.length === 0) return [];

    return [
      `${pad}#if (${normalizeExpression(condition)}) {`,
      ...inner,
      `${pad}}`,
    ];
  }

  const role = cleanText(node.role).toLowerCase();

  if (role === "text") {
    const value = ctx.dynamicFields?.has("text")
      ? `@{${ctx.loopVar}.text}`
      : cleanText(node.text || node.name);

    if (!value) return [];
    return [`${pad}'${escapeUnitsString(value)}'`];
  }

  const tagInfo = resolveTag(role || "container");
  const props = buildNodeProps(node, tagInfo, ctx, config);

  const children = asArray(node.children)
    .filter((child) => isObject(child));

  let childLines = emitChildren(children, indent + 1, config, state);

  if (childLines.length === 0) {
    const leafText = ctx.dynamicFields?.has("text")
      ? `@{${ctx.loopVar}.text}`
      : cleanText(node.text);

    if (leafText) {
      childLines = [`${"  ".repeat(indent + 1)}'${escapeUnitsString(leafText)}'`];
    }
  }

  const header = props.length > 0
    ? `${pad}${tagInfo.tag} (${props.join(", ")})`
    : `${pad}${tagInfo.tag}`;

  if (childLines.length === 0) {
    return [header];
  }

  return [
    `${header} {`,
    ...childLines,
    `${pad}}`,
  ];
}

function emitLoopGroup(group, indent, config, state) {
  const sequence = state.loopCounter + 1;
  state.loopCounter = sequence;

  const loopVar = `item${sequence}`;
  const idxVar = `i${sequence}`;
  const dynamicFields = new Set(group.dynamicFields);

  const pad = "  ".repeat(indent);
  const listExpr = toJsLiteral(group.items);

  const templateLines = emitNode(group.template, indent + 1, config, state, {
    loopVar,
    dynamicFields,
    ignoreCondition: true,
  });

  if (templateLines.length === 0) return [];

  return [
    `${pad}#for (${loopVar}, ${idxVar} in @(${listExpr})) {`,
    ...templateLines,
    `${pad}}`,
  ];
}

function emitChildren(children, indent, config, state) {
  const visible = children.filter((child) => !shouldSkipNode(child, config));
  const lines = [];

  for (let index = 0; index < visible.length; index++) {
    const loopGroup = findLoopGroup(visible, index, config);
    if (loopGroup) {
      lines.push(...emitLoopGroup(loopGroup, indent, config, state));
      index += loopGroup.length - 1;
      continue;
    }

    const one = emitNode(visible[index], indent, config, state);
    if (one.length > 0) lines.push(...one);
  }

  return lines;
}

function normalizeCompileArgs(programOrOptions, maybeOptions) {
  if (isObject(programOrOptions)
    && !Array.isArray(programOrOptions)
    && !programOrOptions.rules
    && ("program" in programOrOptions
      || "sourceType" in programOrOptions
      || "enableLoopHeuristic" in programOrOptions
      || "minLoopGroupSize" in programOrOptions
      || "context" in programOrOptions)) {
    return {
      program: programOrOptions.program || null,
      options: programOrOptions,
    };
  }

  return {
    program: programOrOptions,
    options: isObject(maybeOptions) ? maybeOptions : {},
  };
}

export function compileUiToUnits(uiRoot, programOrOptions = null, maybeOptions = {}) {
  const { program, options } = normalizeCompileArgs(programOrOptions, maybeOptions);

  const config = {
    sourceType: "auto",
    includeId: false,
    includeActions: true,
    includeState: true,
    includeRoleProp: false,
    includeHidden: false,
    enableLoopHeuristic: true,
    minLoopGroupSize: 3,
    enableIfHeuristic: true,
    emptyRootTag: "UI",
    context: {},
    ...(isObject(options) ? options : {}),
  };

  const sourceType = detectSourceType(uiRoot, config.sourceType);
  const inputTree = normalizeInputTree(uiRoot, sourceType);

  let transformedTree = inputTree;
  let transformRun = null;

  if (program) {
    transformRun = runTransformProgram(program, inputTree, config.context || {});
    transformedTree = normalizeIrNode(transformRun.tree);
  }

  const state = {
    loopCounter: 0,
  };

  const lines = emitNode(transformedTree, 0, config, state);
  const source = lines.length > 0
    ? `${lines.join("\n")}\n`
    : `${config.emptyRootTag}\n`;

  const dsl = formatUnits(source);
  const ast = parseUnits(dsl);

  return {
    dsl,
    ast,
    source_type: sourceType,
    input_tree: inputTree,
    tree: transformedTree,
    program: transformRun?.program || null,
    trace: transformRun?.trace || [],
    stats: {
      input_nodes: countNodes(inputTree),
      output_nodes: countNodes(transformedTree),
      loop_groups: state.loopCounter,
    },
  };
}

export function compileUiToUnitsDsl(uiRoot, programOrOptions = null, maybeOptions = {}) {
  return compileUiToUnits(uiRoot, programOrOptions, maybeOptions).dsl;
}
