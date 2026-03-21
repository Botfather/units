# @botfather/vite-plugin-units

Vite plugin that transforms `.ui` files into importable ES modules, making Units templates first-class build-time assets.

## What is it?

This plugin hooks into Vite's module resolution and load pipeline to process `.ui` files. Each file is parsed at build time and exposed as a module that exports the raw source string and the pre-parsed AST. The AST is ready to pass directly to `renderUnits` without any runtime parsing overhead.

An optional sidecar cache mechanism pairs with the `units-emit` CLI tool: if a `.ui.ast.json` file exists next to a `.ui` file and is newer, the plugin loads the pre-built AST instead of re-parsing — making cold starts faster in large projects.

## Installation

```sh
npm install --save-dev @botfather/vite-plugin-units
```

Peer dependency: Vite >= 4.

## Setup

```js
// vite.config.js
import { defineConfig } from "vite";
import unitsPlugin from "@botfather/vite-plugin-units";

export default defineConfig({
  plugins: [unitsPlugin()],
});
```

## Usage

With the plugin active, any `.ui` file can be imported directly:

```js
import { ast, source } from "./app.ui";
import { renderUnits } from "@botfather/units/runtime";

const element = renderUnits(ast, scope, { components });
```

### TypeScript

Add the type reference to your app's entry point or a `.d.ts` file:

```ts
/// <reference types="@botfather/units/ui" />
```

This gives you typed imports for `ast`, `source`, and the query variants (`?format`, `?tokens`, `?highlight` — provided by `vite-plugin-units-tools`).

## Module output

Each `.ui` import resolves to a synthetic module with this shape:

```js
export const source = '<raw .ui source text>';
export const ast = { type: 'document', body: [...] };
export default ast;
```

## Options

```ts
unitsPlugin(options?: {
  emitSource?: boolean;   // Include `source` export. Default: true
  emitAst?: boolean;      // Include `ast` export and default export. Default: true
  useAstCache?: boolean;  // Load *.ui.ast.json sidecar when available. Default: true
  include?: RegExp;       // Only process paths matching this pattern
  exclude?: RegExp;       // Skip paths matching this pattern
})
```

### AST sidecar cache

When `useAstCache` is enabled (the default), the plugin looks for a `<file>.ui.ast.json` alongside each `.ui` file. If the sidecar's modification time is equal to or newer than the source file, it is used directly — skipping parsing entirely.

To pre-build sidecars before starting the dev server or running a build:

```sh
npx units-emit src/
```

Or add it as a pre-script:

```json
{
  "scripts": {
    "predev": "units-emit src/",
    "prebuild": "units-emit src/"
  }
}
```

## License

MIT
