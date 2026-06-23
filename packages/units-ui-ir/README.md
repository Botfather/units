# @botfather/units-ui-ir

Host-agnostic UiNode IR schema and normalization adapters for Units transform/compiler pipelines.

## Install

```sh
npm install @botfather/units-ui-ir
```

## Usage

```js
import {
  normalizeDomUiTree,
  normalizeA11yUiTree,
  normalizeSlackBlockKitTree,
  normalizeUiNode,
  serializeCompactUiTree,
} from "@botfather/units-ui-ir";

const domIr = normalizeDomUiTree(domSnapshot);
const a11yIr = normalizeA11yUiTree(axTree);
const slackIr = normalizeSlackBlockKitTree(blockKitPayload);
const ir = normalizeUiNode(rawIrLikeTree);

const compact = serializeCompactUiTree(ir, {
  includeIds: false,
});
```

## Exports

- `inferRoleFromTag(tagName, explicitRole?)`
- `normalizeUiNode(node, defaults?)`
- `normalizeDomUiTree(input)`
- `normalizeA11yUiTree(input)`
- `normalizeSlackBlockKitTree(input, options?)`
- `parseSlackMrkdwn(text, options?)`
- `normalizeUiTree(input, sourceType?)`
- `serializeCompactUiTree(uiTree, options?)`
- Alias exports: `normalizeIrNode`, `normalizeDomTree`, `normalizeA11yTree`, `normalizeSlackTree`, `serializeAgentTree`
