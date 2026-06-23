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

Slack Block Kit payloads may be passed as a full message (`{ blocks: [...] }`), a `blocks` array, a single block, a Slack text object, or a raw `mrkdwn` string. `mrkdwn` text is normalized into IR roles for styles, links, mentions, channels, user groups, special mentions, dates, quotes, and code spans.

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
