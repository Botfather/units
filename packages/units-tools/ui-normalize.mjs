let uiIrMod;
let reactAdapterMod;

try {
  uiIrMod = await import("@botfather/units-ui-ir");
} catch {
  // Monorepo fallback for direct node execution without workspace linking.
  uiIrMod = await import("../units-ui-ir/index.js");
}

try {
  reactAdapterMod = await import("@botfather/units-react-adapter");
} catch {
  // Monorepo fallback for direct node execution without workspace linking.
  reactAdapterMod = await import("../units-react-adapter/index.js");
}

const normalizeDomTree = uiIrMod.normalizeDomTree || uiIrMod.normalizeDomUiTree;
const normalizeA11yTree = uiIrMod.normalizeA11yTree || uiIrMod.normalizeA11yUiTree;
const normalizeIrNode = uiIrMod.normalizeIrNode || uiIrMod.normalizeUiNode;
const serializeAgentTree = uiIrMod.serializeAgentTree || uiIrMod.serializeCompactUiTree;
const normalizeReactTree = reactAdapterMod.normalizeReactTree || ((tree) => normalizeIrNode(tree));

export function normalizeSourceType(sourceType, fallback = "dom") {
  const text = String(sourceType || fallback).toLowerCase();
  if (!text) return fallback;
  if (text === "accessibility" || text === "ax") return "a11y";
  if (text === "jsx") return "react";
  return text;
}

export function runtimeSourceType(sourceType, fallback = "dom") {
  const normalized = normalizeSourceType(sourceType, fallback);
  if (normalized === "react") return "ir";
  return normalized;
}

export function normalizeUiInputTree(sourceType, tree) {
  const normalized = normalizeSourceType(sourceType, "dom");
  if (normalized === "dom") return normalizeDomTree(tree);
  if (normalized === "a11y") return normalizeA11yTree(tree);
  if (normalized === "react") return normalizeReactTree(tree);
  return normalizeIrNode(tree);
}

export {
  normalizeDomTree,
  normalizeA11yTree,
  normalizeIrNode,
  normalizeReactTree,
  serializeAgentTree,
};
