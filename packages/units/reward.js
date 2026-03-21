import { serializeAgentTree } from "./tree-ir.js";

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function tokenizeText(value) {
  const text = String(value || "").toLowerCase();
  return text.match(/[a-z0-9_]+/g) || [];
}

function addCount(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function multisetFromTokens(tokens) {
  const out = new Map();
  for (const token of tokens) addCount(out, token);
  return out;
}

function overlapCount(left, right) {
  let total = 0;
  for (const [key, leftCount] of left.entries()) {
    const rightCount = right.get(key) || 0;
    total += Math.min(leftCount, rightCount);
  }
  return total;
}

function f1FromTokenLists(expectedTokens, actualTokens) {
  const expected = multisetFromTokens(expectedTokens);
  const actual = multisetFromTokens(actualTokens);

  const expectedCount = expectedTokens.length;
  const actualCount = actualTokens.length;

  if (expectedCount === 0 && actualCount === 0) return 1;
  if (expectedCount === 0 || actualCount === 0) return 0;

  const overlap = overlapCount(expected, actual);
  const precision = overlap / actualCount;
  const recall = overlap / expectedCount;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function recall(expectedSet, actualSet) {
  const expectedSize = expectedSet.size;
  if (expectedSize === 0) return 1;

  let matched = 0;
  for (const value of expectedSet) {
    if (actualSet.has(value)) matched++;
  }
  return matched / expectedSize;
}

function countNodes(tree) {
  if (!tree) return 0;
  let total = 1;
  for (const child of tree.children || []) {
    total += countNodes(child);
  }
  return total;
}

function maxDepth(tree) {
  if (!tree) return 0;
  let depth = 1;
  for (const child of tree.children || []) {
    depth = Math.max(depth, 1 + maxDepth(child));
  }
  return depth;
}

function estimateTokens(value) {
  const src = String(value || "");
  if (!src) return 0;
  const rough = Math.ceil(src.length / 4);
  const chunks = src.match(/[A-Za-z0-9_]+|[^\s]/g) || [];
  return Math.ceil((rough + chunks.length) / 2);
}

function collectProfile(tree) {
  const actions = new Set();
  const names = new Set();
  const states = new Set();
  const textTokens = [];

  function visit(node) {
    if (!node) return;

    if (node.name) names.add(String(node.name));
    if (node.text) {
      const tokens = tokenizeText(node.text);
      for (const token of tokens) textTokens.push(token);
    }

    for (const action of asArray(node.actions)) {
      if (action) actions.add(String(action));
    }

    if (node.state && typeof node.state === "object") {
      for (const [key, value] of Object.entries(node.state)) {
        states.add(`${key}:${String(value)}`);
      }
    }

    for (const child of node.children || []) visit(child);
  }

  visit(tree);

  const serialized = serializeAgentTree(tree, {
    includeIds: true,
    includeState: true,
    includeProps: false,
    includeMeta: false,
  });

  return {
    nodeCount: countNodes(tree),
    depth: maxDepth(tree),
    actions,
    names,
    states,
    textTokens,
    tokenCount: estimateTokens(JSON.stringify(serialized)),
  };
}

function expectedActionSet(expectations, fallback) {
  const items = expectations?.expectedActions;
  if (!items) return new Set(fallback);
  return new Set(asArray(items).map((item) => String(item)).filter(Boolean));
}

function expectedNameSet(expectations, fallback) {
  const items = expectations?.expectedNames;
  if (!items) return new Set(fallback);
  return new Set(asArray(items).map((item) => String(item)).filter(Boolean));
}

function expectedStateSet(expectations, fallback) {
  if (expectations?.expectedStateKeys) {
    return new Set(
      asArray(expectations.expectedStateKeys)
        .map((item) => String(item))
        .filter(Boolean)
        .map((key) => `${key}:true`),
    );
  }

  if (expectations?.expectedStates && typeof expectations.expectedStates === "object") {
    return new Set(
      Object.entries(expectations.expectedStates)
        .map(([key, value]) => `${key}:${String(value)}`),
    );
  }

  return new Set(fallback);
}

function expectedTextTokens(expectations, fallbackTokens) {
  if (Array.isArray(expectations?.expectedTextTokens)) {
    return expectations.expectedTextTokens.map((item) => String(item).toLowerCase()).filter(Boolean);
  }
  if (typeof expectations?.expectedText === "string") {
    return tokenizeText(expectations.expectedText);
  }
  return [...fallbackTokens];
}

export function scoreProgram({ inputTree, outputTree, expectations = {} }) {
  const inputProfile = collectProfile(inputTree);
  const outputProfile = collectProfile(outputTree);

  const expectedActions = expectedActionSet(expectations, inputProfile.actions);
  const expectedNames = expectedNameSet(expectations, inputProfile.names);
  const expectedStates = expectedStateSet(expectations, inputProfile.states);
  const expectedTexts = expectedTextTokens(expectations, inputProfile.textTokens);

  const actionRecall = clamp(recall(expectedActions, outputProfile.actions));
  const nameRecall = clamp(recall(expectedNames, outputProfile.names));
  const stateRecall = clamp(recall(expectedStates, outputProfile.states));
  const textF1 = clamp(f1FromTokenLists(expectedTexts, outputProfile.textTokens));

  const nodeReduction = clamp((inputProfile.nodeCount - outputProfile.nodeCount) / Math.max(inputProfile.nodeCount, 1));
  const tokenReduction = clamp((inputProfile.tokenCount - outputProfile.tokenCount) / Math.max(inputProfile.tokenCount, 1));
  const depthReduction = clamp((inputProfile.depth - outputProfile.depth) / Math.max(inputProfile.depth, 1));

  const R_completeness = (0.4 * actionRecall) + (0.3 * nameRecall) + (0.2 * textF1) + (0.1 * stateRecall);
  const R_efficiency = (0.5 * nodeReduction) + (0.3 * tokenReduction) + (0.2 * depthReduction);

  return {
    metrics: {
      action_recall: actionRecall,
      name_recall: nameRecall,
      text_f1: textF1,
      state_recall: stateRecall,
      node_reduction: nodeReduction,
      token_reduction: tokenReduction,
      depth_reduction: depthReduction,
    },
    R_completeness,
    R_efficiency,
    total: R_completeness + R_efficiency,
    baseline: {
      input_nodes: inputProfile.nodeCount,
      output_nodes: outputProfile.nodeCount,
      input_tokens: inputProfile.tokenCount,
      output_tokens: outputProfile.tokenCount,
      input_depth: inputProfile.depth,
      output_depth: outputProfile.depth,
    },
  };
}

export function verifyProgram(score, gates = {}) {
  const metrics = score?.metrics || {};
  const thresholds = {
    action_recall: gates.action_recall ?? 1,
    name_recall: gates.name_recall ?? 0.98,
    text_f1: gates.text_f1 ?? 0.95,
  };

  const failures = [];
  for (const [key, min] of Object.entries(thresholds)) {
    const value = Number(metrics[key] ?? 0);
    if (!(value >= min)) {
      failures.push({ metric: key, expected_min: min, actual: value });
    }
  }

  return {
    passed: failures.length === 0,
    constraints_passed: failures.length === 0,
    thresholds,
    failures,
  };
}
