import assert from "node:assert/strict";
import test from "node:test";

import { parseUnits } from "../packages/units/units-parser.js";
import { compileUiToUnits, compileUiToUnitsDsl } from "../packages/units-compiler/index.js";

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

test("compileUiToUnits omits redundant root container unless explicitly requested", () => {
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

  const optimized = compileUiToUnits(uiTree, {
    sourceType: "ir",
    enableLoopHeuristic: false,
  });
  assert.doesNotMatch(optimized.dsl, /^\s*Container\b/m);
  assert.match(optimized.dsl, /^\s*Button\b/m);

  const explicit = compileUiToUnits(uiTree, {
    sourceType: "ir",
    enableLoopHeuristic: false,
    includeRootContainer: true,
  });
  assert.match(explicit.dsl, /^\s*Container\b/m);

  const reparsed = parseUnits(optimized.dsl);
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
  assert.match(result.dsl, /#for item1 in @\(\[\{name:'Add milk'\},\{name:'Add eggs'\},\{name:'Add bread'\}\]\)/);
  assert.doesNotMatch(result.dsl, /\{ name:/);
  assert.doesNotMatch(result.dsl, /text:'Add milk'/);
  assert.doesNotMatch(result.dsl, /@\{item1\.text\}/);

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
  assert.doesNotMatch(optimized.dsl, /Button \([^)]*actions:'click'/s);
  assert.match(optimized.dsl, /Button \([^)]*actions:'click\|longpress'/s);

  const explicit = compileUiToUnits(uiTree, {
    sourceType: "ir",
    enableLoopHeuristic: false,
    includeImplicitActions: true,
    includeRedundantName: true,
  });
  assert.match(explicit.dsl, /Button \([^)]*name:'Save'[^)]*actions:'click'/s);
});

test("compileUiToUnits compacts redundant leaf name/text values unless explicitly requested", () => {
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
    ],
  };

  const optimized = compileUiToUnits(uiTree, {
    sourceType: "ir",
    enableLoopHeuristic: false,
  });

  assert.match(optimized.dsl, /Button \([^)]*name:'Save'/s);
  assert.doesNotMatch(optimized.dsl, /Button[^{]*\{\s*'Save'/s);

  const explicit = compileUiToUnits(uiTree, {
    sourceType: "ir",
    enableLoopHeuristic: false,
    includeRedundantName: true,
    includeRedundantLeafText: true,
  });

  assert.match(explicit.dsl, /Button \([^)]*name:'Save'/s);
  assert.match(explicit.dsl, /Button[^{]*\{\s*'Save'/s);
});

test("compileUiToUnits supports explicit leaf redundancy toggles", () => {
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
    ],
  };

  const explicit = compileUiToUnits(uiTree, {
    sourceType: "ir",
    enableLoopHeuristic: false,
    includeRedundantName: true,
    includeRedundantLeafText: false,
  });

  assert.match(explicit.dsl, /Button \([^)]*name:'Save'/s);
  assert.doesNotMatch(explicit.dsl, /Button[^{]*\{\s*'Save'/s);

  const textPreferred = compileUiToUnits(uiTree, {
    sourceType: "ir",
    enableLoopHeuristic: false,
    includeRedundantName: false,
    includeRedundantLeafText: true,
  });

  assert.doesNotMatch(textPreferred.dsl, /Button \([^)]*name:'Save'/s);
  assert.match(textPreferred.dsl, /Button[^{]*\{\s*'Save'/s);
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

test("compileUiToUnits emits conditional wrappers, unknown roles, ids, state, props, and hidden nodes", () => {
  const uiTree = {
    id: "root",
    role: "container",
    name: "Root",
    text: "",
    props: {
      blockId: "root-block",
      actionId: "root-action",
      style: "primary",
      timestamp: 1700000000,
      fallback: "Root fallback",
      ignoredFalse: false,
    },
    state: {
      when: "canRender",
      disabled: true,
      selected: false,
      count: 2,
      note: "active",
      hidden: false,
    },
    actions: ["custom", "custom"],
    meta: {},
    children: [
      {
        id: "copy",
        role: "text",
        name: "",
        text: "  keep   spacing's \\ slash  ",
        props: {},
        state: {},
        actions: [],
        meta: { preserveWhitespace: true },
        children: [],
      },
      {
        id: "panel",
        role: "3d-panel",
        name: "Panel",
        text: "Panel copy",
        props: {
          placeholder: "Pick",
          href: "/panel",
          value: 7,
          title: "Panel title",
          alt: "Panel alt",
          ariaLabel: "Panel aria",
          src: "https://example.com/panel.png",
          channelId: "C123",
          userId: "U123",
          groupId: "S123",
          special: "here",
          format: "{date_short}",
        },
        state: {
          expanded: true,
          hidden: false,
        },
        actions: ["open"],
        meta: {},
        children: [],
      },
      {
        id: "hidden",
        role: "button",
        name: "Hidden",
        text: "Hidden",
        props: {},
        state: { hidden: true },
        actions: ["click"],
        meta: {},
        children: [],
      },
    ],
  };

  const dsl = compileUiToUnitsDsl(uiTree, {
    sourceType: "ir",
    includeRootContainer: true,
    includeId: true,
    includeRoleProp: true,
    includeImplicitActions: true,
    enableLoopHeuristic: false,
  });

  assert.match(dsl, /#if @\(canRender\)/);
  assert.match(dsl, /Container \(/);
  for (const fragment of [
    "id:'root'",
    "name:'Root'",
    "actions:'custom'",
    "count:2",
    "disabled:true",
    "note:'active'",
    "blockId:'root-block'",
    "actionId:'root-action'",
    "timestamp:1700000000",
  ]) {
    assert.match(dsl, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(dsl, /'keep   spacing\\'s \\\\ slash'/);
  assert.match(dsl, /Node3dPanel \([^)]*id:'panel'[^)]*name:'Panel'[^)]*actions:'open'[^)]*expanded:true[^)]*placeholder:'Pick'[^)]*href:'\/panel'[^)]*value:7[^)]*role:'3d-panel'/s);
  assert.doesNotMatch(dsl, /Hidden/);
  assert.equal(parseUnits(dsl).type, "document");

  const withHidden = compileUiToUnitsDsl(uiTree, {
    sourceType: "ir",
    includeHidden: true,
    includeRootContainer: true,
    includeImplicitActions: true,
    enableLoopHeuristic: false,
  });
  assert.match(withHidden, /Button \([^)]*name:'Hidden'[^)]*actions:'click'/s);
});
