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
  loadFixtures,
  runBench,
  markdownReport,
} from "../tools/ui-ps-bench.mjs";

const execFileAsync = promisify(execFile);

test("ui-ps bench parseArgs supports fixture/library overrides", () => {
  const args = parseArgs([
    "--fixtures", "bench/custom-fixtures.json",
    "--library", "bench/custom-library",
    "--out", "tmp/out.json",
    "--report", "tmp/out.md",
    "--gate-action-recall", "1",
  ]);

  assert.equal(args.fixtures, "bench/custom-fixtures.json");
  assert.equal(args.library, "bench/custom-library");
  assert.equal(args.out, "tmp/out.json");
  assert.equal(args.report, "tmp/out.md");
  assert.equal(args.gateActionRecall, 1);
});

test("ui-ps fixtures loader resolves bundled fixture corpus", async () => {
  const fixtures = await loadFixtures("bench/ui-ps-fixtures.json");
  assert.equal(fixtures.name, "ui-ps-fixtures-v2");
  assert.ok(fixtures.cases.length >= 18);
  assert.equal(fixtures.gates.action_recall, 1);
});

test("ui-ps bench run computes selection + reward summary", async () => {
  const result = await runBench({
    fixtures: "bench/ui-ps-fixtures.json",
    library: "bench/ui-ps-library",
  });

  assert.ok(result.summary.case_count >= 18);
  assert.ok(result.summary.semantic_loss_case_count >= 4);
  assert.ok(result.summary.semantic_loss_gate_pass_count >= 4);
  assert.ok(result.summary.avg_action_recall >= 0.9);
  assert.ok(result.library.program_count >= 4);
  assert.ok(result.cases.every((one) => Array.isArray(one.candidates)));

  const report = markdownReport(result);
  assert.match(report, /UI-PS Baseline Report/);
  assert.match(report, /Candidate Leaderboard/);
});

test("ui-ps bench CLI writes JSON payload and markdown report", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ui-ps-bench-cli-"));
  const outPath = path.join(tempDir, "ui-ps-bench.json");
  const reportPath = path.join(tempDir, "ui-ps-bench.md");

  await execFileAsync(process.execPath, [
    path.join(process.cwd(), "tools/ui-ps-bench.mjs"),
    "--fixtures", path.join(process.cwd(), "bench/ui-ps-fixtures.json"),
    "--library", path.join(process.cwd(), "bench/ui-ps-library"),
    "--out", outPath,
    "--report", reportPath,
  ], {
    cwd: process.cwd(),
  });

  const payload = JSON.parse(await fs.readFile(outPath, "utf-8"));
  const report = await fs.readFile(reportPath, "utf-8");

  assert.ok(payload.summary.case_count >= 18);
  assert.ok(Array.isArray(payload.selected_programs));
  assert.match(report, /Selected Program Summary/);
});
