import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import {
  parseArgs,
  evaluateGates,
  runGateCheck,
} from "../tools/ui-ps-gate-check.mjs";

const execFileAsync = promisify(execFile);

test("ui-ps gate parseArgs supports custom paths", () => {
  const args = parseArgs([
    "--result", "tmp/result.json",
    "--gates", "tmp/gates.json",
  ]);

  assert.equal(args.result, "tmp/result.json");
  assert.equal(args.gates, "tmp/gates.json");
});

test("evaluateGates passes when payload satisfies thresholds", () => {
  const payload = {
    summary: {
      case_count: 4,
      transformed_count: 2,
      gate_pass_count: 2,
      avg_action_recall: 1,
      avg_token_reduction: 0.15,
      avg_total_score: 1.02,
      avg_delta_from_baseline: 0.1,
    },
    library: {
      program_ids: ["p1", "p2", "p3"],
    },
  };

  const gates = {
    min_case_count: 4,
    min_transformed_count: 2,
    min_gate_pass_count: 2,
    min_avg_action_recall: 1,
    min_avg_token_reduction: 0.1,
    min_avg_total_score: 0.95,
    min_avg_delta_from_baseline: 0,
    required_program_ids: ["p2"],
  };

  const result = evaluateGates(payload, gates);
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
});

test("evaluateGates fails with readable failure messages", () => {
  const payload = {
    summary: {
      case_count: 3,
      transformed_count: 1,
      gate_pass_count: 1,
      avg_action_recall: 0.8,
      avg_token_reduction: 0.02,
      avg_total_score: 0.6,
      avg_delta_from_baseline: -0.2,
    },
    library: {
      program_ids: ["p1"],
    },
  };

  const gates = {
    min_case_count: 4,
    min_transformed_count: 2,
    min_gate_pass_count: 2,
    min_avg_action_recall: 1,
    min_avg_token_reduction: 0.1,
    min_avg_total_score: 0.95,
    min_avg_delta_from_baseline: 0,
    required_program_ids: ["p2"],
  };

  const result = evaluateGates(payload, gates);
  assert.equal(result.passed, false);
  assert.ok(result.failures.length >= 2);
  assert.ok(result.failures.some((line) => line.includes("Case count failed")));
  assert.ok(result.failures.some((line) => line.includes("Required program missing")));
});

test("runGateCheck reads real bench output and gates", async () => {
  const output = await runGateCheck({
    result: "bench/results/ui-ps-bench.json",
    gates: "bench/ui-ps-gates.json",
  });

  assert.ok(output.resultPath.endsWith("bench/results/ui-ps-bench.json"));
  assert.ok(output.gatesPath.endsWith("bench/ui-ps-gates.json"));
  assert.equal(typeof output.evaluation.passed, "boolean");
});

test("ui-ps gate CLI exits non-zero when thresholds are violated", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ui-ps-gate-fail-"));
  const resultPath = path.join(tempDir, "result.json");
  const gatesPath = path.join(tempDir, "gates.json");

  await fs.writeFile(resultPath, `${JSON.stringify({
    summary: {
      case_count: 1,
      transformed_count: 0,
      gate_pass_count: 0,
      avg_action_recall: 0,
      avg_token_reduction: 0,
      avg_total_score: 0,
      avg_delta_from_baseline: -1,
    },
    library: {
      program_ids: [],
    },
  }, null, 2)}\n`, "utf-8");

  await fs.writeFile(gatesPath, `${JSON.stringify({
    min_case_count: 2,
    required_program_ids: ["required-program"],
  }, null, 2)}\n`, "utf-8");

  let failed = false;

  try {
    await execFileAsync(process.execPath, [
      path.join(process.cwd(), "tools/ui-ps-gate-check.mjs"),
      "--result", resultPath,
      "--gates", gatesPath,
    ], {
      cwd: process.cwd(),
    });
  } catch (err) {
    failed = true;
    assert.equal(err.code, 1);
    assert.match(String(err.stderr || ""), /UI-PS gate check failed/);
  }

  assert.equal(failed, true);
});
