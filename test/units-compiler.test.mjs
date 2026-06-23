import assert from "node:assert/strict";
import test from "node:test";

import { parseUnits } from "../packages/units/units-parser.js";
import { compileUiToUnits } from "../packages/units-compiler/index.js";

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

test("compileUiToUnits accepts sourceType react and normalizes JSX-style trees", () => {
  const reactTree = el(
    "div",
    { id: "screen" },
    "Checkout",
    el("button", { id: "submit", onClick: () => {} }, "Submit order"),
  );

  const result = compileUiToUnits(reactTree, {
    sourceType: "react",
    enableLoopHeuristic: false,
  });

  assert.equal(result.source_type, "react");
  assert.match(result.dsl, /Container/);
  assert.match(result.dsl, /Button/);
  assert.match(result.dsl, /Submit order/);

  const reparsed = parseUnits(result.dsl);
  assert.equal(reparsed.type, "document");
});

test("compileUiToUnits omits implicit role actions unless explicitly requested", () => {
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
        id: "save",
        role: "button",
        name: "Save",
        text: "Save",
        props: {},
        state: {},
        actions: ["click"],
        meta: {},
        children: [],
      },
      {
        id: "danger",
        role: "button",
        name: "Escalate",
        text: "Escalate",
        props: {},
        state: {},
        actions: ["click", "longpress"],
        meta: {},
        children: [],
      },
    ],
  };

  const optimized = compileUiToUnits(uiTree, {
    sourceType: "ir",
    enableLoopHeuristic: false,
  });
  assert.doesNotMatch(optimized.dsl, /Button \([^)]*name:'Save'[^)]*actions:'click'/s);
  assert.match(optimized.dsl, /Button \([^)]*name:'Escalate'[^)]*actions:'click\|longpress'/s);

  const explicit = compileUiToUnits(uiTree, {
    sourceType: "ir",
    enableLoopHeuristic: false,
    includeImplicitActions: true,
  });
  assert.match(explicit.dsl, /Button \([^)]*name:'Save'[^)]*actions:'click'/s);
});

test("compileUiToUnits accepts Slack Block Kit mrkdwn payloads", () => {
  const slackPayload = {
    channel: "C123ABC456",
    text: "Release request",
    blocks: [
      {
        type: "section",
        block_id: "summary",
        text: {
          type: "mrkdwn",
          text: "*Release:* <https://example.com/release|View request>\nAssigned to <@U012AB3CD> in <#C999|deploys>",
        },
        fields: [
          {
            type: "mrkdwn",
            text: "*When:*\n<!date^1392734382^{date_short} at {time}|Feb 18, 2014 at 6:39 AM>",
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "approve",
            style: "primary",
            text: {
              type: "plain_text",
              text: "Approve",
            },
          },
        ],
      },
    ],
  };

  const result = compileUiToUnits(slackPayload, {
    sourceType: "slack",
    enableLoopHeuristic: false,
  });

  assert.equal(result.source_type, "slack");
  assert.match(result.dsl, /Section/);
  assert.match(result.dsl, /Strong/);
  assert.match(result.dsl, /Link \([^)]*href:'https:\/\/example.com\/release'/s);
  assert.match(result.dsl, /Mention \([^)]*userId:'U012AB3CD'/s);
  assert.match(result.dsl, /Channel \([^)]*channelId:'C999'/s);
  assert.match(result.dsl, /Date \(/);
  assert.match(result.dsl, /Button \([^)]*actionId:'approve'/s);

  const reparsed = parseUnits(result.dsl);
  assert.equal(reparsed.type, "document");
});
