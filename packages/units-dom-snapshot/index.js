function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function copyDataset(node) {
  if (!node || !isObject(node.dataset)) return {};
  return { ...node.dataset };
}

function collectClassNames(node) {
  if (!node) return [];
  if (node.classList && typeof node.classList[Symbol.iterator] === "function") {
    return [...node.classList].map((one) => String(one)).filter(Boolean);
  }
  if (typeof node.className === "string") {
    return node.className.split(/\s+/).map((one) => one.trim()).filter(Boolean);
  }
  return [];
}

function attrReader(node) {
  if (!node) return () => null;
  if (typeof node.getAttribute === "function") {
    return (name) => node.getAttribute(name);
  }
  if (isObject(node.attributes)) {
    return (name) => {
      const raw = node.attributes[name];
      return raw == null ? null : String(raw);
    };
  }
  return () => null;
}

function listAttributeNames(node) {
  if (!node) return [];
  if (Array.isArray(node.attributes)) {
    return node.attributes
      .map((one) => one?.name)
      .filter(Boolean)
      .map((name) => String(name));
  }
  if (isObject(node.attributes)) {
    return Object.keys(node.attributes);
  }
  return [];
}

function inferRole(tag, readAttr) {
  const explicitRole = normalizeWhitespace(readAttr("role")).toLowerCase();
  if (explicitRole) return explicitRole;
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "input" || tag === "textarea" || tag === "select") return "input";
  if (tag === "form") return "form";
  if (tag === "img") return "image";
  if (tag === "label") return "label";
  return "";
}

function inferInteractions(tag, role, readAttr, node) {
  const hasHref = normalizeWhitespace(readAttr("href")) !== "";
  const type = normalizeWhitespace(readAttr("type")).toLowerCase();
  const onClickAttr = normalizeWhitespace(readAttr("onclick")) !== "";
  const hasOnClickProp = typeof node?.onclick === "function";
  const hasTabIndex = normalizeWhitespace(readAttr("tabindex")) !== "";

  const clickable = ["button", "link", "menuitem", "tab"].includes(role)
    || tag === "button"
    || (tag === "a" && hasHref)
    || ["button", "submit", "reset"].includes(type)
    || onClickAttr
    || hasOnClickProp
    || hasTabIndex;

  const input = tag === "input"
    || tag === "textarea"
    || tag === "select"
    || normalizeWhitespace(readAttr("contenteditable")) === "true"
    || role === "textbox";

  const link = role === "link" || (tag === "a" && hasHref);
  const form = role === "form" || tag === "form";

  return { clickable, input, link, form };
}

function styleFromNode(node, options) {
  const styleReader = typeof options.getComputedStyle === "function"
    ? options.getComputedStyle
    : null;

  const style = styleReader ? styleReader(node) : null;

  const display = normalizeWhitespace(style?.display || node?.style?.display || "");
  const visibility = normalizeWhitespace(style?.visibility || node?.style?.visibility || "");
  const opacity = normalizeWhitespace(style?.opacity || node?.style?.opacity || "");

  return {
    display,
    visibility,
    opacity,
  };
}

function rectFromNode(node, options) {
  const rectReader = typeof options.getBoundingClientRect === "function"
    ? options.getBoundingClientRect
    : node && typeof node.getBoundingClientRect === "function"
      ? (target) => target.getBoundingClientRect()
      : null;

  if (!rectReader) {
    return {
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    };
  }

  const rect = rectReader(node) || {};
  return {
    top: toNumber(rect.top, 0),
    left: toNumber(rect.left, 0),
    right: toNumber(rect.right, 0),
    bottom: toNumber(rect.bottom, 0),
    width: toNumber(rect.width, 0),
    height: toNumber(rect.height, 0),
  };
}

function viewportSize(options) {
  const width = toNumber(options.viewportWidth, 0);
  const height = toNumber(options.viewportHeight, 0);
  return {
    width: width > 0 ? width : Number.POSITIVE_INFINITY,
    height: height > 0 ? height : Number.POSITIVE_INFINITY,
  };
}

function isModal(role, readAttr) {
  const ariaModal = normalizeWhitespace(readAttr("aria-modal")).toLowerCase();
  return role === "dialog" || role === "alertdialog" || ariaModal === "true";
}

function shouldPruneInvisible(styleSummary, readAttr) {
  if (normalizeWhitespace(readAttr("aria-hidden")).toLowerCase() === "true") return true;
  const display = styleSummary.display.toLowerCase();
  const visibility = styleSummary.visibility.toLowerCase();
  const opacity = styleSummary.opacity.toLowerCase();

  if (display === "none") return true;
  if (visibility === "hidden" || visibility === "collapse") return true;
  if (opacity !== "" && toNumber(opacity, 1) <= 0) return true;
  return false;
}

function isOffscreen(rect, viewport) {
  if (rect.width <= 0 && rect.height <= 0) return true;
  if (rect.right < 0 || rect.bottom < 0) return true;
  if (rect.left > viewport.width || rect.top > viewport.height) return true;
  return false;
}

function isScriptLikeTag(tag) {
  return tag === "script" || tag === "style" || tag === "noscript" || tag === "template";
}

function isElementNode(node) {
  return Boolean(node && (node.nodeType === 1 || (node.tagName && node.nodeType == null)));
}

function isTextNode(node) {
  return Boolean(node && node.nodeType === 3);
}

function childNodesOf(node) {
  if (!node) return [];
  if (Array.isArray(node.childNodes)) return node.childNodes;
  if (Array.isArray(node.children)) return node.children;
  return [];
}

function collectAria(readAttr, attrNames) {
  const out = {};
  for (const name of attrNames) {
    if (!name || !String(name).toLowerCase().startsWith("aria-")) continue;
    const value = readAttr(name);
    if (value == null || value === "") continue;
    out[name] = String(value);
  }
  return out;
}

function buildAttributeSubset(tag, readAttr, role, classes) {
  const attrs = {};

  if (tag) attrs.tagName = tag;
  if (role) attrs.role = role;

  const keys = ["id", "name", "href", "type", "value", "placeholder", "title", "alt", "for", "aria-label", "aria-modal"];
  for (const key of keys) {
    const value = readAttr(key);
    if (value == null || value === "") continue;
    attrs[key] = String(value);
  }

  if (classes.length > 0) {
    attrs.class = classes.join(" ");
  }

  return attrs;
}

function isPureLayoutWrapper(tag, role, interactions, textContent, children, aria, dataset) {
  const layoutTags = new Set(["div", "span", "section", "article", "main", "header", "footer", "aside", "nav"]);
  if (!layoutTags.has(tag)) return false;
  if (role) return false;
  if (interactions.clickable || interactions.input || interactions.link || interactions.form) return false;
  if (textContent) return false;
  if (Object.keys(aria).length > 0) return false;
  if (Object.keys(dataset).length > 0) return false;
  if (children.length === 0) return true;
  if (children.length === 1) return true;
  return false;
}

export function snapshotUiFromRoot(root, options = {}) {
  const config = {
    maxDepth: Number.isFinite(Number(options.maxDepth)) ? Math.max(1, Number(options.maxDepth)) : 40,
    pruneInvisible: options.pruneInvisible !== false,
    pruneOffscreen: options.pruneOffscreen !== false,
    keepModalOffscreen: options.keepModalOffscreen !== false,
    pruneLayoutWrappers: options.pruneLayoutWrappers !== false,
    includeStyleSummary: options.includeStyleSummary !== false,
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight,
    getComputedStyle: options.getComputedStyle,
    getBoundingClientRect: options.getBoundingClientRect,
  };

  const viewport = viewportSize(config);

  function walk(node, depth) {
    if (!node) return [];
    if (depth > config.maxDepth) return [];

    if (isTextNode(node)) {
      const text = normalizeWhitespace(node.textContent || node.nodeValue || "");
      if (!text) return [];
      return [{
        type: "text",
        tag: "#text",
        tagName: "text",
        textContent: text,
      }];
    }

    if (!isElementNode(node)) return [];

    const tag = normalizeWhitespace(node.tagName || node.nodeName || "").toLowerCase();
    if (!tag) return [];
    if (isScriptLikeTag(tag)) return [];

    const readAttr = attrReader(node);
    const attrNames = listAttributeNames(node);
    const role = inferRole(tag, readAttr);
    const modal = isModal(role, readAttr);

    const styleSummary = styleFromNode(node, config);
    if (config.pruneInvisible && shouldPruneInvisible(styleSummary, readAttr)) return [];

    const rect = rectFromNode(node, config);
    if (config.pruneOffscreen && !(config.keepModalOffscreen && modal) && isOffscreen(rect, viewport)) {
      return [];
    }

    const classes = collectClassNames(node);
    const dataset = copyDataset(node);
    const interactions = inferInteractions(tag, role, readAttr, node);
    const textContent = normalizeWhitespace(node.textContent || "");

    const children = [];
    for (const child of toArray(childNodesOf(node))) {
      const walked = walk(child, depth + 1);
      if (walked.length > 0) children.push(...walked);
    }

    const aria = collectAria(readAttr, attrNames);

    if (config.pruneLayoutWrappers && isPureLayoutWrapper(tag, role, interactions, textContent, children, aria, dataset)) {
      return children;
    }

    const out = {
      type: "element",
      tag,
      tagName: tag,
      role,
      aria,
      dataset,
      classes,
      styleSummary: config.includeStyleSummary ? styleSummary : undefined,
      interactions,
      textContent,
      attributes: buildAttributeSubset(tag, readAttr, role, classes),
      children,
    };

    if (!config.includeStyleSummary) {
      delete out.styleSummary;
    }

    return [out];
  }

  const walked = walk(root, 0);

  if (walked.length === 0) return null;
  if (walked.length === 1) return walked[0];

  return {
    type: "element",
    tag: "root",
    tagName: "root",
    role: "root",
    aria: {},
    dataset: {},
    classes: [],
    styleSummary: config.includeStyleSummary
      ? {
        display: "block",
        visibility: "visible",
        opacity: "1",
      }
      : undefined,
    interactions: {
      clickable: false,
      input: false,
      link: false,
      form: false,
    },
    textContent: "",
    attributes: {
      tagName: "root",
      role: "root",
    },
    children: walked,
  };
}

export function snapshotUi(options = {}) {
  const doc = options.documentRef || (typeof document !== "undefined" ? document : null);
  const win = options.windowRef || (typeof window !== "undefined" ? window : null);

  if (!doc || !win) {
    throw new Error("snapshotUi must run in a browser context (window + document). Use snapshotUiFromRoot for custom roots.");
  }

  const rootSelector = normalizeWhitespace(options.rootSelector || "");
  const root = rootSelector ? doc.querySelector(rootSelector) : doc.body;
  if (!root) return null;

  return snapshotUiFromRoot(root, {
    ...options,
    viewportWidth: options.viewportWidth ?? win.innerWidth,
    viewportHeight: options.viewportHeight ?? win.innerHeight,
    getComputedStyle: options.getComputedStyle || ((node) => win.getComputedStyle(node)),
    getBoundingClientRect: options.getBoundingClientRect || ((node) => node.getBoundingClientRect()),
  });
}

export async function captureSnapshotWithPlaywright(options = {}) {
  const playwrightModuleName = options.playwrightModule || "playwright";

  let playwright;
  try {
    playwright = await import(playwrightModuleName);
  } catch (err) {
    throw new Error(
      `Playwright module \"${playwrightModuleName}\" is not available. Install it with \"npm i ${playwrightModuleName}\". (${err?.message || err})`,
    );
  }

  const browserType = options.browserType || "chromium";
  const engine = playwright?.[browserType];
  if (!engine || typeof engine.launch !== "function") {
    throw new Error(`Unsupported browserType \"${browserType}\".`);
  }

  const url = String(options.url || "").trim();
  if (!url && !options.page) {
    throw new Error("captureSnapshotWithPlaywright requires either options.url or an existing options.page.");
  }

  const reusePage = Boolean(options.page);
  const rootSelector = options.rootSelector || "body";
  const snapshotOptions = options.snapshotOptions && isObject(options.snapshotOptions)
    ? options.snapshotOptions
    : {};

  const functionSource = snapshotUiFromRoot.toString();

  let browser = null;
  let context = null;
  let page = options.page || null;

  try {
    if (!reusePage) {
      browser = await engine.launch(options.launchOptions || {});
      context = await browser.newContext(options.contextOptions || {});
      page = await context.newPage(options.pageOptions || {});
      await page.goto(url, {
        waitUntil: options.waitUntil || "domcontentloaded",
        ...(options.gotoOptions || {}),
      });
    }

    const snapshot = await page.evaluate(
      ({ selector, opts, source }) => {
        const root = selector ? document.querySelector(selector) : document.body;
        if (!root) return null;
        const build = (0, eval)(`(${source})`);
        return build(root, {
          ...opts,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          getComputedStyle: (node) => window.getComputedStyle(node),
          getBoundingClientRect: (node) => node.getBoundingClientRect(),
        });
      },
      {
        selector: rootSelector,
        opts: snapshotOptions,
        source: functionSource,
      },
    );

    return {
      snapshot,
      metadata: {
        url: page.url(),
        browserType,
        rootSelector,
      },
    };
  } finally {
    if (!reusePage) {
      if (context) await context.close();
      if (browser) await browser.close();
    }
  }
}
