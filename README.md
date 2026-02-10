# Units

Lightweight DSL for building interactive UIs. This package includes:
- `lib/units-parser.js` (O(n), dependency-free)
- `lib/units-print.js` (AST printer & formatter)
- `lib/units-runtime.js` (React renderer)
- `lib/units-custom-renderer.js` (renderer skeleton)
- `lib/vite-plugin-units.js` (Vite build plugin)
- `lib/vite-plugin-units-tools.js` (Vite dev tools: format/tokens/highlight)
- `bench.js` (parse benchmark)
- `lib/incremental.js` (incremental parsing sketch)
- `tools/` (CLI tools: format, lint, etc.)
- `DOCS.md` (full documentation)
- `DOCS-LLM.md` (LLM/agent-optimized authoring profile)
- `examples/todo-vite/` (todo list demo)
- `examples/chat-vite/` (chat transcript demo)

## Quick Start

```js
import { parseUnits } from "./lib/units-parser.js";
import { renderUnits } from "./lib/units-runtime.js";

const dsl = `
App {
  Header (title:'Dashboard')
  #if (@user.loggedIn) {
    List {
      #for (item, i in @items) {
        Card (key:@item.id) {
          text 'Item: '
          @item.name
          Button (label:'Select' !click { set(selected:=@item.id) })
        }
      }
    }
  }
  #slot (footer)
}
`;

const ast = parseUnits(dsl);
const element = renderUnits(ast, {
  user: { loggedIn: true },
  items: [{ id: 1, name: "One" }, { id: 2, name: "Two" }],
  set: (path, value) => console.log("set", path, value)
});
```

## Syntax (minimal)

```
Tag ( props ) { children }
Tag props { children }        // props inline
Tag { children }
Tag ( props )                 // self-closing if no children

text 'literal'
text 'Hello @{name}'         // inline interpolation inside text
@expr                         // inline expression

#if (@cond) { ... }
#for (item, i in @items) { ... }
#slot (name) { ... }
#key (@expr)
```

### Props
```
key:value        // literal value
key=@expr        // expression value
key?=@expr       // boolean prop if expr truthy
!click { ... }   // event handler shorthand
on:click={ ... } // event handler longhand
```

### Expressions
Expressions are raw JS strings evaluated at runtime. For performance, the parser never parses them.

The React runtime supports a lightweight `:=` assignment inside `set(...)` calls:
```
!click { set(selected:=@item.id) }
```
This is transformed into:
```
set('selected', @item.id)
```

## React Runtime
`renderUnits(ast, scope, options)`

- `scope`: shared data model (can include `set`).
- `options.components`: map of custom components.
- `options.slots`: named slots (string/element or function).
- `options.set`: override for `set`.

## Custom Renderer
Use `createRenderer(host)` with host hooks:
```
const host = {
  element: (name, props, events, children) => ({ type: name, props, events, children }),
  text: (value) => ({ type: "text", value }),
  fragment: (children) => children,
};
```

## Notes
- Parsing is O(n) and dependency-free.
- The grammar is intentionally small to keep parsing fast and extensible.
- AST nodes include `start`/`end` offsets for caching or incremental re-parse.

## Latest Benchmark (local)
Feb 5, 2026: 2000 parses in 15.197ms (~0.0075ms/parse) on Node v22.22.0.

## Benchmark
```
node ./bench.js
```

## Demo
See `examples/todo-vite` for a unified Vite demo (todo list) implemented purely in `.ui` files.

For full docs, see `DOCS.md`.

## ShadCN Units UI Kit
The repo includes a ShadCN-style component library authored in Units DSL at `uikit/shadcn/`.

Quick wiring (React runtime):
```js
import { renderUnits } from "./lib/units-runtime.js";
import { withShadcnComponents } from "./uikit/shadcn/index.js";
import uiAst from "./app.ui";

const options = withShadcnComponents();
renderUnits(uiAst, { /* scope */ }, options);
```

You can also generate a manifest for the `.ui` templates:
```
node tools/units-manifest.mjs uikit/shadcn uikit/shadcn-manifest.js
```

## Vite Plugin
Use `lib/vite-plugin-units.js` to load `.ui` files as AST at build time.

Example:
```js
import units from "./lib/vite-plugin-units.js";
export default { plugins: [units()] };
```

TypeScript:
- `lib/vite-plugin-units.d.ts` for plugin typing
- `lib/ui.d.ts` for importing `.ui` files

## Syntax Highlighting / Pretty Print
Use `lib/vite-plugin-units-tools.js` to load:
- `.ui?format` for pretty-printed source
- `.ui?tokens` for tokenized output suitable for syntax highlighting
- `.ui?highlight` for prebuilt HTML spans

TypeScript Support:
- `lib/vite-plugin-units-tools.d.ts` for plugin typing

## CLI Tools
The `tools/` directory contains CLI utilities for managing Units files:
- `node tools/format-ui.mjs`: Format `.ui` files (wrapper for `tools/units-format.mjs`).
- `node tools/units-format.mjs`: Format all `.ui` files in a directory.
- `node tools/units-lint.mjs`: Lint for syntax and formatting consistency.
- `node tools/units-watch.mjs`: Watch and emit AST changes.

## VS Code Extension
See `vscode/units-vscode` for a minimal VS Code extension that adds Units syntax highlighting, snippets, and formatting.

## Contributing
See `CONTRIBUTING.md` for development workflow and guidelines.

## Security
See `SECURITY.md` for reporting vulnerabilities.

## License
MIT. See `LICENSE`.
