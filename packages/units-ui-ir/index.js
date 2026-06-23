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

function pathId(path, prefix = "n") {
  const parts = asArray(path)
    .map((part) => cleanText(part).replace(/[^A-Za-z0-9]+/g, "_"))
    .filter(Boolean);
  return parts.length > 0 ? `${prefix}${parts.join("_")}` : `${prefix}0`;
}

function decodeSlackEntities(value) {
  return coerceString(value).replace(/&(amp|lt|gt);/g, (_, entity) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    return _;
  });
}

function slackNode({ id, role, name = "", text = "", props = {}, state = {}, actions = [], children = [], meta = {} }) {
  return {
    id: cleanText(id),
    role: cleanText(role || "unknown") || "unknown",
    name: coerceString(name),
    text: coerceString(text),
    props: isObject(props) ? { ...props } : {},
    state: isObject(state) ? { ...state } : {},
    actions: asArray(actions).map((value) => cleanText(value)).filter(Boolean),
    children: asArray(children).filter((child) => isObject(child)),
    meta: {
      source: "slack",
      ...meta,
    },
  };
}

function slackTextNode(text, path, meta = {}) {
  if (text === "") return null;
  return slackNode({
    id: pathId(path, "st"),
    role: "text",
    text,
    meta: {
      preserveWhitespace: true,
      kind: "mrkdwn_text",
      ...meta,
    },
  });
}

function pushSlackText(out, text, path, meta = {}) {
  const node = slackTextNode(decodeSlackEntities(text), path, meta);
  if (node) out.push(node);
}

function slackNodesText(nodes) {
  return asArray(nodes)
    .map((node) => {
      if (!isObject(node)) return "";
      if (node.text) return coerceString(node.text);
      return slackNodesText(node.children);
    })
    .join("");
}

function findClosingMarker(text, marker, start) {
  const idx = text.indexOf(marker, start);
  return idx > start ? idx : -1;
}

function splitSlackAngleContent(content) {
  const bar = content.indexOf("|");
  if (bar === -1) {
    return {
      target: content,
      label: "",
    };
  }

  return {
    target: content.slice(0, bar),
    label: content.slice(bar + 1),
  };
}

function parseSlackDateToken(content, path) {
  const { target, label } = splitSlackAngleContent(content);
  const parts = target.split("^");
  const timestamp = parts[1] || "";
  const format = parts[2] || "";
  const href = parts[3] || "";
  const fallback = decodeSlackEntities(label || format || timestamp);

  return slackNode({
    id: pathId(path, "sd"),
    role: "date",
    name: fallback,
    text: fallback,
    props: {
      timestamp,
      format,
      ...(href ? { href } : {}),
      ...(label ? { fallback: decodeSlackEntities(label) } : {}),
    },
    meta: {
      kind: "mrkdwn_date",
      raw: `<${content}>`,
    },
  });
}

function parseSlackAngleToken(raw, path) {
  const content = raw.slice(1, -1);
  if (!content) return null;

  if (content.startsWith("!date^")) return parseSlackDateToken(content, path);

  const { target, label } = splitSlackAngleContent(content);
  const decodedLabel = decodeSlackEntities(label);

  if (target.startsWith("#")) {
    const channelId = target.slice(1);
    const text = decodedLabel ? (decodedLabel.startsWith("#") ? decodedLabel : `#${decodedLabel}`) : `#${channelId}`;
    return slackNode({
      id: pathId(path, "sc"),
      role: "channel",
      name: text,
      text,
      props: { channelId },
      meta: {
        kind: "mrkdwn_channel",
        raw,
      },
    });
  }

  if (target.startsWith("@")) {
    const userId = target.slice(1);
    const text = decodedLabel || `@${userId}`;
    return slackNode({
      id: pathId(path, "su"),
      role: "mention",
      name: text,
      text,
      props: { userId },
      meta: {
        kind: "mrkdwn_user",
        raw,
      },
    });
  }

  if (target.startsWith("!subteam^")) {
    const groupId = target.slice("!subteam^".length);
    const text = decodedLabel || `@${groupId}`;
    return slackNode({
      id: pathId(path, "sg"),
      role: "usergroup",
      name: text,
      text,
      props: { groupId },
      meta: {
        kind: "mrkdwn_usergroup",
        raw,
      },
    });
  }

  if (target === "!here" || target === "!channel" || target === "!everyone") {
    const special = target.slice(1);
    const text = `@${special}`;
    return slackNode({
      id: pathId(path, "ss"),
      role: "special",
      name: text,
      text,
      props: { special },
      meta: {
        kind: "mrkdwn_special",
        raw,
      },
    });
  }

  const href = decodeSlackEntities(target);
  const text = decodedLabel || href;
  return slackNode({
    id: pathId(path, "sl"),
    role: "link",
    name: text,
    text,
    props: { href },
    actions: href ? ["click"] : [],
    meta: {
      kind: "mrkdwn_link",
      raw,
    },
  });
}

function parseSlackInline(text, path) {
  const source = coerceString(text);
  const out = [];
  let index = 0;

  while (index < source.length) {
    if (source.startsWith("```", index)) {
      const close = source.indexOf("```", index + 3);
      if (close !== -1) {
        const codeText = decodeSlackEntities(source.slice(index + 3, close));
        out.push(slackNode({
          id: pathId([...path, out.length], "spre"),
          role: "preformatted",
          text: codeText,
          meta: {
            kind: "mrkdwn_code_block",
            preserveWhitespace: true,
          },
        }));
        index = close + 3;
        continue;
      }
    }

    const ch = source[index];

    if (ch === "`") {
      const close = findClosingMarker(source, "`", index + 1);
      if (close !== -1) {
        const codeText = decodeSlackEntities(source.slice(index + 1, close));
        out.push(slackNode({
          id: pathId([...path, out.length], "scode"),
          role: "code",
          text: codeText,
          meta: {
            kind: "mrkdwn_code",
            preserveWhitespace: true,
          },
        }));
        index = close + 1;
        continue;
      }
    }

    if (ch === "<") {
      const close = source.indexOf(">", index + 1);
      if (close !== -1) {
        const node = parseSlackAngleToken(source.slice(index, close + 1), [...path, out.length]);
        if (node) {
          out.push(node);
          index = close + 1;
          continue;
        }
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      const role = ch === "*" ? "strong" : ch === "_" ? "emphasis" : "strike";
      const kind = ch === "*" ? "mrkdwn_bold" : ch === "_" ? "mrkdwn_italic" : "mrkdwn_strike";
      const close = findClosingMarker(source, ch, index + 1);
      if (close !== -1) {
        const children = parseSlackInline(source.slice(index + 1, close), [...path, out.length]);
        out.push(slackNode({
          id: pathId([...path, out.length], "sf"),
          role,
          text: slackNodesText(children),
          children,
          meta: { kind },
        }));
        index = close + 1;
        continue;
      }
    }

    const start = index;
    index++;
    while (index < source.length) {
      if (source.startsWith("```", index)) break;
      const next = source[index];
      if (next === "`" || next === "<" || next === "*" || next === "_" || next === "~") break;
      index++;
    }
    pushSlackText(out, source.slice(start, index), [...path, out.length]);
  }

  return out;
}

export function parseSlackMrkdwn(text, options = {}) {
  const source = coerceString(text);
  const path = asArray(options.path);
  const lines = source.split("\n");
  const out = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (line.startsWith(">")) {
      const quoteLines = [line.replace(/^>\s?/, "")];
      while (index + 1 < lines.length && lines[index + 1].startsWith(">")) {
        index++;
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
      }
      const children = parseSlackInline(quoteLines.join("\n"), [...path, out.length, "quote"]);
      out.push(slackNode({
        id: pathId([...path, out.length], "sq"),
        role: "blockquote",
        text: slackNodesText(children),
        children,
        meta: {
          kind: "mrkdwn_quote",
        },
      }));
    } else {
      out.push(...parseSlackInline(line, [...path, out.length]));
    }

    if (index < lines.length - 1) {
      pushSlackText(out, "\n", [...path, out.length], { kind: "mrkdwn_linebreak" });
    }
  }

  return out;
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

function implicitActionsForRole(role) {
  if (role === "button" || role === "link") return ["click"];
  if (role === "input") return ["input"];
  if (role === "checkbox" || role === "radio" || role === "switch") return ["toggle"];
  return [];
}

function inferActions(role, inputActions) {
  const explicit = asArray(inputActions)
    .map((item) => (typeof item === "string" ? item : item?.name))
    .map((item) => cleanText(item))
    .filter(Boolean);

  if (explicit.length > 0) return [...new Set(explicit)];

  return implicitActionsForRole(role);
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

function isSlackTextObject(input) {
  if (!isObject(input)) return false;
  const type = cleanText(input.type).toLowerCase();
  return (type === "mrkdwn" || type === "plain_text") && typeof input.text === "string";
}

function normalizeSlackTextObject(input, path) {
  const type = cleanText(input?.type).toLowerCase();
  const text = coerceString(input?.text);
  const decoded = decodeSlackEntities(text);

  if (type !== "mrkdwn") {
    return slackNode({
      id: pathId(path, "spt"),
      role: "text",
      text: decoded,
      meta: {
        kind: "plain_text",
        emoji: input?.emoji === true,
        preserveWhitespace: true,
      },
    });
  }

  const children = parseSlackMrkdwn(text, { path });
  if (children.length === 1 && children[0]?.role === "text") {
    return {
      ...children[0],
      id: pathId(path, "smt"),
      meta: {
        ...(children[0].meta || {}),
        kind: "mrkdwn",
        verbatim: input?.verbatim === true,
      },
    };
  }

  return slackNode({
    id: pathId(path, "smt"),
    role: "container",
    text: slackNodesText(children),
    children,
    meta: {
      kind: "mrkdwn",
      verbatim: input?.verbatim === true,
    },
  });
}

function slackBlockRole(type) {
  if (type === "header") return "heading";
  if (type === "section") return "section";
  if (type === "context") return "context";
  if (type === "actions") return "group";
  if (type === "divider") return "separator";
  if (type === "image") return "image";
  if (type === "input") return "input";
  if (type === "markdown") return "section";
  if (type === "rich_text") return "rich_text";
  return type || "container";
}

function slackElementRole(type) {
  if (type === "button" || type === "workflow_button") return "button";
  if (type === "image") return "image";
  if (type === "datepicker" || type === "timepicker" || type === "datetimepicker") return "input";
  if (type.includes("select") || type.includes("checkbox") || type.includes("radio")) return "input";
  return type || "container";
}

function addSlackTextChild(children, value, path) {
  if (!value) return;
  const child = isSlackTextObject(value)
    ? normalizeSlackTextObject(value, path)
    : slackTextNode(decodeSlackEntities(value), path, { kind: "plain_text" });
  if (child) children.push(child);
}

function normalizeSlackElement(input, path) {
  if (isSlackTextObject(input)) return normalizeSlackTextObject(input, path);
  const source = isObject(input) ? input : {};
  const type = cleanText(source.type).toLowerCase();

  if (!type && typeof input === "string") {
    return normalizeSlackTextObject({ type: "mrkdwn", text: input }, path);
  }

  const children = [];
  addSlackTextChild(children, source.text, [...path, "text"]);
  addSlackTextChild(children, source.placeholder, [...path, "placeholder"]);
  addSlackTextChild(children, source.confirm?.title, [...path, "confirm", "title"]);
  addSlackTextChild(children, source.confirm?.text, [...path, "confirm", "text"]);

  const options = asArray(source.options);
  for (let index = 0; index < options.length; index++) {
    addSlackTextChild(children, options[index]?.text, [...path, "option", index]);
  }

  const role = slackElementRole(type);
  const text = slackNodesText(children) || cleanText(source.alt_text || source.value || source.action_id);
  const props = {};

  if (source.action_id) props.actionId = cleanText(source.action_id);
  if (source.url) props.href = cleanText(source.url);
  if (source.value) props.value = coerceString(source.value);
  if (source.style) props.style = cleanText(source.style);
  if (source.image_url) props.src = cleanText(source.image_url);
  if (source.alt_text) props.alt = cleanText(source.alt_text);

  return slackNode({
    id: cleanText(source.action_id || source.block_id || pathId(path, "se")),
    role,
    name: text,
    text,
    props,
    actions: role === "button" ? ["click"] : [],
    children,
    meta: {
      kind: "element",
      slackType: type,
    },
  });
}

function normalizeSlackBlock(input, path) {
  if (isSlackTextObject(input)) return normalizeSlackTextObject(input, path);
  const source = isObject(input) ? input : {};
  const type = cleanText(source.type).toLowerCase();
  const role = slackBlockRole(type);
  const children = [];

  if (type === "markdown" && typeof source.text === "string") {
    addSlackTextChild(children, { type: "mrkdwn", text: source.text }, [...path, "text"]);
  } else {
    addSlackTextChild(children, source.text, [...path, "text"]);
  }

  const fields = asArray(source.fields);
  for (let index = 0; index < fields.length; index++) {
    const field = normalizeSlackTextObject(fields[index], [...path, "field", index]);
    children.push(slackNode({
      id: pathId([...path, "field", index], "sfld"),
      role: "field",
      text: field.text,
      children: field.role === "container" ? field.children : [field],
      meta: {
        kind: "field",
      },
    }));
  }

  const elements = asArray(source.elements);
  for (let index = 0; index < elements.length; index++) {
    const child = normalizeSlackElement(elements[index], [...path, "element", index]);
    if (child) children.push(child);
  }

  if (source.accessory) {
    const accessory = normalizeSlackElement(source.accessory, [...path, "accessory"]);
    if (accessory) children.push(accessory);
  }

  addSlackTextChild(children, source.label, [...path, "label"]);
  addSlackTextChild(children, source.hint, [...path, "hint"]);

  if (source.element) {
    const child = normalizeSlackElement(source.element, [...path, "input"]);
    if (child) children.push(child);
  }

  const props = {};
  if (source.block_id) props.blockId = cleanText(source.block_id);
  if (source.image_url) props.src = cleanText(source.image_url);
  if (source.alt_text) props.alt = cleanText(source.alt_text);

  const title = isSlackTextObject(source.title)
    ? normalizeSlackTextObject(source.title, [...path, "title"])
    : null;
  if (title) children.unshift(title);

  const text = slackNodesText(children) || cleanText(source.alt_text || source.block_id);

  return slackNode({
    id: cleanText(source.block_id || pathId(path, "sb")),
    role,
    name: text,
    text,
    props,
    children,
    meta: {
      kind: "block",
      slackType: type,
    },
  });
}

export function normalizeSlackBlockKitTree(input, options = {}) {
  if (typeof input === "string") {
    return normalizeSlackTextObject({ type: "mrkdwn", text: input }, [0]);
  }

  if (isSlackTextObject(input)) return normalizeSlackTextObject(input, [0]);

  const source = isObject(input) ? input : {};
  const blocks = Array.isArray(input)
    ? input
    : Array.isArray(source.blocks)
      ? source.blocks
      : null;

  if (!blocks) return normalizeSlackBlock(input, [0]);

  const children = blocks
    .map((block, index) => normalizeSlackBlock(block, [index]))
    .filter(Boolean);

  return slackNode({
    id: cleanText(source.ts || source.client_msg_id || options.id || "slack_message"),
    role: "container",
    name: cleanText(source.text || "Slack message"),
    text: cleanText(source.text),
    props: {},
    children,
    meta: {
      kind: "message",
      slackType: "message",
      channel: cleanText(source.channel),
      ts: cleanText(source.ts),
    },
  });
}

function compactUiNode(node, options) {
  const includeProps = options.includeProps === true;
  const includeMeta = options.includeMeta === true;
  const includeIds = options.includeIds !== false;
  const includeState = options.includeState !== false;
  const includeRedundantNameText = options.includeRedundantNameText === true;
  const includeImplicitActions = options.includeImplicitActions === true;

  const out = {
    role: node.role,
  };

  if (includeIds && node.id) out.id = node.id;
  const hasName = typeof node.name === "string" && node.name.length > 0;
  const hasText = typeof node.text === "string" && node.text.length > 0;
  const sameNameText = hasName && hasText && node.name === node.text;

  if (sameNameText && !includeRedundantNameText) {
    if (node.role === "text") out.text = node.text;
    else out.name = node.name;
  } else {
    if (hasName) out.name = node.name;
    if (hasText) out.text = node.text;
  }
  if (includeState && node.state && Object.keys(node.state).length > 0) out.state = node.state;
  if (node.actions && node.actions.length > 0) {
    const actions = [...new Set(node.actions.map((value) => cleanText(value)).filter(Boolean))];
    const implicit = implicitActionsForRole(cleanText(node.role).toLowerCase());
    const allImplicit = actions.length > 0
      && implicit.length > 0
      && actions.every((action) => implicit.includes(action));
    if (actions.length > 0 && (!allImplicit || includeImplicitActions)) {
      out.actions = actions;
    }
  }
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
  if (normalizedType === "slack" || normalizedType === "block-kit" || normalizedType === "blockkit") {
    return normalizeSlackBlockKitTree(input);
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
  normalizeSlackBlockKitTree as normalizeSlackTree,
  serializeCompactUiTree as serializeAgentTree,
};
