import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TRANSFORM_PROGRAM = `
Program (kind:'transform', source:'ir') {
  Rule (id:'drop_empty_text', match=@node.role == 'text') {
    Filter (when=@node.text != '')
    Pass
  }
  Rule (id:'merge_container_text', match=@node.role == 'container') {
    Merge (strategy:'adjacentText', when=@child.role == 'text')
    Pass
  }
}
`;

const SLACK_TRANSFORM_PROGRAM = `
Program (kind:'transform', source:'slack') {
  Rule (id:'drop_empty_text', match=@node.role == 'text') {
    Filter (when=@node.text.trim() != '')
    Pass
  }
  Rule (id:'merge_slack_text', match=@node.role == 'container' || @node.role == 'section') {
    Merge (strategy:'adjacentText', when=@child.role == 'text')
    Pass
  }
}
`;

const REACT_TREE = {
  type: "div",
  props: {
    id: "root",
    children: [
      "Hello",
      " ",
      {
        type: "input",
        props: {
          "aria-label": "Search",
          placeholder: "Search",
          onChange: true,
        },
      },
      {
        type: "button",
        props: {
          "aria-label": "Save",
          children: "Save",
        },
      },
    ],
  },
};

const SLACK_TREE = {
  text: "Release request",
  blocks: [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Release:* <https://example.com/release|View request> for <@U012AB3CD>",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: "approve",
          text: {
            type: "plain_text",
            text: "Approve",
          },
        },
      ],
    },
  ],
};

test("units-transform normalizes react input through IR pipeline", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-tools-transform-"));
  const programPath = path.join(tempDir, "program.ui");
  const inputPath = path.join(tempDir, "input.react.json");
  const outPath = path.join(tempDir, "transform.json");
  const agentPath = path.join(tempDir, "agent.json");

  await fs.writeFile(programPath, TRANSFORM_PROGRAM, "utf-8");
  await fs.writeFile(inputPath, `${JSON.stringify(REACT_TREE, null, 2)}\n`, "utf-8");

  await execFileAsync(process.execPath, [
    path.join(process.cwd(), "packages/units-tools/units-transform.mjs"),
    "--program", programPath,
    "--input", inputPath,
    "--source", "react",
    "--out", outPath,
    "--agent-out", agentPath,
  ], {
    cwd: process.cwd(),
  });

  const payload = JSON.parse(await fs.readFile(outPath, "utf-8"));
  const agentTree = JSON.parse(await fs.readFile(agentPath, "utf-8"));

  assert.equal(payload.source_type, "react");
  assert.equal(payload.normalized_source_type, "ir");
  assert.ok(payload.program.program_id);
  assert.ok(Array.isArray(payload.trace));
  assert.equal(agentTree.role, "container");
});

test("units-verify supports react source for program execution", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-tools-verify-"));
  const programPath = path.join(tempDir, "program.ui");
  const inputPath = path.join(tempDir, "input.react.json");
  const outPath = path.join(tempDir, "verify.json");

  await fs.writeFile(programPath, TRANSFORM_PROGRAM, "utf-8");
  await fs.writeFile(inputPath, `${JSON.stringify(REACT_TREE, null, 2)}\n`, "utf-8");

  await execFileAsync(process.execPath, [
    path.join(process.cwd(), "packages/units-tools/units-verify.mjs"),
    "--program", programPath,
    "--input", inputPath,
    "--source", "react",
    "--out", outPath,
  ], {
    cwd: process.cwd(),
  });

  const payload = JSON.parse(await fs.readFile(outPath, "utf-8"));

  assert.equal(payload.source_type, "react");
  assert.equal(payload.normalized_source_type, "ir");
  assert.ok(payload.score.metrics.action_recall >= 1);
  assert.ok(payload.verification.passed);
});

test("units-transform and units-verify support Slack Block Kit sources", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-tools-slack-"));
  const programPath = path.join(tempDir, "program.ui");
  const inputPath = path.join(tempDir, "input.slack.json");
  const transformPath = path.join(tempDir, "transform.json");
  const verifyPath = path.join(tempDir, "verify.json");

  await fs.writeFile(programPath, SLACK_TRANSFORM_PROGRAM, "utf-8");
  await fs.writeFile(inputPath, `${JSON.stringify(SLACK_TREE, null, 2)}\n`, "utf-8");

  await execFileAsync(process.execPath, [
    path.join(process.cwd(), "packages/units-tools/units-transform.mjs"),
    "--program", programPath,
    "--input", inputPath,
    "--source", "slack",
    "--out", transformPath,
  ], {
    cwd: process.cwd(),
  });

  const transformPayload = JSON.parse(await fs.readFile(transformPath, "utf-8"));
  assert.equal(transformPayload.source_type, "slack");
  assert.equal(transformPayload.normalized_source_type, "slack");
  assert.equal(transformPayload.tree.meta.source, "slack");
  assert.ok(transformPayload.tree.children.some((node) => node.role === "section"));

  await execFileAsync(process.execPath, [
    path.join(process.cwd(), "packages/units-tools/units-verify.mjs"),
    "--program", programPath,
    "--input", inputPath,
    "--source", "mrkdwn",
    "--out", verifyPath,
  ], {
    cwd: process.cwd(),
  });

  const verifyPayload = JSON.parse(await fs.readFile(verifyPath, "utf-8"));
  assert.equal(verifyPayload.source_type, "slack");
  assert.equal(verifyPayload.normalized_source_type, "slack");
  assert.ok(verifyPayload.score.metrics.action_recall >= 1);
  assert.ok(verifyPayload.verification.passed);
});
