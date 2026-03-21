# @botfather/units-dom-snapshot

DOM snapshot extraction utilities for arbitrary web pages.

## What this package provides

- `snapshotUi()` for browser contexts (`window` + `document`).
- `snapshotUiFromRoot(root, options)` for direct root extraction and testing.
- `captureSnapshotWithPlaywright(options)` for Node-side page capture via Playwright.

Snapshots are neutral `UiNode` trees intended to feed Units transform pipelines and agent middleware.

## Browser usage

```js
import { snapshotUi } from "@botfather/units-dom-snapshot";

const uiTree = snapshotUi({
  rootSelector: "body",
  maxDepth: 40,
  pruneInvisible: true,
  pruneOffscreen: true,
});
```

## Playwright usage

```js
import { captureSnapshotWithPlaywright } from "@botfather/units-dom-snapshot";

const { snapshot } = await captureSnapshotWithPlaywright({
  url: "https://example.com",
  browserType: "chromium",
  rootSelector: "body",
  snapshotOptions: {
    pruneInvisible: true,
    pruneOffscreen: true,
  },
});
```

If Playwright is not installed, `captureSnapshotWithPlaywright` throws an actionable error.
