import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createVerifiedProgramMetadata,
  writeVerifiedProgram,
} from "../packages/units/index.js";
import { createUnitsAgentService } from "../packages/units-agent-service/index.js";

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
    req.emit("end");
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
