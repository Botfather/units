# @botfather/units-agent-service

HTTP service wrapper for agent-facing UI compression.

## Install

```sh
npm install @botfather/units-agent-service
```

## Quick start

```js
import { startUnitsAgentService } from "@botfather/units-agent-service";

const service = await startUnitsAgentService({
  host: "127.0.0.1",
  port: 8787,
  libraryDir: ".units/library",
});

console.log(service.url); // http://127.0.0.1:8787
```

### Endpoints

- `GET /healthz`
- `POST /compress-ui`

Request payload for `POST /compress-ui`:

```json
{
  "tree": { "tagName": "div", "children": [] },
  "sourceType": "dom",
  "target": "planner",
  "maxTokens": 600
}
```

Response payload includes:
- `dsl`
- `unitsAst`
- `programId`
- `tokenEstimate`
- `rewrite` / `compile` diagnostics

## Exports

- `createUnitsAgentService(config)`
- `createUnitsAgentHttpHandler(config)`
- `startUnitsAgentService(config)`
