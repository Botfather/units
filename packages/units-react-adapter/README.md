# @botfather/units-react-adapter

React element tree adapter that converts JSX/React elements into the Units `UiNode` IR.

## Install

```sh
npm install @botfather/units-react-adapter @botfather/units-ui-ir
```

## Usage

```js
import { normalizeReactTree } from "@botfather/units-react-adapter";

const uiIr = normalizeReactTree(reactElementTree);
```

The output `uiIr` is compatible with:
- `@botfather/units-compiler` (`sourceType: "ir"` or `"react"`)
- `@botfather/units-agent-plugin` (`sourceType: "react"`)
- transform/reward/middleware pipelines that expect Units IR.

## Exports

- `isReactElementLike(value)`
- `normalizeReactNode(input, path, options?)`
- `normalizeReactTree(input, options?)`
- alias: `reactElementToUiNode(input, options?)`
