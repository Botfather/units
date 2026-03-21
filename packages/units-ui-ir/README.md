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
  normalizeUiNode,
  serializeCompactUiTree,
} from "@botfather/units-ui-ir";

const domIr = normalizeDomUiTree(domSnapshot);
const a11yIr = normalizeA11yUiTree(axTree);
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
- `normalizeUiTree(input, sourceType?)`
- `serializeCompactUiTree(uiTree, options?)`
- Alias exports: `normalizeIrNode`, `normalizeDomTree`, `normalizeA11yTree`, `serializeAgentTree`
