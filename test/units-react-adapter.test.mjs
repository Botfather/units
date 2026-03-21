import assert from "node:assert/strict";
import test from "node:test";

import {
  isReactElementLike,
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
