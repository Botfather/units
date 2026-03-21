# @botfather/units-agent-plugin

Agent-facing compression plugin that turns raw UI trees into compact Units DSL context.

## Install

```sh
npm install @botfather/units-agent-plugin
```

## Usage

```js
import { compressUiForAgent } from "@botfather/units-agent-plugin";

const result = await compressUiForAgent(uiTree, {
  sourceType: "dom",
  target: "planner",
  maxTokens: 600,
  pluginConfig: {
    libraryDir: ".units/library",
  },
});

console.log(result.dsl);
console.log(result.unitsAst);
console.log(result.programId);
```

Returns:
- `dsl`: compressed Units source text
- `unitsAst`: parsed Units AST
- `programId`: selected transform program id (or `null`)
- `tokenEstimate`: rough token estimate for the generated DSL
- `rewrite` and `compile`: full debug payloads from middleware + compiler

## Exports

- `createUnitsAgentPlugin(config)`
- `compressUiForAgent(uiTree, options)`
