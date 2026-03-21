// Incremental parsing helpers using node start/end offsets.
// Strategy:
// 1) detect changed range,
// 2) attempt cheap append-only splice when edit inserts before a container close,
// 3) otherwise reparse the smallest enclosing node and splice it back,
// 4) fall back to full parse when fast paths do not apply.

import { parseUnits } from "./units-parser.js";

const INCREMENTAL_CACHE_MAX_PER_SOURCE = 32;
const incrementalCache = new WeakMap();

export function findChangedRange(prev, next) {
  const prevLen = prev.length;
  const nextLen = next.length;

  let start = 0;
  while (start < prevLen && start < nextLen && prev[start] === next[start]) start++;

  if (start === prevLen && start === nextLen) {
    return { start, endPrev: start, endNext: start };
  }

  let endPrev = prevLen - 1;
  let endNext = nextLen - 1;
  while (endPrev >= start && endNext >= start && prev[endPrev] === next[endNext]) {
    endPrev--;
    endNext--;
  }

  return { start, endPrev: endPrev + 1, endNext: endNext + 1 };
}

export function findSmallestEnclosingNode(ast, start, end) {
  let best = null;

  function visit(node) {
    if (!node || node.start == null || node.end == null) return;
    if (node.start <= start && node.end >= end) {
      if (!best || (node.end - node.start) < (best.end - best.start)) best = node;
      if (node.children) node.children.forEach(visit);
      if (node.body) node.body.forEach(visit);
    }
  }

  visit(ast);
  return best;
}

function findSmallestEnclosingNodeWithPath(ast, start, end) {
  let best = null;
  const path = [];

  function visit(node) {
    if (!node || node.start == null || node.end == null) return;
    if (node.start <= start && node.end >= end) {
      const span = node.end - node.start;
      if (!best || span < best.span) {
        best = { node, span, path: [...path] };
      }
      if (Array.isArray(node.children)) {
        for (let i = 0; i < node.children.length; i++) {
          path.push({ key: "children", index: i });
          visit(node.children[i]);
          path.pop();
        }
      }
      if (Array.isArray(node.body)) {
        for (let i = 0; i < node.body.length; i++) {
          path.push({ key: "body", index: i });
          visit(node.body[i]);
          path.pop();
        }
      }
    }
  }

  visit(ast);
  return best;
}

function cloneAst(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function getNodeAtPath(root, path) {
  let node = root;
  for (const segment of path) {
    const list = node?.[segment.key];
    if (!Array.isArray(list) || segment.index < 0 || segment.index >= list.length) return null;
    node = list[segment.index];
  }
  return node;
}

function replaceNodeAtPath(root, path, replacement) {
  if (!Array.isArray(path) || path.length === 0) return replacement;
  const parentPath = path.slice(0, -1);
  const target = path[path.length - 1];
  const parent = getNodeAtPath(root, parentPath);
  if (!parent || !Array.isArray(parent[target.key]) || target.index < 0 || target.index >= parent[target.key].length) {
    return null;
  }
  parent[target.key][target.index] = replacement;
  return root;
}

function shiftOffsets(node, pivot, delta) {
  if (!node || typeof node !== "object" || delta === 0) return;
  if (typeof node.start === "number" && node.start >= pivot) node.start += delta;
  if (typeof node.end === "number" && node.end >= pivot) node.end += delta;
  if (Array.isArray(node.children)) {
    for (const child of node.children) shiftOffsets(child, pivot, delta);
  }
  if (Array.isArray(node.body)) {
    for (const child of node.body) shiftOffsets(child, pivot, delta);
  }
}

function offsetTree(node, offset) {
  if (!node || typeof node !== "object" || offset === 0) return node;
  if (typeof node.start === "number") node.start += offset;
  if (typeof node.end === "number") node.end += offset;
  if (Array.isArray(node.children)) {
    for (const child of node.children) offsetTree(child, offset);
  }
  if (Array.isArray(node.body)) {
    for (const child of node.body) offsetTree(child, offset);
  }
  return node;
}

function tryAppendChildrenAtClose(prevAst, prevSource, nextSource, change, enclosing) {
  if (!enclosing?.node || !Array.isArray(enclosing.node.children)) return null;
  if (change.endPrev !== change.start || change.endNext <= change.start) return null;

  const node = enclosing.node;
  const closeIndex = node.end - 1;
  if (closeIndex !== change.start) return null;
  if (prevSource[closeIndex] !== "}") return null;

  const insertedText = nextSource.slice(change.start, change.endNext);
  let fragmentAst;
  try {
    fragmentAst = parseUnits(insertedText);
  } catch {
    return null;
  }

  if (!Array.isArray(fragmentAst.body) || fragmentAst.body.length === 0) return null;

  const delta = change.endNext - change.endPrev;
  const nextAst = cloneAst(prevAst);
  shiftOffsets(nextAst, change.start, delta);

  const targetNode = getNodeAtPath(nextAst, enclosing.path);
  if (!targetNode || !Array.isArray(targetNode.children)) return null;

  const appended = fragmentAst.body.map((child) => offsetTree(cloneAst(child), change.start));
  targetNode.children.push(...appended);
  return nextAst;
}

function tryReparseEnclosingNode(prevAst, nextSource, change, enclosing) {
  if (!enclosing?.node || enclosing.node.type === "document") return null;

  const node = enclosing.node;
  const delta = change.endNext - change.endPrev;
  const nextEnd = node.end + delta;
  if (nextEnd < node.start || nextEnd > nextSource.length) return null;

  let reparsed;
  try {
    reparsed = parseUnits(nextSource.slice(node.start, nextEnd));
  } catch {
    return null;
  }

  if (!Array.isArray(reparsed.body) || reparsed.body.length !== 1) return null;

  const replacement = offsetTree(cloneAst(reparsed.body[0]), node.start);
  const nextAst = cloneAst(prevAst);
  shiftOffsets(nextAst, node.end, delta);
  const merged = replaceNodeAtPath(nextAst, enclosing.path, replacement);
  return merged || null;
}

function getCachedIncremental(prevAst, prevSource, nextSource) {
  const byPrevSource = incrementalCache.get(prevAst);
  if (!byPrevSource) return null;
  const byNextSource = byPrevSource.get(prevSource);
  if (!byNextSource) return null;
  return byNextSource.get(nextSource) || null;
}

function setCachedIncremental(prevAst, prevSource, nextSource, nextAst) {
  if (!prevAst || typeof prevAst !== "object") return;
  let byPrevSource = incrementalCache.get(prevAst);
  if (!byPrevSource) {
    byPrevSource = new Map();
    incrementalCache.set(prevAst, byPrevSource);
  }
  let byNextSource = byPrevSource.get(prevSource);
  if (!byNextSource) {
    byNextSource = new Map();
    byPrevSource.set(prevSource, byNextSource);
  }
  if (byNextSource.size >= INCREMENTAL_CACHE_MAX_PER_SOURCE) {
    const firstKey = byNextSource.keys().next().value;
    if (firstKey != null) byNextSource.delete(firstKey);
  }
  byNextSource.set(nextSource, nextAst);
}

export function incrementalParse(prevAst, prevSource, nextSource) {
  const change = findChangedRange(prevSource, nextSource);

  // If no change, return previous AST.
  if (change.start === change.endPrev && change.start === change.endNext) return prevAst;

  if (!prevAst || typeof prevAst !== "object") return parseUnits(nextSource);

  const cached = getCachedIncremental(prevAst, prevSource, nextSource);
  if (cached) return cached;

  const enclosing = findSmallestEnclosingNodeWithPath(prevAst, change.start, change.endPrev);
  if (!enclosing?.node) {
    const full = parseUnits(nextSource);
    setCachedIncremental(prevAst, prevSource, nextSource, full);
    return full;
  }

  const appendFastPath = tryAppendChildrenAtClose(prevAst, prevSource, nextSource, change, enclosing);
  if (appendFastPath) {
    setCachedIncremental(prevAst, prevSource, nextSource, appendFastPath);
    return appendFastPath;
  }

  const reparseFastPath = tryReparseEnclosingNode(prevAst, nextSource, change, enclosing);
  if (reparseFastPath) {
    setCachedIncremental(prevAst, prevSource, nextSource, reparseFastPath);
    return reparseFastPath;
  }

  const full = parseUnits(nextSource);
  setCachedIncremental(prevAst, prevSource, nextSource, full);
  return full;
}
