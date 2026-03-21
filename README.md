# Units

[![Website](https://img.shields.io/badge/website-live-0f6b5f?style=flat-square)](https://botfather.github.io/units/)

Lightweight DSL for building interactive UIs. This monorepo publishes:
- `@botfather/units` (parser, printer, runtime, custom renderer, incremental sketch)
- `@botfather/vite-plugin-units` (Vite build plugin)
- `@botfather/vite-plugin-units-tools` (Vite dev tools: format/tokens/highlight)
- `@botfather/units-tools` (CLI tools: format, lint, etc.)
- `@botfather/units-uikit-shadcn` (ShadCN-style Units UI kit)
- `bench.js` (parse benchmark)
- `DOCS.md` (full documentation)
- `DOCS-LLM.md` (LLM/agent-optimized authoring profile)
- `examples/learn-vite/` (learn / reference site — powers the [website](https://botfather.github.io/units/))
- `examples/todo-vite/` (todo list demo)
- `examples/chat-vite/` (chat transcript demo)
- `examples/shadcn-gallery-vite/` (ShadCN gallery demo)

## Website

- Home: https://botfather.github.io/units/
- Benchmarks: https://botfather.github.io/units/#benchmarks

## Quick Start

```js
import { parseUnits, renderUnits } from "@botfather/units";

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
'literal'                    // compact text shorthand
@expr                         // inline expression

#if (@cond) { ... }
#if @cond { ... }             // compact directive args
#for (item, i in @items) { ... }
#for item, i in @items { ... } // compact directive args
#slot (name) { ... }
#slot name                    // compact directive args
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
Use `createUnitsRenderer(host)` with host hooks:
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

See the [live benchmarks table](https://botfather.github.io/units/#benchmarks) for React vs DSL token comparisons.

## Benchmark
```
node ./bench.js
```

## DSL Benchmark Suite
Run the DSL-specific benchmark suite:
```
pnpm bench:dsl
```

Quick smoke run:
```
pnpm bench:dsl:quick
```

What it measures:
- Parse throughput on curated `.ui` programs
- Format / printer throughput and format stability
- Custom-renderer throughput with realistic scope sizes
- Edit-loop cost via changed-range detection and `incrementalParse()`
- Corpus parse / format throughput over `bench/cases`, `examples`, and the ShadCN Units kit

Inputs:
- Suite config: `bench/dsl-bench.config.json`
- Curated cases: `bench/cases/*.ui`, `examples/*/src/*.ui`
- Corpus sweep: `bench/cases/`, `examples/`, `packages/units-uikit-shadcn/shadcn/`

Outputs:
- JSON metrics: `bench/results/dsl-bench.json`
- Markdown report: `bench/results/dsl-bench.md`

## LLM Benchmark (Token + Quality)
Offline reference run (estimated tokens):
```
pnpm bench:llm
```

Live model run (real usage tokens from API):
```
OPENAI_API_KEY=... pnpm bench:llm:live
```

Config lives in `bench/llm-cases.json`, with case files under `bench/cases/`.

## React vs DSL Benchmark (Token Usage)
Run an exhaustive paired benchmark to compare direct React code vs Units DSL:
```
pnpm bench:react-vs-dsl
```

Quick run:
```
pnpm bench:react-vs-dsl:quick
```

Inputs:
- Pair config: `bench/react-vs-dsl-pairs.json`
- Curated pairs: `bench/cases/*.jsx` vs `bench/cases/*.ui`
- Synthetic feature matrix: generated by `tools/react-vs-dsl-bench.mjs`

Outputs:
- JSON metrics: `bench/results/react-vs-dsl.json`
- Markdown report: `bench/results/react-vs-dsl.md`

Provider-tokenized run (exact `usage.input_tokens` from model API):
```
OPENAI_API_KEY=... pnpm bench:react-vs-dsl:provider
```

Provider + approx side-by-side on curated cases:
```
OPENAI_API_KEY=... pnpm bench:react-vs-dsl:provider:both
```

Provider + approx with compact optimized DSL pair set:
```
OPENAI_API_KEY=... pnpm bench:react-vs-dsl:provider:optimized
```

## System Benchmarking
Install the standard benchmark CLI tools:
```
make bench-system-install
```

Alias:
```
make install-bench-tools
```

Generate a machine-aware benchmark plan without executing the benchmarks:
```
make bench-system-plan
```

Run the system benchmark test coverage:
```
make test-system-bench
```

## Demo
See `examples/todo-vite` for a unified Vite demo (todo list) implemented purely in `.ui` files.

For full docs, see `DOCS.md`.

## ShadCN Units UI Kit
The repo includes a ShadCN-style component library authored in Units DSL in `packages/units-uikit-shadcn/`.

Quick wiring (React runtime):
```js
import { renderUnits } from "@botfather/units/runtime";
import { withShadcnComponents } from "@botfather/units-uikit-shadcn";
import uiAst from "./app.ui";

const options = withShadcnComponents();
renderUnits(uiAst, { /* scope */ }, options);
```

You can also generate a manifest for the `.ui` templates:
```
units-manifest packages/units-uikit-shadcn/shadcn packages/units-uikit-shadcn/shadcn-manifest.js
```

## Vite Plugin
Use `@botfather/vite-plugin-units` to load `.ui` files as AST at build time.

Example:
```js
import units from "@botfather/vite-plugin-units";
export default { plugins: [units()] };
```

TypeScript:
- `@botfather/vite-plugin-units` ships its own plugin types.
- For `.ui` imports, add `/// <reference types="@botfather/units/ui" />` in a global `d.ts` file.

## Syntax Highlighting / Pretty Print
Use `@botfather/vite-plugin-units-tools` to load:
- `.ui?format` for pretty-printed source
- `.ui?tokens` for tokenized output suitable for syntax highlighting
- `.ui?highlight` for prebuilt HTML spans

TypeScript Support:
- `@botfather/vite-plugin-units-tools` ships its own plugin types.

## CLI Tools
The `@botfather/units-tools` package provides CLI utilities for managing Units files:
- `units-format <file-or-dir>`: Format all `.ui` files in a directory.
- `units-lint <file-or-dir>`: Lint for syntax and formatting consistency.
- `lint-ui [targets...]`: Lint all `.ui` files in `examples/` and `packages/units-uikit-shadcn/` (or pass targets).
- `units-watch <rootDir> <outFile>`: Watch and emit AST changes.

## VS Code Extension
See `vscode/units-vscode` for a minimal VS Code extension that adds Units syntax highlighting, snippets, and formatting.

## Contributing
See `CONTRIBUTING.md` for development workflow and guidelines.

## Security
See `SECURITY.md` for reporting vulnerabilities.

## License
MIT. See `LICENSE`.
