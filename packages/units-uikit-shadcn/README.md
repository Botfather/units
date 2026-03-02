# ShadCN Units Library (DSL)

This package contains Units `.ui` templates modeled after the shadcn/ui component set.

Notes:
- Each component expects a `props` object in scope (e.g. `{ className: '' }`).
- Slots are rendered with `#slot (default)` unless otherwise noted.
- These templates focus on structure and Tailwind-style classes. Behavior (Radix, state management, portals, etc.) should be wired in your renderer or host components.

Suggested usage:
- Import a component AST via `units-manifest` and wrap it in a React component.
- Pass `props` into scope when rendering, and provide slots via `options.slots`.

Helper exports:
- `@botfather/units-uikit-shadcn` exposes `shadcnComponents` and `withShadcnComponents()` for quick wiring.

Example (React renderer):
```
import { renderUnits } from "@botfather/units/runtime";
import uiAst from "./app.ui";
import { withShadcnComponents } from "@botfather/units-uikit-shadcn";

const options = withShadcnComponents();
renderUnits(uiAst, { /* scope */ }, options);
```
