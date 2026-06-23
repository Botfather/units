import assert from "node:assert/strict";
import test from "node:test";

import {
  isReactElementLike,
  normalizeReactNode,
  normalizeReactTree,
  reactElementToUiNode,
} from "../packages/units-react-adapter/index.js";

const REACT_ELEMENT_TYPE = Symbol.for("react.element");
const REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");

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

test("normalizeReactTree converts host elements into Units IR", () => {
  const tree = el(
    "div",
    { id: "root" },
    "Checkout",
    el("button", { id: "pay", onClick: () => {}, "aria-label": "Pay now" }, "Pay now"),
  );

  assert.equal(isReactElementLike(tree), true);

  const normalized = normalizeReactTree(tree);
  assert.equal(normalized.role, "container");
  assert.equal(normalized.id, "root");
  assert.equal(normalized.children.length, 2);

  const [textNode, buttonNode] = normalized.children;
  assert.equal(textNode.role, "text");
  assert.equal(textNode.text, "Checkout");

  assert.equal(buttonNode.role, "button");
  assert.deepEqual(buttonNode.actions, ["click"]);
  assert.equal(buttonNode.name, "Pay now");
  assert.equal(buttonNode.text, "Pay now");
});

test("normalizeReactTree handles fragments and preserves child semantics", () => {
  const fragment = el(
    REACT_FRAGMENT_TYPE,
    {},
    el("a", { href: "/settings" }, "Settings"),
    el("input", { placeholder: "Email", onChange: () => {} }),
  );

  const normalized = normalizeReactTree(fragment);

  assert.equal(normalized.role, "container");
  assert.equal(normalized.meta.kind, "fragment");
  assert.equal(normalized.children.length, 2);
  assert.equal(normalized.children[0].role, "link");
  assert.equal(normalized.children[0].text, "Settings");
  assert.equal(normalized.children[1].role, "input");
  assert.deepEqual(normalized.children[1].actions, ["input"]);
});

test("reactElementToUiNode alias returns the same normalized shape", () => {
  function CheckoutForm(props) {
    return props.children;
  }

  const tree = el(CheckoutForm, { id: "checkout-form" }, el("button", {}, "Place order"));

  const fromAlias = reactElementToUiNode(tree);
  const direct = normalizeReactTree(tree);

  assert.equal(fromAlias.role, "container");
  assert.equal(fromAlias.meta.kind, "component");
  assert.equal(fromAlias.name, "CheckoutForm");
  assert.deepEqual(fromAlias, direct);
});

test("normalizeReactTree handles empty, array, unsupported, and unknown-object inputs", () => {
  const empty = normalizeReactTree(null);
  assert.equal(empty.id, "r0");
  assert.equal(empty.role, "container");
  assert.equal(empty.meta.empty, true);

  const arrayRoot = normalizeReactTree([
    "  Hello   world  ",
    false,
    [42, { type: "text", value: " nested value ", id: "copy" }],
  ]);
  assert.equal(arrayRoot.meta.kind, "root");
  assert.deepEqual(
    arrayRoot.children.map((child) => [child.role, child.id, child.text]),
    [
      ["text", "t0_0", "Hello world"],
      ["text", "t0_2_0", "42"],
      ["text", "copy", "nested value"],
    ],
  );

  const passthrough = normalizeReactTree({
    role: "button",
    name: "Raw button",
    meta: "ignored",
    actions: ["click"],
  });
  assert.equal(passthrough.role, "button");
  assert.equal(passthrough.meta.source, "react");

  const unsupported = normalizeReactTree({ tagName: "button" });
  assert.equal(unsupported.id, "r0");
  assert.equal(unsupported.meta.unsupported, true);
});

test("normalizeReactNode captures React-ish objects, component names, state, props, and actions", () => {
  const Forwarded = {
    render: {
      displayName: "ForwardedThing",
    },
  };
  const fragmentObject = {
    $$typeof: REACT_FRAGMENT_TYPE,
  };

  assert.equal(isReactElementLike(null), false);
  assert.equal(isReactElementLike({ type: "button" }), false);
  assert.equal(isReactElementLike({ type: "button", props: {}, tagName: "button" }), false);
  assert.equal(isReactElementLike({ type: "button", props: {} }), true);

  const component = normalizeReactNode({
    type: Forwarded,
    key: "forwarded-key",
    props: {
      children: [
        el("input", {
          id: "email",
          value: "ada@example.com",
          placeholder: "Email",
          onChange: () => {},
          onInput: () => {},
          required: true,
          readOnly: true,
          "aria-expanded": "false",
          "aria-checked": "true",
          "aria-selected": "false",
          "aria-pressed": "true",
          "aria-required": "true",
          "aria-readonly": "false",
          "data-testid": "email-field",
          style: {
            display: "block",
            visibility: "",
            opacity: 0.75,
            color: "red",
          },
          ref: {},
          ignoredObject: {},
          onFocus: () => {},
        }),
      ],
    },
  }, [3]);

  assert.equal(component.id, "forwarded-key");
  assert.equal(component.name, "ForwardedThing");
  assert.equal(component.meta.kind, "component");
  assert.equal(component.meta.key, "forwarded-key");
  assert.equal(component.children[0].role, "input");
  assert.deepEqual(component.children[0].actions, ["input", "focus"]);
  assert.deepEqual(component.children[0].state, {
    required: true,
    readonly: false,
    expanded: false,
    checked: true,
    selected: false,
    pressed: true,
  });
  assert.deepEqual(component.children[0].props.style, {
    display: "block",
    opacity: "0.75",
  });
  assert.equal(component.children[0].props["data-testid"], "email-field");
  assert.equal(component.children[0].props.ignoredObject, undefined);

  const unnamed = normalizeReactNode({
    type: function AnonymousComponent() {},
    props: {},
  }, [], { includeComponentNames: false });
  assert.equal(unnamed.name, "");
  assert.equal(unnamed.id, "r0");

  const fragment = normalizeReactNode({
    type: fragmentObject,
    props: {
      children: el("button", { onClick: () => {}, onPress: () => {} }, "Same action"),
    },
  }, [4]);
  assert.equal(fragment.meta.type, "Fragment");
  assert.deepEqual(fragment.children[0].actions, ["click"]);

  const toggleRoles = [
    el("button", {}, "Click me"),
    el("a", { href: "/docs" }, "Docs"),
    el("input", {}),
    el("input", { type: "checkbox" }),
    el("input", { type: "radio" }),
    el("button", { role: "switch" }),
  ].map((node, index) => normalizeReactNode(node, [5, index]));

  assert.deepEqual(toggleRoles.map((node) => node.actions), [
    ["click"],
    ["click"],
    ["input"],
    ["input"],
    ["input"],
    ["toggle"],
  ]);
});
