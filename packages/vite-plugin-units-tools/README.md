# @botfather/vite-plugin-units-tools

Vite plugin providing dev-time virtual query imports for Units `.ui` files: formatted source text, token streams, and syntax-highlighted HTML. Primarily useful for documentation sites, playgrounds, and editor tooling built on Vite.

## What is it?

This plugin complements `vite-plugin-units` with extra query variants for each `.ui` file. Instead of loading the AST, these queries give you human-readable representations of the source: canonical formatted text, a flat token array, or a ready-to-render HTML string with syntax-highlight class names.

## Installation

```sh
npm install --save-dev @botfather/vite-plugin-units-tools
```

Peer dependency: Vite >= 4.

## Setup

```js
// vite.config.js
import { defineConfig } from "vite";
import unitsPlugin from "@botfather/vite-plugin-units";
import unitsTools from "@botfather/vite-plugin-units-tools";

export default defineConfig({
  plugins: [
    unitsPlugin(),
    unitsTools({ classPrefix: "ui" }),
  ],
});
```

## Query imports

| Import syntax | Return type | Description |
|---|---|---|
| `import x from './foo.ui?format'` | `string` | Canonical formatted source via `formatUnits` |
| `import x from './foo.ui?tokens'` | `Array<{type, value}>` | Flat token stream |
| `import x from './foo.ui?highlight'` | `string` | HTML string of `<span class="…">` elements |

### `?format`

Returns the `.ui` source after running the canonical formatter. Useful for displaying normalized source in a docs page or playground.

```js
import formatted from "./Button.ui?format";

document.querySelector("pre").textContent = formatted;
```

### `?tokens`

Returns a flat array of token objects, each with `type` and `value` fields.

```js
import tokens from "./Button.ui?tokens";

// [{ type: 'ident', value: 'Button' }, { type: 'ws', value: ' ' }, ...]
```

Token types: `ws`, `comment`, `string`, `directive`, `expr`, `keyword`, `ident`, `number`, `punct`, `unknown`.

### `?highlight`

Returns an HTML string where each token is wrapped in a `<span>` with a class name based on its type.

```js
import html from "./Button.ui?highlight";

document.querySelector(".code-block").innerHTML = html;
```

With `classPrefix: "ui"`, the output looks like:

```html
<span class="ui-tok-ident">Button</span>
<span class="ui-tok-ws"> </span>
<span class="ui-tok-punct">(</span>
...
```

Apply your own CSS to style each token class.

## Options

```ts
unitsTools(options?: {
  include?: RegExp;       // Only process paths matching this pattern
  exclude?: RegExp;       // Skip paths matching this pattern
  classPrefix?: string;   // Prefix for highlight span class names (default: "")
                          // e.g. "ui" → class="ui-tok-ident"
})
```

## TypeScript

Add the type reference to your app entry or a `.d.ts` file to get typed `?format`, `?tokens`, and `?highlight` imports:

```ts
/// <reference types="@botfather/units/ui" />
```

## License

MIT
