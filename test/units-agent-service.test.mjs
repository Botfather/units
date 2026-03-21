import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import http from "node:http";
import test from "node:test";

import {
  createVerifiedProgramMetadata,
  writeVerifiedProgram,
} from "../packages/units/index.js";
import {
  createUnitsAgentHttpHandler,
  createUnitsAgentService,
  startUnitsAgentService,
} from "../packages/units-agent-service/index.js";

const DOM_TRANSFORM_PROGRAM = `
Program (kind:'transform', source:'dom') {
  Rule (id:'container_rule', match=@node.role == 'container') {
    Merge (strategy:'adjacentText', when=@child.role == 'text')
    Pass
  }
}
`;

async function invokeHttp(handler, { method, url, body }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  let destroyed = false;
  req.destroy = () => {
    destroyed = true;
  };

  const headers = {};
  let statusCode = 200;
  let responseBody = "";

  let resolveEnd;
  const ended = new Promise((resolve) => {
    resolveEnd = resolve;
  });

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value) {
      statusCode = Number(value);
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = String(value);
    },
    end(chunk = "") {
      responseBody += String(chunk || "");
      resolveEnd();
    },
  };

  const run = handler(req, res);
  process.nextTick(() => {
    if (body) req.emit("data", Buffer.from(body));
    if (!destroyed) req.emit("end");
  });

  await run;
  await ended;

  return {
    statusCode,
    headers,
    body: responseBody,
    json: () => JSON.parse(responseBody || "{}"),
  };
}

test("createUnitsAgentService exposes compress and HTTP handler behavior", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-agent-service-"));
  const libraryDir = path.join(tempDir, "library");

  const metadata = createVerifiedProgramMetadata({
    programSource: DOM_TRANSFORM_PROGRAM,
    sourceType: "dom",
    constraintsPassed: true,
    scores: {
      total: 1.2,
      R_completeness: 1,
      R_efficiency: 0.2,
      metrics: {},
    },
    programId: "dom-service-best",
  });

  await writeVerifiedProgram({
    directory: libraryDir,
    programSource: DOM_TRANSFORM_PROGRAM,
    metadata,
  });

  const service = createUnitsAgentService({
    libraryDir,
  });

  const direct = await service.compress({
    tree: {
      tagName: "div",
      children: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
        { tagName: "button", textContent: "Save" },
      ],
    },
    sourceType: "dom",
    target: "planner",
  });

  assert.equal(direct.programId, "dom-service-best");
  assert.equal(direct.unitsAst.type, "document");
  assert.ok(typeof direct.dsl === "string" && direct.dsl.length > 0);

  const health = await invokeHttp(service.handleHttpRequest, {
    method: "GET",
    url: service.healthEndpoint,
  });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);

  const compress = await invokeHttp(service.handleHttpRequest, {
    method: "POST",
    url: service.endpoint,
    body: JSON.stringify({
      tree: {
        tagName: "div",
        children: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
      },
      sourceType: "dom",
      target: "planner",
    }),
  });
  assert.equal(compress.statusCode, 200);
  const responseJson = compress.json();
  assert.equal(responseJson.programId, "dom-service-best");
  assert.equal(responseJson.unitsAst.type, "document");
});

test("service returns 400 when tree payload is missing", async () => {
  const service = createUnitsAgentService();

  const response = await invokeHttp(service.handleHttpRequest, {
    method: "POST",
    url: service.endpoint,
    body: JSON.stringify({
      sourceType: "dom",
    }),
  });

  assert.equal(response.statusCode, 400);
  const payload = response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "bad_request");
});

test("service returns 404 for unknown route and 500 for invalid JSON", async () => {
  const service = createUnitsAgentService({
    plugin: {
      async compressUiForAgent() {
        return { dsl: "UI {}", unitsAst: { type: "document" } };
      },
    },
  });

  const notFound = await invokeHttp(service.handleHttpRequest, {
    method: "GET",
    url: "/missing-route",
  });
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFound.json().error, "not_found");

  const invalidJson = await invokeHttp(service.handleHttpRequest, {
    method: "POST",
    url: service.endpoint,
    body: "{",
  });
  assert.equal(invalidJson.statusCode, 500);
  assert.equal(invalidJson.json().error, "internal_error");
});

test("service enforces maxBodyBytes and returns 413 for oversized payloads", async () => {
  const service = createUnitsAgentService({
    maxBodyBytes: 8,
    plugin: {
      async compressUiForAgent() {
        return { dsl: "UI {}", unitsAst: { type: "document" } };
      },
    },
  });

  const response = await invokeHttp(service.handleHttpRequest, {
    method: "POST",
    url: service.endpoint,
    body: JSON.stringify({
      tree: { tagName: "div" },
      sourceType: "dom",
    }),
  });

  assert.equal(response.statusCode, 413);
  assert.equal(response.json().error, "payload_too_large");
});

test("createUnitsAgentHttpHandler exposes a working request handler", async () => {
  const handler = createUnitsAgentHttpHandler({
    plugin: {
      async compressUiForAgent() {
        return {
          dsl: "UI { Button }",
          unitsAst: { type: "document" },
          transformed: false,
        };
      },
    },
  });

  const response = await invokeHttp(handler, {
    method: "POST",
    url: "/compress-ui",
    body: JSON.stringify({
      tree: {
        tagName: "div",
        children: [{ tagName: "button", textContent: "Save" }],
      },
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().unitsAst.type, "document");
});

test("startUnitsAgentService returns lifecycle helpers and close() works", async () => {
  const originalCreateServer = http.createServer;
  let closed = false;
  const fakePort = 43210;

  http.createServer = (handler) => {
    const listeners = new Map();
    return {
      once(event, callback) {
        listeners.set(event, callback);
      },
      listen(_port, _host, callback) {
        callback();
      },
      address() {
        return { port: fakePort };
      },
      close(callback) {
        closed = true;
        callback();
      },
      handler,
      listeners,
    };
  };

  try {
    const started = await startUnitsAgentService({
      host: "127.0.0.1",
      port: 0,
      plugin: {
        async compressUiForAgent(uiTree, options) {
          return {
            dsl: `UI (${options.sourceType || "dom"})`,
            unitsAst: { type: "document" },
            transformed: false,
            treeSeen: uiTree?.tagName || uiTree?.role || "unknown",
          };
        },
      },
    });

    assert.equal(started.url, `http://127.0.0.1:${fakePort}`);
    const health = await invokeHttp(started.service.handleHttpRequest, {
      method: "GET",
      url: started.healthEndpoint,
    });
    assert.equal(health.statusCode, 200);

    const compressed = await invokeHttp(started.service.handleHttpRequest, {
      method: "POST",
      url: started.endpoint,
      body: JSON.stringify({
        tree: {
          tagName: "div",
          children: [{ tagName: "button", textContent: "Pay" }],
        },
        sourceType: "dom",
      }),
    });
    assert.equal(compressed.statusCode, 200);
    assert.equal(compressed.json().treeSeen, "div");

    await started.close();
    assert.equal(closed, true);
  } finally {
    http.createServer = originalCreateServer;
  }
});
