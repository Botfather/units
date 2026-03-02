// Custom renderer skeleton for Units AST.
// Provide host callbacks to build your own UI tree.

export function createUnitsRenderer(host) {
  const evalExpr = host.evalExpr || ((raw, scope, locals) => {
    const normalized = raw.replace(/@([A-Za-z_$][\\w.$]*)/g, "$1");
    const fn = new Function("scope", "locals", `with(scope){with(locals||{}){return (${normalized});}}`);
    return fn(scope, locals || {});
  });

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
    if (parts.length === 1 && parts[0].type === "text") return host.text(parts[0].value);
    return host.fragment(
      parts.map((part) => {
        if (part.type === "text") return host.text(part.value);
        return host.text(String(evalExpr(part.value, scope, locals)));
      }),
    );
  }

  function pushChild(out, value) {
    if (Array.isArray(value)) out.push(...value);
    else out.push(value);
  }

  function render(ast, scope, options = {}) {
    const slots = options.slots || {};
    const set = options.set || scope?.set || (() => {});

    function renderNode(node, locals) {
      if (!node) return null;
      if (node.type === "text") return renderText(node.value, locals);
      if (node.type === "expr") return host.text(String(evalExpr(node.value.raw, scope, locals)));
      if (node.type === "directive") return renderDirective(node, locals);
      if (node.type === "tag") return renderTag(node, locals);
      return null;
    }

    function renderDirective(node, locals) {
      const name = node.name;
      const args = node.args || "";
      if (name === "if") {
        const cond = evalExpr(args, scope, locals);
        if (!cond) return null;
        return renderChildren(node.children, locals);
      }
      if (name === "for") {
        const m = args.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?\s+in\s+(.+)$/);
        if (!m) return null;
        const itemName = m[1];
        const idxName = m[2] || "index";
        const listExpr = m[3].trim();
        const list = evalExpr(listExpr, scope, locals) || [];
        const out = [];
        for (let idx = 0; idx < list.length; idx++) {
          const childLocals = { ...locals, [itemName]: list[idx], [idxName]: idx };
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
      return renderChildren(node.children, locals);
    }

    function renderTag(node, locals) {
      const props = {};
      const events = {};
      for (const prop of node.props || []) {
        if (prop.kind === "value") props[prop.key] = prop.value;
        else if (prop.kind === "expr") props[prop.key] = evalExpr(prop.expr.raw, scope, locals);
        else if (prop.kind === "bool") {
          const v = evalExpr(prop.expr.raw, scope, locals);
          if (v) props[prop.key] = true;
        } else if (prop.kind === "event") {
          const eventName = prop.key.startsWith("on:") ? prop.key.slice(3) : prop.key;
          events[eventName] = (event) => {
            const handlerLocals = { ...locals, event, set };
            return evalExpr(prop.expr.raw, scope, handlerLocals);
          };
        }
      }

      const children = renderChildren(node.children, locals);
      return host.element(node.name, props, events, children);
    }

    function renderChildren(children, locals) {
      const out = [];
      for (let idx = 0; idx < (children || []).length; idx++) {
        const child = children[idx];
        pushChild(out, renderNode(child, locals));
      }
      return host.fragment(out);
    }

    if (ast.type === "document") return renderChildren(ast.body, {});
    return renderNode(ast, {});
  }

  return { render };
}

/*
Host interface example:
const host = {
  element: (name, props, events, children) => ({ type: name, props, events, children }),
  text: (value) => ({ type: "text", value }),
  fragment: (children) => children,
};
*/
