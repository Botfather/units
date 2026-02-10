// React renderer for Units AST.
// Requires React as a peer dependency.

import React from "react";

export function createUnitsEvaluator() {
  const cache = new Map();
  return function evalExpr(raw, scope, locals) {
    const key = raw;
    let fn = cache.get(key);
    if (!fn) {
      // Allow a simple := transform inside set(...) calls.
      let normalized = raw.replace(/@\(/g, "(");
      normalized = normalized.replace(/@([A-Za-z_$][\w.$]*)/g, "$1");
      const transformed = normalized.replace(
        /set\s*\(\s*([A-Za-z_$][\w.$]*)\s*:=/g,
        "set('$1',",
      );
      fn = new Function(
        "scope",
        "locals",
        "event",
        "set",
        `with(scope){with(locals||{}){return (${transformed});}}`,
      );
      cache.set(key, fn);
    }
    return fn(scope, locals || {}, locals?.event, locals?.set || scope?.set);
  };
}

export function renderUnits(ast, scope, options = {}) {
  const evalExpr = options.evalExpr || createUnitsEvaluator();
  const components = options.components || {};
  const slots = options.slots || {};
  const set = options.set || scope?.set || (() => {});

  function splitInterpolations(value) {
    const text = String(value ?? "");
    const parts = [];
    if (!text.includes("@{")) return [{ type: "text", value: text }];
    let i = 0;
    while (i < text.length) {
      const idx = text.indexOf("@{", i);
      if (idx === -1) {
        if (i < text.length) parts.push({ type: "text", value: text.slice(i) });
        break;
      }
      if (idx > i) parts.push({ type: "text", value: text.slice(i, idx) });
      let j = idx + 2;
      let depth = 1;
      while (j < text.length) {
        const ch = text[j];
        if (ch === "'" || ch === "\"") {
          const quote = ch;
          j++;
          while (j < text.length) {
            const qch = text[j];
            if (qch === "\\") {
              j += 2;
              continue;
            }
            if (qch === quote) {
              j++;
              break;
            }
            j++;
          }
          continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        if (depth === 0) break;
        j++;
      }
      if (depth !== 0) {
        parts.push({ type: "text", value: text.slice(idx) });
        break;
      }
      const expr = text.slice(idx + 2, j).trim();
      parts.push({ type: "expr", value: expr });
      i = j + 1;
    }
    return parts;
  }

  function renderText(value, locals) {
    const parts = splitInterpolations(value);
    if (parts.length === 1 && parts[0].type === "text") return parts[0].value;
    return parts.map((part) => {
      if (part.type === "text") return part.value;
      return String(evalExpr(part.value, scope, locals));
    });
  }

  function pushChild(out, value) {
    if (Array.isArray(value)) out.push(...value);
    else out.push(value);
  }

  function renderNode(node, locals) {
    if (!node) return null;
    if (node.type === "text") return renderText(node.value, locals);
    if (node.type === "expr") return evalExpr(node.value.raw, scope, locals);
    if (node.type === "directive") return renderDirective(node, locals);
    if (node.type === "tag") return renderTag(node, locals);
    return null;
  }

  function renderDirective(node, locals) {
    const name = node.name;
    const args = node.args || "";
    if (name === "for") {
      const m = args.match(
        /^\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?\s+in\s+(.+)$/,
      );
      if (!m) return null;
      const itemName = m[1];
      const idxName = m[2] || "index";
      const listExpr = m[3].trim();
      const list = evalExpr(listExpr, scope, locals) || [];
      const out = [];
      for (let idx = 0; idx < list.length; idx++) {
        const childLocals = {
          ...locals,
          [itemName]: list[idx],
          [idxName]: idx,
        };
        out.push(renderChildren(node.children, childLocals));
      }
      return out;
    }
    if (name === "slot") {
      const slotName = args.trim();
      const slot = slots[slotName];
      if (slot == null) return null;
      return typeof slot === "function" ? slot(locals) : slot;
    }
    if (name === "key" || name === "elif" || name === "else") {
      return null;
    }
    return renderChildren(node.children, locals);
  }

  function renderTag(node, locals) {
    const props = {};
    const eventHandlers = {};
    for (const prop of node.props || []) {
      if (prop.kind === "value") props[prop.key] = prop.value;
      else if (prop.kind === "expr")
        props[prop.key] = evalExpr(prop.expr.raw, scope, locals);
      else if (prop.kind === "bool") {
        const v = evalExpr(prop.expr.raw, scope, locals);
        if (v) props[prop.key] = true;
      } else if (prop.kind === "event") {
        const eventName = prop.key.startsWith("on:")
          ? prop.key.slice(3)
          : prop.key;
        const handler = (event) => {
          const handlerLocals = { ...locals, event, set };
          return evalExpr(prop.expr.raw, scope, handlerLocals);
        };
        eventHandlers[`on${eventName[0].toUpperCase()}${eventName.slice(1)}`] =
          handler;
      }
    }

    const children = renderChildren(node.children, locals);
    const Component = components[node.name] || node.name;
    const elProps = { ...props, ...eventHandlers };
    if (typeof Component !== "string" && elProps.__scope == null) {
      elProps.__scope = scope;
    }
    return React.createElement(
      Component,
      elProps,
      ...(Array.isArray(children) ? children : [children]),
    );
  }

  function renderChildren(children, locals) {
    const out = [];
    for (let idx = 0; idx < (children || []).length; idx++) {
      const child = children[idx];
      if (child.type === "directive" && child.name === "key") {
        const next = children[idx + 1];
        if (next && next.type === "tag") {
          const key = evalExpr(child.args || "", scope, locals);
          const rendered = renderNode(
            {
              ...next,
              props: [
                ...(next.props || []),
                { kind: "value", key: "key", value: key },
              ],
            },
            locals,
          );
          out.push(rendered);
          idx++;
          continue;
        }
      }
      pushChild(out, renderNode(child, locals));
      if (child.type === "directive" && child.name === "if") {
        let matched = false;
        if (evalExpr(child.args || "", scope, locals)) {
          out.push(renderChildren(child.children, locals));
          matched = true;
        }

        let next = idx + 1;
        while (next < children.length && children[next].type === "directive") {
          if (children[next].name === "elif") {
            if (
              !matched &&
              evalExpr(children[next].args || "", scope, locals)
            ) {
              out.push(renderChildren(children[next].children, locals));
              matched = true;
            }
            next++;
            continue;
          } else if (children[next].name === "else") {
            if (!matched) {
              out.push(renderChildren(children[next].children, locals));
              matched = true;
            }
            next++;
            break;
          } else {
            break;
          }
        }
        if (!matched) {
          out.push(null);
        }
        idx = next - 1;
        continue;
      }
      out.push(renderNode(child, locals));
    }
    return out;
  }

  if (ast.type === "document") return renderChildren(ast.body, {});
  return renderNode(ast, {});
}
