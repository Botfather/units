import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  snapshotUiFromRoot,
  captureSnapshotWithPlaywright,
} from "../packages/units-dom-snapshot/index.js";
import {
  createVerifiedProgramMetadata,
  writeVerifiedProgram,
} from "../packages/units/index.js";
import { createUnitsAgentMiddleware } from "../packages/units-agent-middleware/index.js";

function textNode(value) {
  return {
    nodeType: 3,
    textContent: String(value || ""),
  };
}

function elementNode(tag, options = {}, children = []) {
  const attrs = { ...(options.attributes || {}) };
  if (options.role) attrs.role = options.role;
  if (options.id) attrs.id = options.id;

  const node = {
    nodeType: 1,
    tagName: String(tag || "div").toUpperCase(),
    className: options.className || "",
    dataset: { ...(options.dataset || {}) },
    style: { ...(options.style || {}) },
    attributes: attrs,
    childNodes: children,
    textContent: options.textContent || children.map((child) => child.textContent || "").join(" "),
    getAttribute(name) {
      const value = attrs[name];
      return value == null ? null : String(value);
    },
    getBoundingClientRect() {
      return options.rect || { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 };
    },
  };

  if (options.onclick) {
    node.onclick = () => {};
  }

  return node;
}

function computedStyleFor(node) {
  const style = node.style || {};
  return {
    display: style.display || "block",
    visibility: style.visibility || "visible",
    opacity: style.opacity || "1",
  };
}

const TRANSFORM_PROGRAM = `
Program (kind:'transform', source:'dom') {
  Rule (id:'container_rule', match=@node.role == 'container') {
    Merge (strategy:'adjacentText', when=@child.role == 'text')
    Pass
  }
}
`;

test("snapshotUiFromRoot prunes script/style/hidden nodes and captures interactions", () => {
  const tree = elementNode("body", {}, [
    elementNode("script", {}, [textNode("console.log('x')")]),
    elementNode("style", {}, [textNode(".x { color: red; }")]),
    elementNode("div", { style: { display: "none" } }, [
      elementNode("button", { id: "hidden-btn", textContent: "Hidden" }),
    ]),
    textNode("hello"),
    textNode("world"),
    elementNode("button", {
      id: "save",
      className: "btn primary",
      attributes: {
        "aria-label": "Save",
      },
      onclick: true,
      textContent: "Save",
    }),
  ]);

  const snapshot = snapshotUiFromRoot(tree, {
    viewportWidth: 1200,
    viewportHeight: 800,
    getComputedStyle: computedStyleFor,
    getBoundingClientRect: (node) => node.getBoundingClientRect(),
  });

  assert.ok(snapshot);
  assert.equal(snapshot.tag, "body");

  const tags = (snapshot.children || []).map((node) => node.tag);
  assert.ok(!tags.includes("script"));
  assert.ok(!tags.includes("style"));
  assert.ok(!tags.includes("div"), "hidden div should be pruned");

  const button = (snapshot.children || []).find((node) => node.tag === "button");
  assert.ok(button);
  assert.equal(button.interactions.clickable, true);
  assert.equal(button.aria["aria-label"], "Save");
  assert.deepEqual(button.classes, ["btn", "primary"]);

  const textChildren = (snapshot.children || []).filter((node) => node.type === "text");
  assert.equal(textChildren.length, 2);
  assert.equal(textChildren[0].textContent, "hello");
  assert.equal(textChildren[1].textContent, "world");
});

test("snapshotUiFromRoot keeps offscreen modal nodes while pruning offscreen non-modals", () => {
  const tree = elementNode("body", {}, [
    elementNode("div", {
      rect: { top: 1200, left: 100, right: 200, bottom: 1300, width: 100, height: 100 },
      textContent: "offscreen card",
    }),
    elementNode("div", {
      role: "dialog",
      attributes: { "aria-modal": "true" },
      rect: { top: 1200, left: 100, right: 300, bottom: 1400, width: 200, height: 200 },
      textContent: "modal",
    }),
  ]);

  const snapshot = snapshotUiFromRoot(tree, {
    viewportWidth: 1000,
    viewportHeight: 800,
    getComputedStyle: computedStyleFor,
    getBoundingClientRect: (node) => node.getBoundingClientRect(),
  });

  assert.ok(snapshot);
  const children = snapshot.children || [];
  assert.equal(children.length, 1);
  assert.equal(children[0].role, "dialog");
});

test("snapshot output can be rewritten by middleware end-to-end", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-snapshot-"));
  const libraryDir = path.join(tempDir, "library");

  const metadata = createVerifiedProgramMetadata({
    programSource: TRANSFORM_PROGRAM,
    sourceType: "dom",
    constraintsPassed: true,
    scores: {
      total: 1.1,
      R_completeness: 1,
      R_efficiency: 0.1,
      metrics: {},
    },
    programId: "dom-snapshot-best",
  });

  await writeVerifiedProgram({
    directory: libraryDir,
    programSource: TRANSFORM_PROGRAM,
    metadata,
  });

  const root = elementNode("body", {}, [
    textNode("hello"),
    textNode("world"),
    elementNode("button", { textContent: "Save", onclick: true }),
  ]);

  const snapshot = snapshotUiFromRoot(root, {
    viewportWidth: 1200,
    viewportHeight: 800,
    getComputedStyle: computedStyleFor,
    getBoundingClientRect: (node) => node.getBoundingClientRect(),
  });

  const middleware = createUnitsAgentMiddleware({ libraryDir });
  const result = await middleware.rewrite({
    tree: snapshot,
    sourceType: "dom",
  });

  assert.equal(result.transformed, true);
  assert.equal(result.selected_program.program_id, "dom-snapshot-best");
  assert.equal(result.tree.children.length, 2);
  assert.equal(result.tree.children[0].role, "text");
  assert.equal(result.tree.children[0].text, "hello world");
});

test("captureSnapshotWithPlaywright returns actionable error when module is missing", async () => {
  await assert.rejects(
    () => captureSnapshotWithPlaywright({
      url: "https://example.com",
      playwrightModule: "__not_a_real_playwright_module__",
    }),
    /Playwright module/,
  );
});
