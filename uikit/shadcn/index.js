import { renderUnits } from "../../lib/units-runtime.js";
import { uiManifest } from "../shadcn-manifest.js";

function normalizeScope(scope) {
  return scope && typeof scope === "object" ? scope : {};
}

export function createUnitsComponent(ast) {
  return function UnitsComponent(props) {
    const { __scope, slots: slotOverrides, children, ...rest } = props || {};
    const scope = {
      ...normalizeScope(__scope),
      props: {
        ...rest,
        children,
      },
    };
    const slots = { ...(slotOverrides || {}) };
    if (children != null) slots.default = children;
    return renderUnits(ast, scope, { slots });
  };
}

export const shadcnComponents = Object.fromEntries(
  Object.entries(uiManifest).map(([name, ast]) => [name, createUnitsComponent(ast)]),
);

export function withShadcnComponents(options = {}) {
  return {
    ...options,
    components: {
      ...(options.components || {}),
      ...shadcnComponents,
    },
  };
}
