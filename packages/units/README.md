# @botfather/units

The core library for the **Units DSL** — a lightweight, dependency-free declarative language for describing UI trees in `.ui` files.

## What is it?

Units provides a minimal syntax for authoring UIs that is significantly terser than JSX, making it well-suited for code generation (e.g. LLM output) and human editing alike. A `.ui` file is parsed into a plain JSON AST, which can then be rendered by the included React renderer or any custom host framework via the custom renderer API.

**Key characteristics:**
- O(n) single-pass parser — no external parsing dependencies
- Render-agnostic — React is opt-in; plug in any framework
- Canonical formatter for consistent diffs
- Incremental parsing helpers for editor integrations

## Installation

```sh
npm install @botfather/units
# react is a peer dependency for the React renderer
npm install react
```

## The `.ui` syntax

```
TagName (prop:'value', expr=@scopeVar, visible?=@bool) {
  text 'Literal @{interpolated}'
  @rawExpr
  #if (@cond) { ... }
  #for (item, i in @list) {
    #key (@item.id)
    ChildTag (...)
  }
  #slot (slotName)
}
```

| Syntax | Meaning |
|---|---|
| `Tag (props) { children }` | Element node |
| `key:'string'` / `key:123` / `key:true` | Static prop value |
| `key=@expr` | Dynamic expression prop |
| `key?=@expr` | Conditional boolean prop (only set when truthy) |
| `!click { handler(@event) }` | Event handler shorthand |
| `on:click={ handler(@event) }` | Event handler long form |
| `text 'literal'` | Text node (supports `@{...}` interpolation) |
| `@expr` | Inline expression node |
| `#if (@cond) { }` | Conditional directive |
| `#for (item, i in @list) { }` | Loop with index |
| `#for item in @list { }` | Compact loop |
| `#slot (name)` | Named slot |
| `#key (@expr)` | Key directive for the next tag |
| `// comment` | Line comment |

## API

### Parsing

```js
import { parseUnits } from "@botfather/units/parser";

const ast = parseUnits(`
  Button (variant:'primary') {
    text 'Click me'
  }
`);
// → { type: 'document', body: [...] }
```

Throws a descriptive error with source offset and snippet on syntax errors.

### Formatting

```js
import { formatUnits } from "@botfather/units/print";

const canonical = formatUnits(source);
```

Line width defaults to `100`. Override with the `UNITS_PRINT_WIDTH` environment variable.

### React renderer

```js
import { renderUnits } from "@botfather/units/runtime";
import uiAst from "./app.ui"; // via vite-plugin-units

const element = renderUnits(uiAst, scope, {
  components: { Button: MyButtonComponent },
  slots: { default: <span>content</span> },
  set: (key, value) => setState(s => ({ ...s, [key]: value })),
});
```

| Option | Type | Description |
|---|---|---|
| `components` | `Record<string, Component>` | Tag name → React component mapping |
| `slots` | `Record<string, ReactNode \| fn>` | Named slot content |
| `set` | `(key, value) => void` | Mutation handler for `set()` expressions |
| `evalExpr` | `(expr, scope) => any` | Custom expression evaluator |

### Custom (non-React) renderer

```js
import { createUnitsRenderer } from "@botfather/units/custom-renderer";

const renderer = createUnitsRenderer({
  element(name, props, events, children) { /* create node */ },
  text(value) { /* create text node */ },
  fragment(children) { /* group children */ },
});

const node = renderer.render(ast, scope, options);
```

### Expression evaluator

```js
import { createUnitsEvaluator } from "@botfather/units/runtime";

const evalExpr = createUnitsEvaluator();
const result = evalExpr("@items.length > 0", scope);
```

Expressions use `@` as the scope accessor prefix. The evaluator caches compiled `Function` objects per expression string.

### Incremental parsing

```js
import {
  findChangedRange,
  findSmallestEnclosingNode,
  incrementalParse,
} from "@botfather/units/incremental";

const range = findChangedRange(prevSource, nextSource);
const node = findSmallestEnclosingNode(ast, range.start, range.endPrev);
const newAst = incrementalParse(prevAst, prevSource, nextSource);
```

Useful for editor integrations. `incrementalParse` attempts append-only and smallest-enclosing-node reparses first, then safely falls back to a full re-parse when needed.

### Tree IR adapters

```js
import {
  normalizeDomTree,
  normalizeA11yTree,
  serializeAgentTree,
} from "@botfather/units/tree-ir";

const domIr = normalizeDomTree(rawDomLikeTree);
const a11yIr = normalizeA11yTree(rawAccessibilityTree);
const compact = serializeAgentTree(domIr);
```

### Transform programs

```js
import {
  compileTransformProgram,
  runTransformProgram,
} from "@botfather/units/transform";

const program = compileTransformProgram(programSource);
const result = runTransformProgram(program, irTree, { task: "summarize" });
```

Transform programs use `.ui` syntax with a `Program (kind:'transform')` root and reserved transform tags (`Rule`, `Filter`, `Merge`, `Pass`) in transform mode.

### Reward + verifier

```js
import { scoreProgram, verifyProgram } from "@botfather/units/reward";

const score = scoreProgram({ inputTree, outputTree, expectations });
const verification = verifyProgram(score, {
  action_recall: 1,
  name_recall: 0.98,
  text_f1: 0.95,
});
```

### Verified library + synthesis

```js
import {
  createVerifiedProgramMetadata,
  writeVerifiedProgram,
} from "@botfather/units/library";
import { runSynthesisLoop } from "@botfather/units/synthesis";
```

### TypeScript types for Vite imports

Add `/// <reference types="@botfather/units/ui" />` (or import from `@botfather/units/ui`) to get types for `.ui` file imports:

```ts
import { ast, source } from "./app.ui";
import formatted from "./app.ui?format";
import tokens from "./app.ui?tokens";
import html from "./app.ui?highlight";
```

## Package exports

| Export path | Description |
|---|---|
| `@botfather/units` | Re-exports everything |
| `@botfather/units/parser` | `parseUnits` |
| `@botfather/units/print` | `formatUnits` |
| `@botfather/units/runtime` | `renderUnits`, `createUnitsEvaluator` |
| `@botfather/units/custom-renderer` | `createUnitsRenderer` |
| `@botfather/units/incremental` | Incremental parse helpers |
| `@botfather/units/tree-ir` | DOM/AX normalization + compact serialization |
| `@botfather/units/transform` | Transform program compiler + runtime |
| `@botfather/units/reward` | Reward scoring + verifier gates |
| `@botfather/units/library` | Verified program library helpers |
| `@botfather/units/synthesis` | Iterative synthesis loop helpers |
| `@botfather/units/ui` | Type declarations for `.ui` file imports |

## License

MIT
