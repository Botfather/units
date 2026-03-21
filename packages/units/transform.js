import crypto from "node:crypto";
import { parseUnits } from "./units-parser.js";
import { formatUnits } from "./units-print.js";
import { normalizeIrNode } from "./tree-ir.js";
import { normalizeUnitsExpression } from "./expression-normalize.js";

const expressionCache = new Map();

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeExpression(raw) {
  let source = normalizeUnitsExpression(raw).trim();
  if (!source) source = "true";
  return source;
}

function compileExpression(raw) {
  const normalized = normalizeExpression(raw);
  let fn = expressionCache.get(normalized);
  if (!fn) {
    fn = new Function("ctx", `with(ctx||{}){ return (${normalized}); }`);
    expressionCache.set(normalized, fn);
  }
  return fn;
}

function evaluateExpression(raw, ctx, fallback = false) {
  try {
    const fn = compileExpression(raw);
    return fn(ctx || {});
  } catch {
    return fallback;
  }
}

function hashString(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function readProp(node, key) {
  return (node?.props || []).find((prop) => prop?.key === key) || null;
}

function readLiteralProp(node, key, fallback = null) {
  const prop = readProp(node, key);
  if (!prop) return fallback;
  if (prop.kind === "value") return prop.value;
  if (prop.kind === "expr" || prop.kind === "bool") return String(prop.expr?.raw || "");
  return fallback;
}

function readExpressionProp(node, key, fallback = "") {
  const prop = readProp(node, key);
  if (!prop) return fallback;
  if (prop.kind === "expr" || prop.kind === "bool") return String(prop.expr?.raw || fallback);
  if (prop.kind === "value") return typeof prop.value === "string" ? prop.value : JSON.stringify(prop.value);
  return fallback;
}

function compileRule(ruleNode, index) {
  const id = readLiteralProp(ruleNode, "id", null) || `rule_${index + 1}`;
  const match = readExpressionProp(ruleNode, "match", "true");
  const operations = [];

  for (const child of ruleNode?.children || []) {
    if (!child || child.type !== "tag") continue;
    if (child.name === "Filter") {
      operations.push({
        kind: "filter",
        when: readExpressionProp(child, "when", "true"),
      });
      continue;
    }
    if (child.name === "Merge") {
      operations.push({
        kind: "merge",
        strategy: String(readLiteralProp(child, "strategy", "adjacentText") || "adjacentText"),
        when: readExpressionProp(child, "when", "true"),
      });
      continue;
    }
    if (child.name === "Pass") {
      operations.push({ kind: "pass" });
    }
  }

  if (operations.length === 0) {
    operations.push({ kind: "pass", implicit: true });
  }

  return {
    id,
    match,
    operations,
  };
}

function selectProgramNode(ast) {
  if (!ast) return null;
  if (ast.type === "tag" && ast.name === "Program") return ast;
  if (ast.type === "document") {
    return ast.body.find((node) => node?.type === "tag" && node?.name === "Program") || null;
  }
  return null;
}

function canonicalizeProgramSource(astOrSource) {
  if (typeof astOrSource === "string") {
    return formatUnits(astOrSource);
  }
  try {
    return JSON.stringify(astOrSource);
  } catch {
    return String(astOrSource || "");
  }
}

function orderedOperations(operations) {
  const source = Array.isArray(operations) && operations.length > 0
    ? operations
    : [{ kind: "pass", implicit: true }];

  const filters = source.filter((op) => op?.kind === "filter");
  const merges = source.filter((op) => op?.kind === "merge");
  const passes = source.filter((op) => op?.kind === "pass");

  if (passes.length === 0) passes.push({ kind: "pass", implicit: true });

  return [...filters, ...merges, ...passes];
}

function shallowCloneNode(node) {
  return {
    ...node,
    props: isObject(node?.props) ? { ...node.props } : {},
    state: isObject(node?.state) ? { ...node.state } : {},
    actions: Array.isArray(node?.actions) ? [...node.actions] : [],
    children: [],
    meta: isObject(node?.meta) ? { ...node.meta } : {},
  };
}

function shouldMergeChild(op, ctx) {
  return Boolean(evaluateExpression(op.when || "true", ctx, false));
}

function flattenNodeForExpr(node) {
  if (!node || typeof node !== "object") return node;
  const state = isObject(node.state) ? node.state : {};
  return {
    ...node,
    ...state,
  };
}

function joinText(left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

function mergeAdjacentText(children, op, scope) {
  const out = [];
  let mergedCount = 0;

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const childCtx = {
      ...scope,
      child: flattenNodeForExpr(child),
      childIndex: index,
    };

    if (out.length === 0) {
      out.push(child);
      continue;
    }

    const previous = out[out.length - 1];
    const prevCtx = {
      ...scope,
      child: flattenNodeForExpr(previous),
      childIndex: index - 1,
    };

    const canMerge = op.strategy === "adjacentText"
      && previous.role === "text"
      && child.role === "text"
      && shouldMergeChild(op, prevCtx)
      && shouldMergeChild(op, childCtx);

    if (!canMerge) {
      out.push(child);
      continue;
    }

    const mergedNode = {
      ...previous,
      text: joinText(previous.text, child.text),
      id: previous.id || child.id,
      actions: [...new Set([...(previous.actions || []), ...(child.actions || [])])],
      meta: {
        ...(previous.meta || {}),
        merged_ids: [...new Set([...(previous.meta?.merged_ids || [previous.id]), child.id])],
      },
    };

    out[out.length - 1] = mergedNode;
    mergedCount++;
  }

  return { children: out, mergedCount };
}

function selectRule(rules, ctx) {
  for (const rule of rules || []) {
    if (evaluateExpression(rule.match || "true", ctx, false)) return rule;
  }
  return null;
}

export function compileTransformProgram(astOrSource, options = {}) {
  const ast = typeof astOrSource === "string" ? parseUnits(astOrSource) : astOrSource;
  const programNode = selectProgramNode(ast);

  if (!programNode) {
    throw new Error("Transform program must include a top-level Program tag.");
  }

  const kind = String(readLiteralProp(programNode, "kind", "transform") || "transform");
  if (kind !== "transform") {
    throw new Error(`Unsupported Program kind \"${kind}\". Expected \"transform\".`);
  }

  const sourceType = String(readLiteralProp(programNode, "source", "any") || "any");
  const ruleNodes = (programNode.children || []).filter((child) => child?.type === "tag" && child?.name === "Rule");
  const rules = ruleNodes.map((ruleNode, index) => compileRule(ruleNode, index));

  const canonicalSource = canonicalizeProgramSource(
    typeof astOrSource === "string" ? astOrSource : options.source || ast,
  );
  const fingerprint = hashString(canonicalSource);
  const programId = options.programId || `${sourceType}-${fingerprint.slice(0, 12)}`;

  return {
    version: 1,
    program_id: programId,
    kind,
    source_type: sourceType,
    fingerprint,
    ast,
    rules,
    source: canonicalSource,
  };
}

export function runTransformProgram(programOrSource, irTree, context = {}) {
  const program = programOrSource?.rules
    ? programOrSource
    : compileTransformProgram(programOrSource);

  const root = normalizeIrNode(irTree);
  const trace = [];

  function visit(node, parent, index) {
    const exprNode = flattenNodeForExpr(node);
    const exprParent = flattenNodeForExpr(parent);
    const scope = {
      node: exprNode,
      parent: exprParent,
      index,
      context,
    };

    const selectedRule = selectRule(program.rules, scope);
    const ops = orderedOperations(selectedRule?.operations);

    const traceEntry = {
      node_id: node.id,
      rule_id: selectedRule?.id || null,
      operations: [],
      dropped: false,
      merged_count: 0,
    };
    trace.push(traceEntry);

    for (const op of ops) {
      if (op.kind !== "filter") continue;
      const keep = Boolean(evaluateExpression(op.when || "true", scope, false));
      traceEntry.operations.push({ kind: "filter", when: op.when || "true", result: keep });
      if (!keep) {
        traceEntry.dropped = true;
        return null;
      }
    }

    const nextNode = shallowCloneNode(node);

    const nextChildren = [];
    for (let childIndex = 0; childIndex < (node.children || []).length; childIndex++) {
      const child = node.children[childIndex];
      const transformedChild = visit(child, node, childIndex);
      if (transformedChild) nextChildren.push(transformedChild);
    }
    nextNode.children = nextChildren;

    for (const op of ops) {
      if (op.kind !== "merge") continue;
      const merged = mergeAdjacentText(nextNode.children, op, {
        ...scope,
        node: flattenNodeForExpr(nextNode),
      });
      nextNode.children = merged.children;
      traceEntry.merged_count += merged.mergedCount;
      traceEntry.operations.push({
        kind: "merge",
        strategy: op.strategy || "adjacentText",
        when: op.when || "true",
        merged_count: merged.mergedCount,
      });
    }

    for (const op of ops) {
      if (op.kind !== "pass") continue;
      traceEntry.operations.push({ kind: "pass", implicit: Boolean(op.implicit) });
    }

    return nextNode;
  }

  const transformedRoot = visit(root, null, 0);

  return {
    tree: transformedRoot,
    trace,
    program: {
      program_id: program.program_id,
      fingerprint: program.fingerprint,
      source_type: program.source_type,
      kind: program.kind,
    },
  };
}
