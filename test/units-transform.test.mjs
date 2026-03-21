import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  parseUnits,
  formatUnits,
  createUnitsEvaluator,
  createUnitsRenderer,
  renderUnits,
  compileTransformProgram,
  runTransformProgram,
  normalizeDomTree,
  normalizeA11yTree,
  serializeAgentTree,
  scoreProgram,
  verifyProgram,
  createVerifiedProgramMetadata,
  writeVerifiedProgram,
  runSynthesisLoop,
} from "../packages/units/index.js";
import { createUnitsAgentMiddleware } from "../packages/units-agent-middleware/index.js";

const TRANSFORM_PROGRAM = `
Program (kind:'transform', source:'dom') {
  Rule (id:'container_rule', match=@node.role == 'container') {
    Filter (when=@node.state.hidden !== true)
    Merge (strategy:'adjacentText', when=@child.role == 'text')
    Pass
  }
  Rule (id:'text_rule', match=@node.role == 'text') {
    Filter (when=@node.text != '')
    Pass
  }
}
`;

test("backward-compat parse/format/render still works for regular UI DSL", () => {
  const src = `
App {
  text 'Hello'
  #if (@show) {
    text 'World'
  }
}
`;

  const ast = parseUnits(src);
  const formatted = formatUnits(src);
  const rendered = renderUnits(ast, { show: true }, {});

  assert.equal(ast.type, "document");
  assert.match(formatted, /App \{/);
  assert.ok(Array.isArray(rendered));
  assert.equal(rendered[0].type, "App");
});

test("expression normalization preserves literal @ characters and set(x:=...) behavior", () => {
  const evalExpr = createUnitsEvaluator();
  const setCalls = [];
  const scope = {
    item: {
      id: 7,
    },
    set: (path, value) => setCalls.push([path, value]),
  };

  assert.equal(evalExpr("'foo@bar.com'", scope), "foo@bar.com");
  assert.equal(evalExpr("'@a'", scope), "@a");
  evalExpr("set(selected:=@item.id)", scope);
  assert.deepEqual(setCalls, [["selected", 7]]);
});

test("custom renderer matches runtime control-flow semantics for #key and if/elif/else", () => {
  const ast = parseUnits(`
List {
  #for (item in @items) {
    #key (@item.id)
    Row {
      @item.label
    }
  }
  #if (@showA) {
    text 'A'
  }
  #elif (@showB) {
    text 'B'
  }
  #else {
    text 'C'
  }
}
`);

  const renderer = createUnitsRenderer({
    element: (name, props, events, children) => ({ type: name, props, events, children }),
    text: (value) => value,
    fragment: (children) => children,
  });

  const rendered = renderer.render(ast, {
    items: [
      { id: "r1", label: "One" },
      { id: "r2", label: "Two" },
    ],
    showA: false,
    showB: true,
  });

  assert.ok(Array.isArray(rendered));
  assert.equal(rendered.length, 1);

  const listNode = rendered[0];
  assert.equal(listNode.type, "List");

  const flattenedChildren = Array.isArray(listNode.children)
    ? listNode.children.flat(Infinity)
    : [];

  const rows = flattenedChildren.filter((node) => node && typeof node === "object" && node.type === "Row");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].props.key, "r1");
  assert.equal(rows[1].props.key, "r2");
  assert.ok(flattenedChildren.includes("B"));
  assert.ok(!flattenedChildren.includes("C"));
});

test("transform runtime applies first-match rules, deterministic op order, and implicit pass", () => {
  const program = compileTransformProgram(TRANSFORM_PROGRAM);
  const inputTree = {
    id: "root",
    role: "container",
    name: "Root",
    state: { hidden: false },
    actions: [],
    props: {},
    text: "",
    meta: {},
    children: [
      { id: "t1", role: "text", name: "", text: "hello", props: {}, state: {}, actions: [], meta: {}, children: [] },
      { id: "t2", role: "text", name: "", text: "world", props: {}, state: {}, actions: [], meta: {}, children: [] },
      { id: "btn", role: "button", name: "Save", text: "", props: {}, state: {}, actions: ["click"], meta: {}, children: [] },
      {
        id: "hidden",
        role: "container",
        name: "Hidden",
        text: "",
        props: {},
        state: { hidden: true },
        actions: [],
        meta: {},
        children: [
          { id: "hidden_text", role: "text", name: "", text: "remove-me", props: {}, state: {}, actions: [], meta: {}, children: [] },
        ],
      },
    ],
  };

  const run = runTransformProgram(program, inputTree);

  assert.equal(run.tree.children.length, 2, "hidden branch removed and text nodes merged");
  assert.equal(run.tree.children[0].role, "text");
  assert.equal(run.tree.children[0].text, "hello world");

  const rootTrace = run.trace.find((item) => item.node_id === "root");
  assert.ok(rootTrace);
  assert.deepEqual(
    rootTrace.operations.map((item) => item.kind),
    ["filter", "merge", "pass"],
    "operation order should always be Filter -> Merge -> Pass",
  );
  assert.equal(rootTrace.rule_id, "container_rule");

  const buttonTrace = run.trace.find((item) => item.node_id === "btn");
  assert.ok(buttonTrace);
  assert.equal(buttonTrace.rule_id, null);
  assert.equal(buttonTrace.operations[0].kind, "pass");
  assert.equal(buttonTrace.operations[0].implicit, true);
});

test("DOM and A11y adapters normalize equivalent semantics", () => {
  const domInput = {
    tagName: "div",
    children: [
      {
        tagName: "button",
        id: "save-btn",
        attributes: { "aria-label": "Save" },
        textContent: "Save",
      },
    ],
  };

  const a11yInput = {
    role: "container",
    children: [
      {
        id: "save-btn",
        role: "button",
        name: "Save",
        text: "Save",
        actions: ["click"],
      },
    ],
  };

  const domIr = normalizeDomTree(domInput);
  const a11yIr = normalizeA11yTree(a11yInput);

  assert.equal(domIr.children[0].role, a11yIr.children[0].role);
  assert.equal(domIr.children[0].name, a11yIr.children[0].name);
  assert.ok(domIr.children[0].actions.includes("click"));
  assert.ok(a11yIr.children[0].actions.includes("click"));
});

test("core DOM normalizer preserves table/row/cell role semantics", () => {
  const domInput = {
    tagName: "table",
    children: [
      {
        tagName: "tr",
        children: [
          {
            tagName: "td",
            textContent: "R1C1",
          },
        ],
      },
    ],
  };

  const normalized = normalizeDomTree(domInput);
  assert.equal(normalized.role, "table");
  assert.equal(normalized.children[0].role, "row");
  assert.equal(normalized.children[0].children[0].role, "cell");
});

test("reward verifier rejects semantic-loss outputs even when compressed", () => {
  const inputTree = {
    id: "root",
    role: "container",
    name: "Root",
    text: "",
    props: {},
    state: {},
    actions: [],
    meta: {},
    children: [
      { id: "btn", role: "button", name: "Save", text: "Save now", props: {}, state: {}, actions: ["click"], meta: {}, children: [] },
    ],
  };

  const lossyOutput = {
    id: "root",
    role: "container",
    name: "",
    text: "",
    props: {},
    state: {},
    actions: [],
    meta: {},
    children: [
      { id: "txt", role: "text", name: "", text: "save", props: {}, state: {}, actions: [], meta: {}, children: [] },
    ],
  };

  const score = scoreProgram({ inputTree, outputTree: lossyOutput });
  const verification = verifyProgram(score);

  assert.equal(verification.passed, false);
  assert.ok(verification.failures.some((item) => item.metric === "action_recall"));
});

test("golden transform output stays stable", () => {
  const program = compileTransformProgram(TRANSFORM_PROGRAM);
  const inputTree = {
    id: "root",
    role: "container",
    name: "",
    text: "",
    props: {},
    state: { hidden: false },
    actions: [],
    meta: {},
    children: [
      { id: "t1", role: "text", name: "", text: "alpha", props: {}, state: {}, actions: [], meta: {}, children: [] },
      { id: "t2", role: "text", name: "", text: "beta", props: {}, state: {}, actions: [], meta: {}, children: [] },
    ],
  };

  const run = runTransformProgram(program, inputTree);
  const agentTree = serializeAgentTree(run.tree);

  assert.deepEqual(agentTree, {
    role: "container",
    id: "root",
    state: {
      hidden: false,
    },
    children: [
      {
        role: "text",
        id: "t1",
        text: "alpha beta",
      },
    ],
  });
});

test("middleware rewrites with verified library and falls back when no program passes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-mw-"));
  const libraryDir = path.join(tempDir, "library");
  const metadata = createVerifiedProgramMetadata({
    programSource: TRANSFORM_PROGRAM,
    sourceType: "dom",
    scores: {
      total: 1.2,
      R_completeness: 1,
      R_efficiency: 0.2,
      metrics: {},
    },
    constraintsPassed: true,
    programId: "dom-best",
  });

  await writeVerifiedProgram({
    directory: libraryDir,
    programSource: TRANSFORM_PROGRAM,
    metadata,
  });

  const middleware = createUnitsAgentMiddleware({ libraryDir });
  const rawTree = {
    tagName: "div",
    children: [
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ],
  };

  const transformed = await middleware.rewrite({
    tree: rawTree,
    sourceType: "dom",
  });

  assert.equal(transformed.transformed, true);
  assert.equal(transformed.selected_program.program_id, "dom-best");
  assert.ok(Array.isArray(transformed.trace));
  assert.equal(transformed.tree.children.length, 1);

  const emptyMiddleware = createUnitsAgentMiddleware({
    libraryDir: path.join(tempDir, "empty-library"),
  });
  const fallback = await emptyMiddleware.rewrite({ tree: rawTree, sourceType: "dom" });
  assert.equal(fallback.transformed, false);
  assert.deepEqual(fallback.tree, rawTree);
});

test("synthesis loop promotes candidates that improve reward by threshold", async () => {
  const seedProgram = `
Program (kind:'transform', source:'dom') {
  Rule (match=@node.role == 'container') {
    Pass
  }
}
`;

  const dataset = [
    {
      id: "case_1",
      sourceType: "ir",
      inputTree: {
        id: "root",
        role: "container",
        name: "Root",
        text: "",
        props: {},
        state: { hidden: false },
        actions: [],
        meta: {},
        children: [
          { id: "t1", role: "text", name: "", text: "hello", props: {}, state: {}, actions: [], meta: {}, children: [] },
          { id: "t2", role: "text", name: "", text: "world", props: {}, state: {}, actions: [], meta: {}, children: [] },
          { id: "btn", role: "button", name: "Save", text: "", props: {}, state: {}, actions: ["click"], meta: {}, children: [] },
        ],
      },
      expectations: {
        expectedActions: ["click"],
        expectedNames: ["Root", "Save"],
      },
    },
  ];

  const result = await runSynthesisLoop({
    seedPrograms: [{ source: seedProgram }],
    dataset,
    rounds: 1,
    candidatesPerRound: 4,
    minDelta: 0.01,
    gates: {
      action_recall: 1,
      name_recall: 0.98,
      text_f1: 0.95,
    },
  });

  assert.ok(result.history.length >= 1);
  assert.ok(result.library.length >= 1);
  assert.ok(result.best);
  assert.ok(result.best.evaluation.score.total >= 0);
  assert.ok(result.promoted.length >= 1, "expected at least one promoted candidate");
});

test("transform runtime stays within sane latency budget on medium tree", () => {
  const program = compileTransformProgram(`
Program (kind:'transform', source:'ir') {
  Rule (match=@node.role == 'container') {
    Merge (strategy:'adjacentText', when=@child.role == 'text')
    Pass
  }
}
`);

  const children = [];
  for (let i = 0; i < 1000; i++) {
    children.push({
      id: `t${i}`,
      role: i % 2 === 0 ? "text" : "button",
      name: i % 2 === 0 ? "" : `Button ${i}`,
      text: i % 2 === 0 ? `word${i}` : "",
      props: {},
      state: {},
      actions: i % 2 === 0 ? [] : ["click"],
      meta: {},
      children: [],
    });
  }

  const inputTree = {
    id: "root",
    role: "container",
    name: "Root",
    text: "",
    props: {},
    state: {},
    actions: [],
    meta: {},
    children,
  };

  const start = performance.now();
  const run = runTransformProgram(program, inputTree);
  const elapsed = performance.now() - start;

  assert.ok(run.tree.children.length > 0);
  assert.ok(elapsed < 2000, `expected transform to complete in <2000ms, got ${elapsed}ms`);
});

test("transform expressions preserve @ in string literals", () => {
  const program = compileTransformProgram(`
Program (kind:'transform', source:'ir') {
  Rule (id:'text_exact_match', match=@node.role == 'text') {
    Filter (when=@node.text == 'foo@bar.com')
    Pass
  }
}
`);

  const inputTree = {
    id: "t1",
    role: "text",
    name: "",
    text: "foo@bar.com",
    props: {},
    state: {},
    actions: [],
    meta: {},
    children: [],
  };

  const run = runTransformProgram(program, inputTree);
  assert.ok(run.tree);
  assert.equal(run.tree.text, "foo@bar.com");
});
