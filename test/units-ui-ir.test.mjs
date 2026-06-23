import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeDomUiTree,
  normalizeA11yUiTree,
  normalizeUiNode,
  normalizeUiTree,
  normalizeSlackBlockKitTree,
  parseSlackMrkdwn,
  serializeCompactUiTree,
  normalizeDomTree,
  normalizeSlackTree,
  serializeAgentTree,
} from "../packages/units-ui-ir/index.js";

function flattenNodes(nodeOrNodes) {
  const out = [];
  const stack = Array.isArray(nodeOrNodes) ? [...nodeOrNodes] : [nodeOrNodes];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node || typeof node !== "object") continue;
    out.push(node);
    stack.unshift(...(node.children || []));
  }
  return out;
}

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

test("serializeCompactUiTree deduplicates redundant name/text by default", () => {
  const ir = normalizeUiNode({
    id: "n1",
    role: "button",
    name: "Save",
    text: "Save",
    actions: ["click"],
    children: [],
  });

  const compact = serializeCompactUiTree(ir, {
    includeIds: false,
  });
  assert.equal(compact.name, "Save");
  assert.ok(!("text" in compact));

  const explicit = serializeCompactUiTree(ir, {
    includeIds: false,
    includeRedundantNameText: true,
  });
  assert.equal(explicit.name, "Save");
  assert.equal(explicit.text, "Save");
});

test("parseSlackMrkdwn recognizes Block Kit markdown entities", () => {
  const nodes = parseSlackMrkdwn(
    "Hello *bold* _em_ ~old~ `x * y` <https://example.com|site> <@U012AB3CD> <#C123ABC456|ops> <!date^1392734382^{date_short}|Feb 18, 2014> &lt;safe&gt;",
  );
  const flat = flattenNodes(nodes);

  assert.ok(flat.some((node) => node.role === "strong" && node.text === "bold"));
  assert.ok(flat.some((node) => node.role === "emphasis" && node.text === "em"));
  assert.ok(flat.some((node) => node.role === "strike" && node.text === "old"));
  assert.ok(flat.some((node) => node.role === "code" && node.text === "x * y"));

  const link = flat.find((node) => node.role === "link");
  assert.equal(link.props.href, "https://example.com");
  assert.equal(link.text, "site");

  const mention = flat.find((node) => node.role === "mention");
  assert.equal(mention.props.userId, "U012AB3CD");

  const channel = flat.find((node) => node.role === "channel");
  assert.equal(channel.props.channelId, "C123ABC456");
  assert.equal(channel.text, "#ops");

  const date = flat.find((node) => node.role === "date");
  assert.equal(date.props.timestamp, "1392734382");
  assert.equal(date.props.format, "{date_short}");
  assert.equal(date.props.fallback, "Feb 18, 2014");

  assert.ok(flat.some((node) => node.role === "text" && node.text.includes("<safe>")));
});

test("normalizeSlackBlockKitTree preserves mrkdwn structure in Block Kit payloads", () => {
  const payload = {
    channel: "C123ABC456",
    text: "Release request",
    blocks: [
      {
        type: "section",
        block_id: "summary",
        text: {
          type: "mrkdwn",
          text: "*Release:* <https://example.com/release|View request>\nAssigned to <@U012AB3CD>",
        },
        fields: [
          {
            type: "mrkdwn",
            text: "*Status:*\nReady",
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
      {
        type: "markdown",
        text: "See <https://example.com/docs|docs>",
      },
    ],
  };

  const tree = normalizeSlackBlockKitTree(payload);
  const aliasTree = normalizeSlackTree(payload);
  const genericTree = normalizeUiTree(payload, "slack");
  const flat = flattenNodes(tree);

  assert.equal(tree.meta.source, "slack");
  assert.equal(aliasTree.meta.source, "slack");
  assert.equal(genericTree.meta.source, "slack");
  assert.ok(flat.some((node) => node.role === "section" && node.props.blockId === "summary"));
  assert.ok(flat.some((node) => node.role === "strong" && node.text === "Release:"));
  assert.ok(flat.some((node) => node.role === "link" && node.props.href === "https://example.com/release"));
  assert.ok(flat.some((node) => node.role === "mention" && node.props.userId === "U012AB3CD"));
  assert.ok(flat.some((node) => node.role === "field"));
  assert.ok(flat.some((node) => node.role === "button" && node.props.actionId === "approve"));
  assert.ok(flat.some((node) => node.role === "link" && node.text === "docs"));
});
