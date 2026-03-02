// Incremental parsing sketch using node start/end offsets.
// This is a reference strategy; it falls back to full parse today.

import { parseUnits } from "./units-parser.js";

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

export function incrementalParse(prevAst, prevSource, nextSource) {
  const change = findChangedRange(prevSource, nextSource);

  // If no change, return previous AST.
  if (change.start === change.endPrev && change.start === change.endNext) return prevAst;

  // Strategy sketch:
  // 1) Find smallest node in prevAst enclosing the change range.
  // 2) Reparse just that slice of text into a temporary AST.
  // 3) Splice the new subtree into the previous AST, adjusting offsets by delta.
  // 4) Recalculate parent node end offsets above the splice point.
  //
  // This yields near-O(changed-region) for edits localized to a small subtree.
  const enclosing = findSmallestEnclosingNode(prevAst, change.start, change.endPrev);

  if (!enclosing) {
    return parseUnits(nextSource);
  }

  // TODO: Implement subtree reparse and splice. For now, fall back.
  return parseUnits(nextSource);
}
