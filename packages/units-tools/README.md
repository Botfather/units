# @botfather/units-tools

CLI toolchain for working with Units `.ui` files. Covers the full developer workflow: format, lint, emit parse caches, generate manifest files for static imports, and watch a directory for changes.

## What is it?

`units-tools` provides a set of command-line tools that fit into your build pipeline alongside the Vite plugins. Use them to keep `.ui` files consistently formatted, catch syntax errors in CI, pre-build AST sidecars for faster Vite dev starts, and generate type-safe manifest files that collect all `.ui` files in a directory tree.

## Installation

```sh
npm install --save-dev @botfather/units-tools
```

All binaries are available after installation. They automatically skip `node_modules`, `.git`, `dist`, `build`, `.vite`, and similar output directories.

## Commands

### `units-format` — Format `.ui` files

Reads each `.ui` file, runs the canonical formatter, and writes back only the files that changed.

```sh
# Format a single file
units-format src/components/Button.ui

# Format all .ui files under a directory (recursive)
units-format src/
```

Outputs a count of changed files. Use in a pre-commit hook to keep diffs clean.

> `format-ui` is an alias for `units-format` with identical behavior.

---

### `units-lint` — Check formatting in CI

Checks that every `.ui` file is already canonically formatted. Exits non-zero if any file is not formatted, making it safe to use in CI pipelines.

```sh
# Lint specific paths
units-lint src/

# No args: defaults to linting examples/ and packages/units-uikit-shadcn/
lint-ui
```

> `lint-ui` is an alias for `units-lint`.

---

### `units-emit` — Pre-build AST sidecar files

Parses each `.ui` file and writes a `<file>.ui.ast.json` sidecar next to it. These sidecars are used by `vite-plugin-units` as a parse cache (loaded when the sidecar is newer than the source file), speeding up Vite's cold start.

```sh
units-emit src/
units-emit src/components/Button.ui
```

Run this as part of your build step or pre-dev script:

```json
{
  "scripts": {
    "prebuild": "units-emit src/",
    "predev": "units-emit src/"
  }
}
```

---

### `units-manifest` — Generate a static import manifest

Recursively collects all `.ui` files under `rootDir` and generates a JavaScript file that imports every one and exports them as a named map. Component names are derived from filenames (without extension).

```sh
units-manifest <rootDir> <outFile>

# Example
units-manifest src/components src/components/manifest.js
```

Generated output:

```js
import Ast_0 from "./Button.ui";
import Ast_1 from "./Card.ui";
import Ast_2 from "./Dialog.ui";

export const uiManifest = {
  "Button": Ast_0,
  "Card": Ast_1,
  "Dialog": Ast_2,
};
```

Import `uiManifest` anywhere in your app to get a `Record<string, AST>` of all compiled components.

---

### `units-watch` — Watch and rebuild on changes

Watches `rootDir` recursively. On any `.ui` file change, debounces 200 ms and re-runs `units-manifest` then `units-emit`. Handles `SIGINT` cleanly.

```sh
units-watch <rootDir> <outFile>

# Example
units-watch src/components src/components/manifest.js
```

Use this during development instead of relying solely on Vite's HMR when you need the manifest and sidecar files to stay up to date outside of Vite.

## Recommended workflow

```sh
# 1. Validate & normalize during development
units-format src/

# 2. Pre-build caches for faster dev server startup
units-emit src/

# 3. Generate the manifest for static imports
units-manifest src/components src/components/manifest.js

# 4. Watch for changes (long-running dev process)
units-watch src/components src/components/manifest.js

# 5. CI: fail if any file is not formatted
units-lint src/
```

## License

MIT
