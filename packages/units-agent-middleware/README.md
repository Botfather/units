# @botfather/units-agent-middleware

Framework-agnostic middleware that rewrites host UI trees using verified Units transform programs before passing data to an LLM agent.

## Install

```sh
npm install @botfather/units-agent-middleware @botfather/units
```

## Usage

```js
import { createUnitsAgentMiddleware } from "@botfather/units-agent-middleware";

const middleware = createUnitsAgentMiddleware({
  libraryDir: ".units/library",
  gates: {
    action_recall: 1,
    name_recall: 0.98,
    text_f1: 0.95,
  },
});

const result = await middleware.rewrite({
  tree: rawDomLikeTree,
  sourceType: "dom",
  taskContext: { task: "summarize_ui" },
});
```

`rewrite` returns transformed tree output, trace metadata, chosen program metadata, and fallback pass-through output when no verified program passes gates.
