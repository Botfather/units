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
