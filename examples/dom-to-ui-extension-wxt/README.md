# DOM to `.ui` Browser Extension (WXT)

Cross-browser extension example that captures the active page DOM and compiles it into Units `.ui` DSL.

## What it does

- Runs a content script on the current page.
- Uses `@botfather/units-dom-snapshot` to extract a normalized UI tree.
- Converts that `UiNode` tree into Units `.ui` DSL with a browser-safe emitter in `entrypoints/content.js`.
- Shows the generated `.ui` in the popup, with Copy and Download actions.

## Run

```sh
pnpm install
pnpm --filter units-dom-to-ui-extension dev
```

## Build

```sh
pnpm --filter units-dom-to-ui-extension build:all
```

From the monorepo root, you can also use:

```sh
pnpm ext:dom-to-ui:build
pnpm ext:dom-to-ui:zip
pnpm ext:dom-to-ui:bundle
```

You can also build browser-specific bundles:

```sh
pnpm --filter units-dom-to-ui-extension build:chrome
pnpm --filter units-dom-to-ui-extension build:firefox
pnpm --filter units-dom-to-ui-extension build:edge
```

## Load in browser

Use each browser's unpacked-extension flow with the generated folder:

- Chrome: `examples/dom-to-ui-extension-wxt/.output/chrome-mv3/`
- Firefox: `examples/dom-to-ui-extension-wxt/.output/firefox-mv2/`
- Edge: `examples/dom-to-ui-extension-wxt/.output/edge-mv3/`

## Notes

- Restricted pages (`chrome://*`, extension pages, web stores) cannot be captured.
- If capture fails right after install/reload, refresh the tab once so the content script attaches.
- Large pages may produce long `.ui` output; tune snapshot/compile options in `entrypoints/content.js` as needed.
- This example prioritizes readable DSL output and broad compatibility over aggressive compression.
