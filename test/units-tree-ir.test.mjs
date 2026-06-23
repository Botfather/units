import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeAgentTree,
} from "../packages/units/tree-ir.js";

test("serializeAgentTree omits implicit actions by default", () => {
  const tree = {
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

  const compact = serializeAgentTree(tree, {
    includeIds: false,
  });

  assert.equal(compact.children[0].name, "Save");
  assert.ok(!("actions" in compact.children[0]));
  assert.deepEqual(compact.children[1].actions, ["click", "longpress"]);
});

test("serializeAgentTree supports explicit compact serializer toggles", () => {
  const tree = {
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

  const explicit = serializeAgentTree(tree, {
    includeIds: false,
    includeRedundantNameText: true,
    includeImplicitActions: true,
  });

  assert.equal(explicit.children[0].name, "Save");
  assert.equal(explicit.children[0].text, "Save");
  assert.deepEqual(explicit.children[0].actions, ["click"]);
});

test("serializeAgentTree drops empty text leaves from compact output", () => {
  const tree = {
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
        id: "empty",
        role: "text",
        name: "",
        text: "",
        props: {},
        state: {},
        actions: [],
        meta: {},
        children: [],
      },
      {
        id: "value",
        role: "text",
        name: "",
        text: "Hello",
        props: {},
        state: {},
        actions: [],
        meta: {},
        children: [],
      },
    ],
  };

  const compact = serializeAgentTree(tree, { includeIds: false });
  assert.equal(compact.children.length, 1);
  assert.equal(compact.children[0].text, "Hello");
});

test("serializeAgentTree omits text node ids by default", () => {
  const tree = {
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
        id: "txt",
        role: "text",
        name: "",
        text: "Hello",
        props: {},
        state: {},
        actions: [],
        meta: {},
        children: [],
      },
      {
        id: "btn",
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

  const compact = serializeAgentTree(tree);
  assert.ok(!("id" in compact.children[0]));
  assert.equal(compact.children[1].id, "btn");

  const explicit = serializeAgentTree(tree, {
    includeTextIds: true,
    includeImplicitActions: true,
    includeRedundantNameText: true,
  });
  assert.equal(explicit.children[0].id, "txt");
});
