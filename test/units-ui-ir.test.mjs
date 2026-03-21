import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeDomUiTree,
  normalizeA11yUiTree,
  normalizeUiNode,
  normalizeUiTree,
  serializeCompactUiTree,
  normalizeDomTree,
  serializeAgentTree,
} from "../packages/units-ui-ir/index.js";

test("normalizeDomUiTree infers roles/actions from DOM-like input", () => {
  const dom = {
    tagName: "div",
    id: "root",
    children: [
      {
        type: "text",
        text: "Checkout",
      },
      {
        tagName: "button",
        textContent: "Pay now",
        attributes: {
          id: "pay-btn",
          "aria-label": "Pay now",
        },
      },
    ],
  };

  const tree = normalizeDomUiTree(dom);

  assert.equal(tree.role, "container");
  assert.equal(tree.id, "root");
  assert.equal(tree.children.length, 2);
  assert.equal(tree.children[0].role, "text");
  assert.equal(tree.children[1].role, "button");
  assert.deepEqual(tree.children[1].actions, ["click"]);
  assert.equal(tree.children[1].name, "Pay now");
});

test("normalizeA11yUiTree and normalizeUiTree keep accessibility semantics", () => {
  const ax = {
    id: "ax-root",
    role: "button",
    name: "Continue",
    state: { disabled: true },
    actions: [{ name: "press" }],
    children: [],
  };

  const fromA11y = normalizeA11yUiTree(ax);
  const fromGeneric = normalizeUiTree(ax, "a11y");

  assert.equal(fromA11y.role, "button");
  assert.equal(fromA11y.name, "Continue");
  assert.deepEqual(fromA11y.actions, ["press"]);
  assert.equal(fromA11y.state.disabled, true);

  assert.equal(fromGeneric.role, fromA11y.role);
  assert.deepEqual(fromGeneric.actions, fromA11y.actions);
});

test("normalizeUiNode + compact serializer produce deterministic agent payloads", () => {
  const ir = normalizeUiNode({
    id: "n1",
    role: "input",
    name: "Email",
    text: "",
    actions: ["input"],
    props: {
      placeholder: "you@example.com",
    },
    state: {
      required: true,
    },
    meta: {
      source: "custom",
    },
    children: [],
  });

  const compact = serializeCompactUiTree(ir, {
    includeIds: false,
    includeProps: true,
    includeMeta: false,
  });

  const aliasCompact = serializeAgentTree(ir, {
    includeIds: false,
    includeProps: true,
    includeMeta: false,
  });

  assert.equal(ir.role, "input");
  assert.ok(!("id" in compact));
  assert.equal(compact.role, "input");
  assert.equal(compact.props.placeholder, "you@example.com");
  assert.deepEqual(aliasCompact, compact);

  const aliasDom = normalizeDomTree({ tagName: "a", attributes: { href: "/home" } });
  assert.equal(aliasDom.role, "link");
});
