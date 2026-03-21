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
- Detect/normalize host tree into Units IR (`dom`, `a11y`, or `ir`)
- Optionally run a Units transform program
- Emit Units DSL (with small structural heuristics like `#for` on repeated leaf siblings)
- Parse DSL back into Units AST

## Exports

- `compileUiToUnits(uiRoot, programOrOptions?, maybeOptions?)`
- `compileUiToUnitsDsl(uiRoot, programOrOptions?, maybeOptions?)`
