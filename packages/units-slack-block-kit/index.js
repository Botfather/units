let parserMod;
let rendererMod;

try {
  parserMod = await import("@botfather/units/parser");
} catch {
  parserMod = await import("../units/units-parser.js");
}

try {
  rendererMod = await import("@botfather/units/custom-renderer");
} catch {
  rendererMod = await import("../units/units-custom-renderer.js");
}

const { parseUnits } = parserMod;
const { createUnitsRenderer } = rendererMod;

const TEXT_KIND = "units-slack-text";

const MESSAGE_TAGS = new Set(["slackmessage", "message", "blockkitmessage"]);
const ROOT_TAGS = new Set(["ui", "app", "container", "blocks", "slackblocks"]);
const INLINE_TAGS = new Set([
  "text",
  "plaintext",
  "mrkdwn",
  "markdowntext",
  "strong",
  "bold",
  "emphasis",
  "italic",
  "strike",
  "strikethrough",
  "code",
  "inlinecode",
  "pre",
  "codeblock",
  "blockquote",
  "quote",
  "link",
  "mention",
  "user",
  "channel",
  "usergroup",
  "specialmention",
  "special",
  "date",
  "emoji",
  "field",
  "label",
  "hint",
  "title",
  "description",
]);

const BLOCK_TAG_TO_TYPE = new Map([
  ["section", "section"],
  ["markdown", "markdown"],
  ["markdownblock", "markdown"],
  ["header", "header"],
  ["heading", "header"],
  ["context", "context"],
  ["actions", "actions"],
  ["group", "actions"],
  ["divider", "divider"],
  ["separator", "divider"],
  ["image", "image"],
  ["input", "input"],
  ["inputblock", "input"],
  ["file", "file"],
  ["video", "video"],
  ["richtext", "rich_text"],
  ["richtextblock", "rich_text"],
  ["block", "block"],
  ["rawblock", "block"],
  ["slackblock", "block"],
]);

const ELEMENT_TAG_TO_TYPE = new Map([
  ["button", "button"],
  ["workflowbutton", "workflow_button"],
  ["image", "image"],
  ["overflow", "overflow"],
  ["datepicker", "datepicker"],
  ["dateinput", "datepicker"],
  ["timepicker", "timepicker"],
  ["timeinput", "timepicker"],
  ["datetimepicker", "datetimepicker"],
  ["datetimeinput", "datetimepicker"],
  ["plaintextinput", "plain_text_input"],
  ["textinput", "plain_text_input"],
  ["textarea", "plain_text_input"],
  ["input", "plain_text_input"],
  ["emailinput", "email_text_input"],
  ["emailtextinput", "email_text_input"],
  ["urlinput", "url_text_input"],
  ["urltextinput", "url_text_input"],
  ["numberinput", "number_input"],
  ["richtextinput", "rich_text_input"],
  ["staticselect", "static_select"],
  ["select", "static_select"],
  ["externalselect", "external_select"],
  ["usersselect", "users_select"],
  ["userselect", "users_select"],
  ["conversationsselect", "conversations_select"],
  ["conversationselect", "conversations_select"],
  ["channelsselect", "channels_select"],
  ["channelselect", "channels_select"],
  ["multistaticselect", "multi_static_select"],
  ["multiselect", "multi_static_select"],
  ["multiexternalselect", "multi_external_select"],
  ["multiusersselect", "multi_users_select"],
  ["multiuserselect", "multi_users_select"],
  ["multiconversationsselect", "multi_conversations_select"],
  ["multiconversationselect", "multi_conversations_select"],
  ["multichannelsselect", "multi_channels_select"],
  ["multichannelselect", "multi_channels_select"],
  ["checkboxes", "checkboxes"],
  ["checkbox", "checkboxes"],
  ["radiobuttons", "radio_buttons"],
  ["radiogroup", "radio_buttons"],
  ["radio", "radio_buttons"],
  ["element", "element"],
  ["rawelement", "element"],
  ["slackelement", "element"],
]);

const INTERNAL_PROPS = new Set([
  "name",
  "text",
  "children",
  "slackType",
  "type",
  "block",
  "blockKit",
  "payload",
  "element",
  "raw",
  "mrkdwn",
  "plainText",
  "textType",
  "textObject",
  "actions",
  "role",
  "label",
  "hint",
  "title",
  "description",
  "accessory",
]);

const PROP_ALIASES = {
  actionId: "action_id",
  blockId: "block_id",
  imageUrl: "image_url",
  src: "image_url",
  alt: "alt_text",
  altText: "alt_text",
  url: "url",
  href: "url",
  initialValue: "initial_value",
  initialDate: "initial_date",
  initialTime: "initial_time",
  initialDateTime: "initial_date_time",
  initialOption: "initial_option",
  initialOptions: "initial_options",
  initialUser: "initial_user",
  initialUsers: "initial_users",
  initialConversation: "initial_conversation",
  initialConversations: "initial_conversations",
  initialChannel: "initial_channel",
  initialChannels: "initial_channels",
  minLength: "min_length",
  maxLength: "max_length",
  maxSelectedItems: "max_selected_items",
  dispatchAction: "dispatch_action",
  dispatchActionConfig: "dispatch_action_config",
  focusOnLoad: "focus_on_load",
  optionGroups: "option_groups",
  responseUrlEnabled: "response_url_enabled",
  accessibilityLabel: "accessibility_label",
  threadTs: "thread_ts",
  unfurlLinks: "unfurl_links",
  unfurlMedia: "unfurl_media",
  iconEmoji: "icon_emoji",
  iconUrl: "icon_url",
  linkNames: "link_names",
  parseMode: "parse",
};

const MESSAGE_PROPS = new Set([
  "channel",
  "text",
  "threadTs",
  "thread_ts",
  "metadata",
  "unfurlLinks",
  "unfurl_links",
  "unfurlMedia",
  "unfurl_media",
  "username",
  "iconEmoji",
  "icon_emoji",
  "iconUrl",
  "icon_url",
  "linkNames",
  "link_names",
  "parseMode",
  "parse",
]);

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function flatten(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out);
  } else if (value != null && value !== false) {
    out.push(value);
  }
  return out;
}

function normalizeTag(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function propName(key) {
  return PROP_ALIASES[key] || key;
}

function getProp(node, ...keys) {
  const props = node?.props || {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(props, key) && props[key] != null) return props[key];
  }
  return undefined;
}

function hasProp(node, ...keys) {
  const props = node?.props || {};
  return keys.some((key) => Object.prototype.hasOwnProperty.call(props, key));
}

function cleanObject(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanObject(item))
      .filter((item) => item !== undefined && item !== null);
  }
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, oneValue] of Object.entries(value)) {
    const cleaned = cleanObject(oneValue);
    if (cleaned === undefined || cleaned === null) continue;
    if (typeof cleaned === "string" && cleaned.length === 0 && key !== "text") continue;
    out[key] = cleaned;
  }
  return out;
}

function warn(ctx, code, message, node) {
  const warning = {
    code,
    message,
    tag: node?.name,
  };
  if (ctx.strict) {
    const error = new Error(message);
    error.code = code;
    error.warning = warning;
    throw error;
  }
  ctx.warnings.push(warning);
}

function escapeSlackText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeSlackEntityPart(value) {
  return escapeSlackText(value).replace(/\|/g, "&#124;");
}

function isTextNode(node) {
  return node?.kind === TEXT_KIND;
}

function isElementNode(node) {
  return node?.kind === "element";
}

function createRenderedTree(ast, options) {
  const renderer = createUnitsRenderer({
    evalExpr: options.evalExpr,
    text: (value) => ({
      kind: TEXT_KIND,
      value: String(value ?? ""),
    }),
    fragment: (children) => flatten(children),
    element: (name, props, events, children) => ({
      kind: "element",
      name,
      props: props || {},
      events: events || {},
      children: flatten(children),
    }),
  });

  return flatten(renderer.render(ast, options.scope || {}, {
    slots: options.slots,
    set: options.set,
  }));
}

function isAstNode(value) {
  return isObject(value)
    && (value.type === "document" || value.type === "tag" || value.type === "text" || value.type === "expr" || value.type === "directive");
}

function parseInput(input, options) {
  if (typeof input === "string") {
    return {
      ast: (options.parseUnits || parseUnits)(input),
      parsed: true,
    };
  }
  if (isAstNode(input)) {
    return {
      ast: input,
      parsed: false,
    };
  }
  return {
    tree: input,
    parsed: false,
  };
}

function textObject(value, type = "mrkdwn", props = {}) {
  if (isObject(value) && typeof value.type === "string" && typeof value.text === "string") {
    return cleanObject(value);
  }
  const text = String(value ?? "");
  const normalizedType = props.plainText === true || type === "plain_text" ? "plain_text" : "mrkdwn";
  const out = {
    type: normalizedType,
    text,
  };
  if (normalizedType === "plain_text" && props.emoji != null) out.emoji = Boolean(props.emoji);
  if (normalizedType === "mrkdwn" && props.verbatim != null) out.verbatim = Boolean(props.verbatim);
  return cleanObject(out);
}

function plainTextObject(value, props = {}) {
  return textObject(value, "plain_text", props);
}

function textFromNode(node, ctx, mode = "mrkdwn") {
  const explicit = getProp(node, "text");
  if (explicit != null) return String(explicit);
  const name = getProp(node, "name");
  if (name != null && (!node.children || node.children.length === 0)) return String(name);
  if (mode === "plain_text") return childrenToPlainText(node.children || [], ctx);
  return childrenToMrkdwn(node.children || [], ctx);
}

function childrenToPlainText(children, ctx) {
  return flatten(children).map((child) => nodeToPlainText(child, ctx)).join("");
}

function nodeToPlainText(node, ctx) {
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return String(node);
  if (isTextNode(node)) return node.value;
  if (!isElementNode(node)) return "";
  const explicit = getProp(node, "text", "name");
  if (explicit != null && (!node.children || node.children.length === 0)) return String(explicit);
  return childrenToPlainText(node.children || [], ctx);
}

export function serializeSlackMrkdwn(value, options = {}) {
  const ctx = createContext(options);
  return childrenToMrkdwn(asArray(value), ctx);
}

function childrenToMrkdwn(children, ctx) {
  return flatten(children).map((child) => nodeToMrkdwn(child, ctx)).join("");
}

function nodeToMrkdwn(node, ctx) {
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return escapeSlackText(node);
  if (isTextNode(node)) return escapeSlackText(node.value);
  if (!isElementNode(node)) return "";

  const tag = normalizeTag(node.name);
  const body = () => {
    const explicit = getProp(node, "text");
    if (explicit != null) return String(explicit);
    const name = getProp(node, "name");
    if (name != null && (!node.children || node.children.length === 0)) return escapeSlackText(name);
    return childrenToMrkdwn(node.children || [], ctx);
  };
  const plain = () => {
    const explicit = getProp(node, "text", "name");
    if (explicit != null && (!node.children || node.children.length === 0)) return String(explicit);
    return childrenToPlainText(node.children || [], ctx);
  };

  if (tag === "text" || tag === "plaintext" || tag === "mrkdwn" || tag === "markdowntext") return body();
  if (tag === "strong" || tag === "bold") return `*${body()}*`;
  if (tag === "emphasis" || tag === "italic") return `_${body()}_`;
  if (tag === "strike" || tag === "strikethrough") return `~${body()}~`;
  if (tag === "code" || tag === "inlinecode") return `\`${plain().replace(/`/g, "'")}\``;
  if (tag === "pre" || tag === "codeblock") return `\`\`\`${plain().replace(/```/g, "'''")}\`\`\``;
  if (tag === "blockquote" || tag === "quote") {
    return body()
      .split(/\r?\n/)
      .map((line) => `>${line}`)
      .join("\n");
  }
  if (tag === "link") {
    const href = String(getProp(node, "href", "url") || "");
    const label = plain() || href;
    if (!href) return escapeSlackText(label);
    if (!label || label === href) return `<${escapeSlackEntityPart(href)}>`;
    return `<${escapeSlackEntityPart(href)}|${escapeSlackEntityPart(label)}>`;
  }
  if (tag === "mention" || tag === "user") {
    const userId = String(getProp(node, "userId", "id") || plain()).replace(/^@/, "");
    return userId ? `<@${escapeSlackEntityPart(userId)}>` : body();
  }
  if (tag === "channel") {
    const channelId = String(getProp(node, "channelId", "id") || plain()).replace(/^#/, "");
    const label = String(getProp(node, "label", "name") || "").replace(/^#/, "");
    if (!channelId) return body();
    return label ? `<#${escapeSlackEntityPart(channelId)}|${escapeSlackEntityPart(label)}>` : `<#${escapeSlackEntityPart(channelId)}>`;
  }
  if (tag === "usergroup") {
    const userGroupId = String(getProp(node, "userGroupId", "subteamId", "id") || plain()).replace(/^@/, "");
    const label = String(getProp(node, "label", "name") || "").replace(/^@/, "");
    if (!userGroupId) return body();
    return label ? `<!subteam^${escapeSlackEntityPart(userGroupId)}|${escapeSlackEntityPart(label)}>` : `<!subteam^${escapeSlackEntityPart(userGroupId)}>`;
  }
  if (tag === "specialmention" || tag === "special") {
    const raw = String(getProp(node, "special", "mention", "name", "type") || plain() || "here")
      .replace(/^[@!]/, "")
      .toLowerCase();
    const special = raw === "channel" || raw === "everyone" || raw === "here" ? raw : "here";
    return `<!${special}>`;
  }
  if (tag === "date") {
    const timestamp = String(getProp(node, "timestamp", "ts") || "");
    const format = String(getProp(node, "format") || "{date_short_pretty}");
    const link = getProp(node, "href", "url", "link");
    const fallback = String(getProp(node, "fallback", "name") || plain() || timestamp);
    if (!timestamp) return escapeSlackText(fallback);
    const linkPart = link ? `^${escapeSlackEntityPart(link)}` : "";
    return `<!date^${escapeSlackEntityPart(timestamp)}^${format}${linkPart}|${escapeSlackEntityPart(fallback)}>`;
  }
  if (tag === "emoji") {
    const name = String(getProp(node, "name", "emoji") || plain()).replace(/^:/, "").replace(/:$/, "");
    return name ? `:${name}:` : "";
  }

  return body();
}

function createContext(options = {}) {
  return {
    strict: Boolean(options.strict),
    warnings: [],
    fallbackText: options.fallbackText,
  };
}

function rawPayload(node) {
  const raw = getProp(node, "blockKit", "payload", "block", "element", "raw");
  return isObject(raw) ? cleanObject(raw) : null;
}

function copySlackProps(props, out, options = {}) {
  const omit = options.omit || INTERNAL_PROPS;
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null) continue;
    if (omit.has(key)) continue;
    const target = propName(key);
    if (Object.prototype.hasOwnProperty.call(out, target)) continue;
    out[target] = normalizeSlackValue(target, value);
  }
}

function normalizeSlackValue(key, value) {
  if (value == null) return value;
  if (key === "text" || key === "label" || key === "hint" || key === "title" || key === "placeholder") {
    return textObject(value, key === "text" ? "mrkdwn" : "plain_text");
  }
  if (key === "confirm") return normalizeConfirm(value);
  if (key === "options") return asArray(value).map((option) => normalizeOption(option));
  if (key === "option_groups") return asArray(value).map((group) => normalizeOptionGroup(group));
  if (key === "initial_option") return normalizeOption(value);
  if (key === "initial_options") return asArray(value).map((option) => normalizeOption(option));
  return value;
}

function normalizeConfirm(value) {
  if (!isObject(value)) return value;
  const out = { ...value };
  if (out.title != null) out.title = plainTextObject(out.title);
  if (out.text != null) out.text = textObject(out.text, "mrkdwn");
  if (out.confirm != null) out.confirm = plainTextObject(out.confirm);
  if (out.deny != null) out.deny = plainTextObject(out.deny);
  return cleanObject(out);
}

function normalizeOption(option) {
  if (!isObject(option)) {
    const text = String(option ?? "");
    return {
      text: plainTextObject(text),
      value: text,
    };
  }
  const out = { ...option };
  out.text = textObject(out.text || out.label || out.name || out.value || "", out.text?.type || "plain_text");
  if (out.description != null) out.description = plainTextObject(out.description);
  delete out.label;
  delete out.name;
  return cleanObject(out);
}

function normalizeOptionGroup(group) {
  if (!isObject(group)) return group;
  return cleanObject({
    ...group,
    label: plainTextObject(group.label || group.name || ""),
    options: asArray(group.options).map((option) => normalizeOption(option)),
  });
}

function textObjectFromNode(node, ctx, defaultType = "mrkdwn") {
  const explicit = getProp(node, "textObject");
  if (explicit) return textObject(explicit, defaultType, node.props || {});
  const type = getProp(node, "textType")
    || (getProp(node, "plainText") === true ? "plain_text" : defaultType);
  const value = type === "plain_text"
    ? textFromNode(node, ctx, "plain_text")
    : textFromNode(node, ctx, "mrkdwn");
  return textObject(value, type, node.props || {});
}

function blockIdProps(node, out) {
  const blockId = getProp(node, "blockId", "id");
  if (blockId != null) out.block_id = String(blockId);
}

function isElementCandidate(node) {
  if (!isElementNode(node)) return false;
  const tag = normalizeTag(node.name);
  if (ELEMENT_TAG_TO_TYPE.has(tag)) return true;
  const explicitType = getProp(node, "slackType", "type");
  if (!explicitType) return false;
  return !isKnownBlockType(String(explicitType));
}

function isInlineCandidate(node) {
  return isTextNode(node) || (isElementNode(node) && INLINE_TAGS.has(normalizeTag(node.name)));
}

function isKnownBlockType(value) {
  return [
    "section",
    "markdown",
    "header",
    "context",
    "actions",
    "divider",
    "image",
    "input",
    "file",
    "video",
    "rich_text",
  ].includes(String(value || "").toLowerCase());
}

function nodeToBlocks(node, ctx) {
  if (isTextNode(node)) {
    const text = escapeSlackText(node.value).trim();
    return text ? [{ type: "section", text: textObject(text, "mrkdwn") }] : [];
  }
  if (!isElementNode(node)) return [];

  const tag = normalizeTag(node.name);
  if (MESSAGE_TAGS.has(tag) || ROOT_TAGS.has(tag)) return childrenToBlocks(node.children || [], ctx);

  const raw = rawPayload(node);
  if (raw && raw.type) return [raw];

  const explicitType = String(getProp(node, "slackType", "type") || "").toLowerCase();
  const blockType = explicitType && isKnownBlockType(explicitType)
    ? explicitType
    : BLOCK_TAG_TO_TYPE.get(tag);

  if (blockType === "section") return [sectionBlock(node, ctx)];
  if (blockType === "markdown") return [markdownBlock(node, ctx)];
  if (blockType === "header") return [headerBlock(node, ctx)];
  if (blockType === "context") return [contextBlock(node, ctx)];
  if (blockType === "actions") return [actionsBlock(node, ctx)];
  if (blockType === "divider") return [dividerBlock(node)];
  if (blockType === "image") return [imageBlock(node, ctx)];
  if (blockType === "input") return [inputBlock(node, ctx)];
  if (blockType === "file") return [genericBlock(node, "file", ctx)];
  if (blockType === "video") return [videoBlock(node, ctx)];
  if (blockType === "rich_text") return [genericBlock(node, "rich_text", ctx)];
  if (blockType === "block") return [genericBlock(node, explicitType || getProp(node, "blockType") || "section", ctx)];

  if (isInlineCandidate(node)) {
    const text = nodeToMrkdwn(node, ctx).trim();
    return text ? [{ type: "section", text: textObject(text, "mrkdwn") }] : [];
  }

  const childBlocks = childrenToBlocks(node.children || [], ctx);
  if (childBlocks.length > 0) return childBlocks;

  warn(ctx, "unsupported_block", `Unsupported Slack block tag: ${node.name}`, node);
  return [];
}

function childrenToBlocks(children, ctx) {
  return flatten(children).flatMap((child) => nodeToBlocks(child, ctx)).filter(Boolean);
}

function sectionBlock(node, ctx) {
  const block = { type: "section" };
  blockIdProps(node, block);

  const textChildren = [];
  const fields = [];
  let accessory = null;

  for (const child of node.children || []) {
    if (isElementNode(child) && normalizeTag(child.name) === "field") {
      fields.push(textObjectFromNode(child, ctx, "mrkdwn"));
      continue;
    }
    if (!accessory && isElementCandidate(child) && !isInlineCandidate(child)) {
      accessory = nodeToElement(child, ctx);
      continue;
    }
    textChildren.push(child);
  }

  const explicitFields = getProp(node, "fields");
  if (explicitFields != null) {
    fields.push(...asArray(explicitFields).map((field) => textObject(field, "mrkdwn")));
  }

  const text = getProp(node, "text") != null
    ? String(getProp(node, "text"))
    : childrenToMrkdwn(textChildren, ctx);
  if (text) block.text = textObject(text, "mrkdwn", node.props || {});
  if (fields.length > 0) block.fields = fields;
  if (accessory) block.accessory = accessory;
  if (!block.text && !block.fields) {
    warn(ctx, "empty_section", "Slack section blocks need text or fields.", node);
  }
  copySlackProps(node.props, block);
  return cleanObject(block);
}

function markdownBlock(node, ctx) {
  const block = {
    type: "markdown",
    text: getProp(node, "text") != null ? String(getProp(node, "text")) : childrenToMrkdwn(node.children || [], ctx),
  };
  blockIdProps(node, block);
  copySlackProps(node.props, block);
  return cleanObject(block);
}

function headerBlock(node, ctx) {
  const block = {
    type: "header",
    text: plainTextObject(textFromNode(node, ctx, "plain_text"), node.props || {}),
  };
  blockIdProps(node, block);
  copySlackProps(node.props, block);
  return cleanObject(block);
}

function contextBlock(node, ctx) {
  const block = { type: "context", elements: [] };
  blockIdProps(node, block);

  let buffered = [];
  const flush = () => {
    if (buffered.length === 0) return;
    const text = childrenToMrkdwn(buffered, ctx);
    if (text) block.elements.push(textObject(text, "mrkdwn"));
    buffered = [];
  };

  for (const child of node.children || []) {
    if (isElementNode(child) && normalizeTag(child.name) === "image") {
      flush();
      const image = imageElement(child, ctx);
      if (image) block.elements.push(image);
      continue;
    }
    if (isElementNode(child) && (normalizeTag(child.name) === "plaintext" || normalizeTag(child.name) === "mrkdwn")) {
      flush();
      block.elements.push(textObjectFromNode(child, ctx, normalizeTag(child.name) === "plaintext" ? "plain_text" : "mrkdwn"));
      continue;
    }
    buffered.push(child);
  }
  flush();

  if (block.elements.length === 0 && getProp(node, "text") != null) {
    block.elements.push(textObject(String(getProp(node, "text")), "mrkdwn"));
  }
  if (block.elements.length === 0) warn(ctx, "empty_context", "Slack context blocks need at least one text or image element.", node);
  copySlackProps(node.props, block);
  return cleanObject(block);
}

function actionsBlock(node, ctx) {
  const block = {
    type: "actions",
    elements: [],
  };
  blockIdProps(node, block);

  const explicitElements = getProp(node, "elements");
  if (explicitElements != null) block.elements.push(...asArray(explicitElements).map((element) => cleanObject(element)));

  for (const child of node.children || []) {
    const element = nodeToElement(child, ctx);
    if (element) block.elements.push(element);
  }

  if (block.elements.length === 0) warn(ctx, "empty_actions", "Slack actions blocks need at least one element.", node);
  copySlackProps(node.props, block);
  return cleanObject(block);
}

function dividerBlock(node) {
  const block = { type: "divider" };
  blockIdProps(node, block);
  copySlackProps(node.props, block);
  return cleanObject(block);
}

function imageBlock(node, ctx) {
  const block = {
    type: "image",
    image_url: String(getProp(node, "src", "imageUrl", "url") || ""),
    alt_text: String(getProp(node, "alt", "altText", "name") || textFromNode(node, ctx, "plain_text") || "image"),
  };
  const title = getProp(node, "title");
  if (title != null) block.title = plainTextObject(title);
  blockIdProps(node, block);
  copySlackProps(node.props, block);
  if (!block.image_url) warn(ctx, "missing_image_url", "Slack image blocks need src/imageUrl/url.", node);
  return cleanObject(block);
}

function inputBlock(node, ctx) {
  const block = {
    type: "input",
    label: plainTextObject(getProp(node, "label") || getProp(node, "name") || "Input"),
  };
  blockIdProps(node, block);

  let element = null;
  let hint = getProp(node, "hint");
  let label = getProp(node, "label");

  for (const child of node.children || []) {
    if (isElementNode(child) && normalizeTag(child.name) === "label") {
      label = textFromNode(child, ctx, "plain_text");
      continue;
    }
    if (isElementNode(child) && normalizeTag(child.name) === "hint") {
      hint = textFromNode(child, ctx, "plain_text");
      continue;
    }
    if (!element && isElementCandidate(child)) {
      element = nodeToElement(child, ctx);
    }
  }

  if (label != null) block.label = plainTextObject(label);
  if (hint != null) block.hint = plainTextObject(hint);
  if (!element) element = nodeToElement({ ...node, name: "PlainTextInput", children: [] }, ctx);
  if (element) block.element = element;
  else warn(ctx, "missing_input_element", "Slack input blocks need an element.", node);

  copySlackProps(node.props, block);
  return cleanObject(block);
}

function videoBlock(node, ctx) {
  const block = {
    type: "video",
    video_url: String(getProp(node, "videoUrl", "url", "href") || ""),
    thumbnail_url: String(getProp(node, "thumbnailUrl", "thumbnail", "src") || ""),
    alt_text: String(getProp(node, "alt", "altText", "name") || textFromNode(node, ctx, "plain_text") || "video"),
    title: plainTextObject(getProp(node, "title", "name") || textFromNode(node, ctx, "plain_text") || "Video"),
  };
  blockIdProps(node, block);
  copySlackProps(node.props, block);
  return cleanObject(block);
}

function genericBlock(node, type, ctx) {
  const raw = rawPayload(node);
  if (raw) return raw;
  const block = {
    type: String(type || getProp(node, "slackType", "type") || "section"),
  };
  blockIdProps(node, block);
  const text = textFromNode(node, ctx, block.type === "header" ? "plain_text" : "mrkdwn");
  if (text && block.type !== "divider" && block.type !== "rich_text") {
    block.text = block.type === "header" ? plainTextObject(text) : textObject(text, "mrkdwn");
  }
  copySlackProps(node.props, block);
  return cleanObject(block);
}

function nodeToElement(node, ctx) {
  if (!isElementNode(node)) return null;
  const raw = rawPayload(node);
  if (raw) return raw;

  const tag = normalizeTag(node.name);
  const explicitType = String(getProp(node, "slackType", "type") || "").toLowerCase();
  const elementType = explicitType && !isKnownBlockType(explicitType)
    ? explicitType
    : ELEMENT_TAG_TO_TYPE.get(tag);

  if (!elementType) {
    if (isInlineCandidate(node)) return null;
    warn(ctx, "unsupported_element", `Unsupported Slack element tag: ${node.name}`, node);
    return null;
  }

  if (elementType === "button" || elementType === "workflow_button") return buttonElement(node, ctx, elementType);
  if (elementType === "image") return imageElement(node, ctx);
  return genericElement(node, ctx, elementType);
}

function buttonElement(node, ctx, type) {
  const element = {
    type,
    text: plainTextObject(getProp(node, "text", "name") || childrenToPlainText(node.children || [], ctx) || "Button"),
  };
  const actionId = getProp(node, "actionId", "id");
  if (actionId != null) element.action_id = String(actionId);
  const value = getProp(node, "value");
  if (value != null) element.value = String(value);
  const style = getProp(node, "style");
  if (style != null) element.style = String(style);
  const url = getProp(node, "url", "href");
  if (url != null) element.url = String(url);
  copySlackProps(node.props, element);
  return cleanObject(element);
}

function imageElement(node, ctx) {
  const element = {
    type: "image",
    image_url: String(getProp(node, "src", "imageUrl", "url") || ""),
    alt_text: String(getProp(node, "alt", "altText", "name") || childrenToPlainText(node.children || [], ctx) || "image"),
  };
  copySlackProps(node.props, element);
  if (!element.image_url) warn(ctx, "missing_image_url", "Slack image elements need src/imageUrl/url.", node);
  return cleanObject(element);
}

function genericElement(node, ctx, type) {
  const element = { type };
  const actionId = getProp(node, "actionId", "id");
  if (actionId != null) element.action_id = String(actionId);

  const placeholder = getProp(node, "placeholder");
  if (placeholder != null) element.placeholder = plainTextObject(placeholder);

  const text = getProp(node, "text", "name");
  if (text != null && (type === "overflow" || type === "checkboxes" || type === "radio_buttons")) {
    element.text = plainTextObject(text);
  }

  copySlackProps(node.props, element);

  if (type.includes("select") || type === "overflow" || type === "checkboxes" || type === "radio_buttons") {
    const options = getProp(node, "options");
    if (options != null) element.options = asArray(options).map((option) => normalizeOption(option));
  }

  if (type === "plain_text_input") {
    const initial = getProp(node, "value", "initialValue");
    if (initial != null && element.initial_value == null) element.initial_value = String(initial);
    if (hasProp(node, "multiline")) element.multiline = Boolean(getProp(node, "multiline"));
  }

  return cleanObject(element);
}

function messageProps(root, ctx, blocks) {
  const payload = { blocks };
  const props = root?.props || {};
  for (const [key, value] of Object.entries(props)) {
    if (!MESSAGE_PROPS.has(key) || value == null) continue;
    const target = propName(key);
    payload[target] = value;
  }
  if (!payload.text && ctx.fallbackText) payload.text = ctx.fallbackText;
  if (!payload.text && root) {
    const fallback = textFromNode(root, ctx, "plain_text").trim();
    if (fallback) payload.text = fallback.slice(0, 4000);
  }
  return cleanObject(payload);
}

function splitRenderedRoot(tree) {
  const roots = flatten(tree);
  if (roots.length === 1 && isElementNode(roots[0])) return roots[0];
  return null;
}

export function compileUnitsToSlackBlockKit(input, options = {}) {
  const ctx = createContext(options);
  const parsed = parseInput(input, options);
  const tree = parsed.tree || createRenderedTree(parsed.ast, options);
  const root = splitRenderedRoot(tree);
  const rootTag = normalizeTag(root?.name);
  const blocks = root && (MESSAGE_TAGS.has(rootTag) || ROOT_TAGS.has(rootTag))
    ? childrenToBlocks(root.children || [], ctx)
    : childrenToBlocks(tree, ctx);
  const payload = messageProps(root && MESSAGE_TAGS.has(rootTag) ? root : null, ctx, blocks);

  return {
    payload,
    blocks,
    ast: parsed.ast,
    tree,
    warnings: ctx.warnings,
  };
}

export function unitsToSlackBlockKit(input, options = {}) {
  return compileUnitsToSlackBlockKit(input, options).payload;
}

export function unitsAstToSlackBlockKit(ast, options = {}) {
  return compileUnitsToSlackBlockKit(ast, options).payload;
}

export function unitsTreeToSlackBlockKit(tree, options = {}) {
  return compileUnitsToSlackBlockKit(tree, options).payload;
}

export function parseUnitsToSlackBlockKit(source, options = {}) {
  return compileUnitsToSlackBlockKit(String(source ?? ""), options);
}

export default unitsToSlackBlockKit;
