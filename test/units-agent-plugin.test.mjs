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

function makeIrTree(count = 10) {
  const children = [];
  for (let index = 0; index < count; index++) {
    children.push({
      id: `btn_${index}`,
      role: "button",
      name: `Action ${index}`,
      text: "",
      props: {},
      state: {
        disabled: index % 2 === 0,
      },
      actions: ["click"],
      meta: {},
      children: [],
    });
  }

  return {
    id: "root",
    role: "container",
    name: "Root",
    text: "",
    props: {},
    state: {
      expanded: true,
    },
    actions: [],
    meta: {},
    children,
  };
}

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

test("plugin handles target/source aliases and applies token-budget compression passes", async () => {
  const rewriteCalls = [];
  const middleware = {
    async rewrite(payload) {
      rewriteCalls.push(payload);
      return {
        transformed: false,
        source_type: payload.sourceType,
        tree: payload.tree,
        normalized_tree: payload.tree,
        agent_tree: payload.tree,
        trace: [],
        selected_program: null,
      };
    },
    async listPrograms() {
      return [];
    },
  };

  const plugin = createUnitsAgentPlugin({
    middleware,
    target: "unknown-target",
  });
  assert.equal(plugin.config.target, "chat");

  const budgeted = await plugin.compressUiForAgent(makeIrTree(16), {
    sourceType: "accessibility",
    target: "plan",
    maxTokens: 0,
  });

  assert.equal(budgeted.sourceType, "a11y");
  assert.equal(budgeted.target, "planner");
  assert.equal(budgeted.budgetApplied, true);
  assert.equal(rewriteCalls[0].sourceType, "a11y");

  const baseline = await plugin.compressUiForAgent(makeIrTree(16), {
    sourceType: "dom",
    target: "plan",
  });
  const pass1Shape = await plugin.compressUiForAgent(makeIrTree(16), {
    sourceType: "dom",
    target: "plan",
    compilerOptions: {
      includeId: false,
      includeState: false,
      enableLoopHeuristic: true,
      minLoopGroupSize: 2,
    },
  });
  assert.ok(baseline.tokenEstimate >= pass1Shape.tokenEstimate);

  const pass1Budget = await plugin.compressUiForAgent(makeIrTree(16), {
    sourceType: "dom",
    target: "plan",
    maxTokens: pass1Shape.tokenEstimate,
  });
  assert.equal(pass1Budget.budgetApplied, true);
  assert.ok(pass1Budget.tokenEstimate <= pass1Shape.tokenEstimate);

  const jsxCallIndex = rewriteCalls.length;
  const jsxAlias = await plugin.compressUiForAgent(
    el("div", {}, el("button", { onClick: () => {} }, "Go")),
    {
      sourceType: "jsx",
      target: "image",
      maxTokens: "NaN",
    },
  );

  assert.equal(jsxAlias.sourceType, "react");
  assert.equal(jsxAlias.rewriteSourceType, "ir");
  assert.equal(jsxAlias.target, "vision");
  assert.equal(jsxAlias.maxTokens, null);
  assert.equal(jsxAlias.budgetApplied, false);
  assert.equal(rewriteCalls[jsxCallIndex].sourceType, "ir");

  const executorAlias = await plugin.compressUiForAgent(makeIrTree(2), {
    sourceType: "dom",
    target: "executor",
  });
  assert.equal(executorAlias.target, "chat");
});

test("plugin listPrograms delegates to middleware", async () => {
  let receivedSourceType = null;
  const plugin = createUnitsAgentPlugin({
    middleware: {
      async rewrite() {
        return {
          transformed: false,
          source_type: "dom",
          tree: null,
          normalized_tree: null,
          agent_tree: null,
          trace: [],
          selected_program: null,
        };
      },
      async listPrograms(sourceType) {
        receivedSourceType = sourceType;
        return [
          {
            source: "Program (kind:'transform', source:'dom') {}",
            metadata: { program_id: "p1" },
          },
        ];
      },
    },
  });

  const programs = await plugin.listPrograms("accessibility");
  assert.equal(receivedSourceType, "accessibility");
  assert.equal(programs.length, 1);
  assert.equal(programs[0].metadata.program_id, "p1");
});
