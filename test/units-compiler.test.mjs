import assert from "node:assert/strict";
import test from "node:test";

import { parseUnits } from "../packages/units/index.js";
import { compileUiToUnits } from "../packages/units-compiler/index.js";

const MERGE_TEXT_PROGRAM = `
Program (kind:'transform', source:'ir') {
  Rule (id:'container_rule', match=@node.role == 'container') {
    Merge (strategy:'adjacentText', when=@child.role == 'text')
    Pass
  }
}
`;

test("compileUiToUnits compiles IR trees into parseable Units DSL/AST", () => {
  const uiTree = {
    id: "root",
    role: "container",
    name: "Checkout",
    text: "",
    props: {},
    state: {},
    actions: [],
    meta: {},
    children: [
      {
        id: "primary",
        role: "button",
        name: "Buy now",
        text: "Buy now",
        props: {},
        state: {},
        actions: ["click"],
        meta: {},
        children: [],
      },
    ],
  };

  const result = compileUiToUnits(uiTree, {
    sourceType: "ir",
    enableLoopHeuristic: false,
  });

  assert.equal(result.ast.type, "document");
  assert.match(result.dsl, /Container/);
  assert.match(result.dsl, /Button/);
  assert.match(result.dsl, /Buy now/);

  const reparsed = parseUnits(result.dsl);
  assert.equal(reparsed.type, "document");
});

test("compileUiToUnits applies transform program before emitting DSL", () => {
  const uiTree = {
    id: "root",
    role: "container",
    name: "",
    text: "",
    props: {},
    state: {},
    actions: [],
    meta: {},
    children: [
      {
        id: "t1",
        role: "text",
        name: "",
        text: "hello",
        props: {},
        state: {},
        actions: [],
        meta: {},
        children: [],
      },
      {
        id: "t2",
        role: "text",
        name: "",
        text: "world",
        props: {},
        state: {},
        actions: [],
        meta: {},
        children: [],
      },
    ],
  };

  const result = compileUiToUnits(uiTree, MERGE_TEXT_PROGRAM, {
    sourceType: "ir",
    enableLoopHeuristic: false,
  });

  assert.equal(result.program.source_type, "ir");
  assert.ok(Array.isArray(result.trace));
  assert.match(result.dsl, /hello world/);
  assert.ok(!/\n\s*'hello'\n\s*'world'/.test(result.dsl));
});

test("compileUiToUnits emits #for loops for repeated leaf siblings", () => {
  const uiTree = {
    id: "root",
    role: "container",
    name: "",
    text: "",
    props: {},
    state: {},
    actions: [],
    meta: {},
    children: [
      {
        id: "i1",
        role: "button",
        name: "Add milk",
        text: "Add milk",
        props: {},
        state: {},
        actions: ["click"],
        meta: {},
        children: [],
      },
      {
        id: "i2",
        role: "button",
        name: "Add eggs",
        text: "Add eggs",
        props: {},
        state: {},
        actions: ["click"],
        meta: {},
        children: [],
      },
      {
        id: "i3",
        role: "button",
        name: "Add bread",
        text: "Add bread",
        props: {},
        state: {},
        actions: ["click"],
        meta: {},
        children: [],
      },
    ],
  };

  const result = compileUiToUnits(uiTree, {
    sourceType: "ir",
    enableLoopHeuristic: true,
    minLoopGroupSize: 3,
  });

  assert.match(result.dsl, /#for /);
  assert.match(result.dsl, /in @\(\[/);

  const reparsed = parseUnits(result.dsl);
  assert.equal(reparsed.type, "document");
  assert.equal(result.stats.loop_groups, 1);
});
