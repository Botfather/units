# @botfather/units-compiler

Compile host-agnostic UI trees into Units AST/DSL.

## Install

```sh
npm install @botfather/units-compiler @botfather/units
```

## Usage

```js
import { compileUiToUnits } from "@botfather/units-compiler";

const result = compileUiToUnits(uiTree, {
  sourceType: "dom",
  program: transformProgramSource,
});

console.log(result.dsl);
console.log(result.ast);
```

`compileUiToUnits` pipeline:
- Detect/normalize host tree into Units IR (`dom`, `a11y`, `react`, `slack`, or `ir`)
- Optionally run a Units transform program
- Emit Units DSL (with small structural heuristics like `#for` on repeated leaf siblings)
- Parse DSL back into Units AST

Slack Block Kit payloads can be compiled with `sourceType: "slack"`. Text objects using `type: "mrkdwn"` are normalized into regular IR nodes for Slack styles, links, mentions, channels, special mentions, dates, quotes, and code spans without changing the Units grammar.

```js
const slackResult = compileUiToUnits(blockKitPayload, {
  sourceType: "slack",
});
```

For token efficiency, implicit actions are omitted by default (`button -> click`, `input -> input`, etc). Set `includeImplicitActions: true` to always emit explicit action props.

The compiler also compacts redundant leaf `name`/text duplication by default. When a leaf node has identical `name` and text, it emits a single compact form (`Button (name:'Save')`) instead of both representations. Set `includeRedundantName: true` and/or `includeRedundantLeafText: true` to keep explicit duplicates.

## Exports

- `compileUiToUnits(uiRoot, programOrOptions?, maybeOptions?)`
- `compileUiToUnitsDsl(uiRoot, programOrOptions?, maybeOptions?)`
