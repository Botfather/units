import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createVerifiedProgramMetadata,
  writeVerifiedProgram,
} from "../packages/units/index.js";
import {
  createUnitsAgentPlugin,
  compressUiForAgent,
} from "../packages/units-agent-plugin/index.js";

const REACT_ELEMENT_TYPE = Symbol.for("react.element");

function el(type, props = {}, ...children) {
  const nextProps = {
    ...props,
  };

  if (children.length === 1) nextProps.children = children[0];
  else if (children.length > 1) nextProps.children = children;

  return {
    $$typeof: REACT_ELEMENT_TYPE,
    type,
    key: props.key ?? null,
    props: nextProps,
  };
}

const DOM_TRANSFORM_PROGRAM = `
Program (kind:'transform', source:'dom') {
  Rule (id:'container_rule', match=@node.role == 'container') {
    Merge (strategy:'adjacentText', when=@child.role == 'text')
    Pass
  }
}
`;

test("createUnitsAgentPlugin compresses UI and returns DSL/AST/programId", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-agent-plugin-"));
  const libraryDir = path.join(tempDir, "library");

  const metadata = createVerifiedProgramMetadata({
    programSource: DOM_TRANSFORM_PROGRAM,
    sourceType: "dom",
    constraintsPassed: true,
    scores: {
      total: 1.1,
      R_completeness: 1,
      R_efficiency: 0.1,
      metrics: {},
    },
    programId: "dom-best-plugin",
  });

  await writeVerifiedProgram({
    directory: libraryDir,
    programSource: DOM_TRANSFORM_PROGRAM,
    metadata,
  });

  const plugin = createUnitsAgentPlugin({
    libraryDir,
    target: "planner",
  });

  const inputTree = {
    tagName: "div",
    children: [
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
      {
        tagName: "button",
        textContent: "Save",
        attributes: {
          "aria-label": "Save",
        },
      },
    ],
  };

  const result = await plugin.compressUiForAgent(inputTree, {
    sourceType: "dom",
    maxTokens: 200,
  });

  assert.equal(result.programId, "dom-best-plugin");
  assert.equal(result.transformed, true);
  assert.equal(result.unitsAst.type, "document");
  assert.match(result.dsl, /Container|UI/);
  assert.ok(result.tokenEstimate > 0);
  assert.ok(result.rewrite);
  assert.ok(result.compile);
});

test("compressUiForAgent convenience export works with no verified program", async () => {
  const inputTree = {
    tagName: "div",
    children: [
      {
        tagName: "button",
        textContent: "Submit",
      },
    ],
  };

  const result = await compressUiForAgent(inputTree, {
    sourceType: "dom",
    target: "chat",
    pluginConfig: {
      libraryDir: path.join(os.tmpdir(), `units-empty-${Date.now()}`),
    },
  });

  assert.equal(result.programId, null);
  assert.equal(result.unitsAst.type, "document");
  assert.ok(typeof result.dsl === "string" && result.dsl.length > 0);
});

test("compressUiForAgent supports sourceType react and rewrites through IR", async () => {
  const reactTree = el(
    "div",
    { id: "checkout" },
    el("button", { onClick: () => {} }, "Pay"),
  );

  const result = await compressUiForAgent(reactTree, {
    sourceType: "react",
    target: "chat",
    pluginConfig: {
      libraryDir: path.join(os.tmpdir(), `units-react-empty-${Date.now()}`),
    },
  });

  assert.equal(result.programId, null);
  assert.equal(result.sourceType, "react");
  assert.equal(result.rewriteSourceType, "ir");
  assert.match(result.dsl, /Button/);
  assert.equal(result.unitsAst.type, "document");
});
