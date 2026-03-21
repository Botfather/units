import assert from "node:assert/strict";
import test from "node:test";
import { parseUnits } from "../packages/units/units-parser.js";
import { findChangedRange, incrementalParse } from "../packages/units/incremental.js";

test("findChangedRange returns insertion boundaries", () => {
  const prev = "App { text 'A' }";
  const next = "App { text 'A' text 'B' }";
  const range = findChangedRange(prev, next);

  assert.deepEqual(range, { start: 15, endPrev: 15, endNext: 24 });
});

test("incrementalParse append fast path matches full parse", () => {
  const prevSource = [
    "App {",
    "  Header {",
    "    text 'Start'",
    "  }",
    "}",
  ].join("\n");
  const nextSource = [
    "App {",
    "  Header {",
    "    text 'Start'",
    "  }",
    "  Footer {",
    "    text 'End'",
    "  }",
    "}",
  ].join("\n");

  const prevAst = parseUnits(prevSource);
  const nextAst = incrementalParse(prevAst, prevSource, nextSource);

  assert.deepEqual(nextAst, parseUnits(nextSource));
});

test("incrementalParse enclosing-node reparse matches full parse", () => {
  const prevSource = [
    "Root {",
    "  Card {",
    "    text 'Old title'",
    "  }",
    "  Sidebar {",
    "    text 'Static'",
    "  }",
    "}",
  ].join("\n");
  const nextSource = prevSource.replace("Old title", "Updated title");

  const prevAst = parseUnits(prevSource);
  const nextAst = incrementalParse(prevAst, prevSource, nextSource);

  assert.deepEqual(nextAst, parseUnits(nextSource));
});

test("incrementalParse preserves no-op identity", () => {
  const source = "App { text 'same' }";
  const prevAst = parseUnits(source);
  const nextAst = incrementalParse(prevAst, source, source);
  assert.equal(nextAst, prevAst);
});
