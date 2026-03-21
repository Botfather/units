import assert from "node:assert/strict";
import test from "node:test";

import { createUnitsAgentMiddleware } from "../packages/units-agent-middleware/index.js";

const DOM_PASS_PROGRAM = `
Program (kind:'transform', source:'dom') {
  Rule (id:'root_passthrough', match=@node.role == 'container') {
    Pass
  }
}
`;

const A11Y_PASS_PROGRAM = `
Program (kind:'transform', source:'a11y') {
  Rule (id:'group_passthrough', match=@node.role == 'group') {
    Pass
  }
}
`;

test("middleware normalizes manual programs and listPrograms aliases", async () => {
  const single = createUnitsAgentMiddleware({
    programs: DOM_PASS_PROGRAM,
  });
  const fromAccessibilityAlias = await single.listPrograms("accessibility");
  assert.equal(fromAccessibilityAlias.length, 1);
  assert.equal(fromAccessibilityAlias[0].metadata.source_type, "any");
  assert.equal(fromAccessibilityAlias[0].metadata.constraints_passed, true);

  const mixed = createUnitsAgentMiddleware({
    programs: [
      null,
      0,
      { source: 123 },
      {
        source: DOM_PASS_PROGRAM,
        metadata: "invalid-metadata-object",
      },
      DOM_PASS_PROGRAM,
    ],
  });
  const fromAxAlias = await mixed.listPrograms("ax");
  assert.equal(fromAxAlias.length, 2);
  assert.equal(fromAxAlias[0].metadata.source_type, "any");
  assert.equal(fromAxAlias[1].metadata.source_type, "any");
});

test("middleware skips invalid/unusable candidates and returns scored fallback when no gate passes", async () => {
  const middleware = createUnitsAgentMiddleware({
    gates: {
      action_recall: 2,
    },
    programs: [
      "text only and definitely not a transform program",
      {
        source: DOM_PASS_PROGRAM,
        metadata: {
          program_id: "dom-good",
          source_type: "dom",
          constraints_passed: true,
        },
      },
      {
        source: DOM_PASS_PROGRAM,
        metadata: {
          program_id: "dom-blocked",
          source_type: "dom",
          constraints_passed: false,
        },
      },
      {
        source: A11Y_PASS_PROGRAM,
        metadata: {
          program_id: "a11y-only",
          source_type: "a11y",
          constraints_passed: true,
        },
      },
    ],
  });

  const fallback = await middleware.rewrite({
    sourceType: "dom",
    tree: {
      tagName: "div",
      children: [
        { type: "text", text: "alpha" },
        { type: "text", text: "beta" },
      ],
    },
  });

  assert.equal(fallback.transformed, false);
  assert.equal(fallback.reason, "no_verified_program");
  assert.equal(fallback.candidate_scores.length, 1);
  assert.equal(fallback.candidate_scores[0].program.program_id, "dom-good");
  assert.equal(fallback.candidate_scores[0].verification.passed, false);
});

test("middleware rewrite normalizes a11y aliases", async () => {
  const middleware = createUnitsAgentMiddleware({
    programs: [
      {
        source: A11Y_PASS_PROGRAM,
        metadata: {
          program_id: "a11y-pass",
          source_type: "a11y",
          constraints_passed: true,
        },
      },
    ],
  });

  const result = await middleware.rewrite({
    sourceType: "ax",
    tree: {
      role: "group",
      name: "Dialog",
      children: [
        {
          role: "button",
          name: "Save",
        },
      ],
    },
  });

  assert.equal(result.source_type, "a11y");
  assert.equal(result.transformed, true);
  assert.equal(result.selected_program.program_id, "a11y-pass");
});
