import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scoreSummary, summarizeLiveResult } from "../tools/dsl-autoresearch-runner.mjs";

const execFileAsync = promisify(execFile);
const RUNNER_PATH = path.join(process.cwd(), "tools/dsl-autoresearch-runner.mjs");

function makePassingLiveResult() {
  return {
    summaries: [{ model: "gpt-4.1-mini", parseOkPct: 100, requiredPassPct: 100 }],
    qualityGate: { violations: [] },
  };
}

async function createTempGitRepo(liveResultPayload = makePassingLiveResult()) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsl-autoresearch-runner-"));
  const benchDir = path.join(tempDir, "bench", "results");
  await fs.mkdir(benchDir, { recursive: true });
  await fs.writeFile(
    path.join(benchDir, "llm-bench-live.json"),
    `${JSON.stringify(liveResultPayload, null, 2)}\n`,
    "utf-8",
  );
  await fs.writeFile(path.join(tempDir, "program.units-dsl.md"), "Program (kind:'transform') {}\n", "utf-8");
  await fs.writeFile(path.join(tempDir, "tracked.txt"), "baseline\n", "utf-8");

  await execFileAsync("git", ["init"], { cwd: tempDir });
  await execFileAsync("git", ["config", "user.email", "ci@example.com"], { cwd: tempDir });
  await execFileAsync("git", ["config", "user.name", "CI"], { cwd: tempDir });
  await execFileAsync("git", ["add", "."], { cwd: tempDir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });
  return tempDir;
}

async function runRunner(cwd, args) {
  try {
    const out = await execFileAsync(process.execPath, [RUNNER_PATH, ...args], { cwd });
    return {
      code: 0,
      stdout: out.stdout,
      stderr: out.stderr,
    };
  } catch (error) {
    return {
      code: Number(error?.code || 1),
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || ""),
    };
  }
}

test("summarizeLiveResult derives aggregate gate metrics", () => {
  const payload = {
    summaries: [
      { model: "a", parseOkPct: 100, requiredPassPct: 80 },
      { model: "b", parseOkPct: 90, requiredPassPct: 70 },
    ],
    qualityGate: { violations: [{ model: "b", metric: "requiredPassPct" }] },
  };
  const out = summarizeLiveResult(payload);
  assert.equal(out.gatePass, false);
  assert.equal(out.minParse, 90);
  assert.equal(out.minRequired, 70);
  assert.equal(out.modelCount, 2);
  assert.equal(out.violations.length, 1);
});

test("scoreSummary strongly prefers gate-passing outcomes", () => {
  const passing = scoreSummary({
    gatePass: true,
    violations: [],
    minParse: 90,
    minRequired: 90,
    avgParse: 95,
    avgRequired: 95,
  });
  const failing = scoreSummary({
    gatePass: false,
    violations: [{ metric: "requiredPassPct" }],
    minParse: 100,
    minRequired: 100,
    avgParse: 100,
    avgRequired: 100,
  });
  assert.ok(passing > failing);
});

test("runner CLI prints usage with --help", async () => {
  const out = await runRunner(process.cwd(), ["--help"]);
  assert.equal(out.code, 0);
  assert.match(out.stdout, /Usage:/);
  assert.match(out.stdout, /Commands:/);
});

test("runner eval succeeds when bench, verify, and quality gates pass", async () => {
  const repoDir = await createTempGitRepo();
  const out = await runRunner(repoDir, [
    "eval",
    "--program-file", "program.units-dsl.md",
    "--live-result", "bench/results/llm-bench-live.json",
    "--bench-cmd", "true",
    "--verify-cmd", "true",
  ]);

  assert.equal(out.code, 0);
  assert.match(out.stdout, /"acceptedByGate": true/);
  assert.match(out.stdout, /"score"/);
});

test("runner eval exits non-zero when bench command fails", async () => {
  const repoDir = await createTempGitRepo();
  const out = await runRunner(repoDir, [
    "eval",
    "--program-file", "program.units-dsl.md",
    "--live-result", "bench/results/llm-bench-live.json",
    "--bench-cmd", "false",
    "--verify-cmd", "true",
  ]);

  assert.equal(out.code, 1);
  assert.match(out.stdout, /"acceptedByGate": false/);
  assert.match(out.stdout, /"benchCode": 1/);
});

test("runner trial reports no_changes when agent command makes no edits", async () => {
  const repoDir = await createTempGitRepo();
  const out = await runRunner(repoDir, [
    "trial",
    "--program-file", "program.units-dsl.md",
    "--live-result", "bench/results/llm-bench-live.json",
    "--bench-cmd", "true",
    "--verify-cmd", "true",
    "--agent-cmd", "true",
  ]);

  assert.equal(out.code, 1);
  assert.match(out.stdout, /"reason": "no_changes"/);
});

test("runner trial reverts tracked edits when evaluation gates fail", async () => {
  const repoDir = await createTempGitRepo({
    summaries: [{ parseOkPct: 80, requiredPassPct: 70 }],
    qualityGate: { violations: [{ metric: "requiredPassPct" }] },
  });
  const trackedPath = path.join(repoDir, "tracked.txt");
  const out = await runRunner(repoDir, [
    "trial",
    "--program-file", "program.units-dsl.md",
    "--live-result", "bench/results/llm-bench-live.json",
    "--bench-cmd", "true",
    "--verify-cmd", "false",
    "--agent-cmd", "printf 'mutated\\n' > tracked.txt",
  ]);
  const tracked = await fs.readFile(trackedPath, "utf-8");

  assert.equal(out.code, 1);
  assert.match(out.stdout, /"reason": "reverted"/);
  assert.equal(tracked, "baseline\n");
});

test("runner trial supports codex runtime command construction", async () => {
  const repoDir = await createTempGitRepo();
  const fakeCodex = path.join(repoDir, "fake-codex.sh");
  await fs.writeFile(
    fakeCodex,
    "#!/bin/sh\nprintf 'mutated\\n' > tracked.txt\nexit 0\n",
    { mode: 0o755 },
  );

  const out = await runRunner(repoDir, [
    "trial",
    "--runtime", "codex",
    "--allow-dirty",
    "--program-file", "program.units-dsl.md",
    "--live-result", "bench/results/llm-bench-live.json",
    "--bench-cmd", "true",
    "--verify-cmd", "true",
    "--codex-bin", fakeCodex,
    "--codex-model", "gpt-test",
    "--codex-sandbox", "workspace-write",
    "--codex-full-auto",
  ]);

  assert.equal(out.code, 0);
  assert.match(out.stdout, /"kept": true/);
});

test("runner loop records summary with accepted and rejected iterations", async () => {
  const repoDir = await createTempGitRepo();
  const out = await runRunner(repoDir, [
    "loop",
    "--iterations", "2",
    "--program-file", "program.units-dsl.md",
    "--live-result", "bench/results/llm-bench-live.json",
    "--bench-cmd", "true",
    "--verify-cmd", "true",
    "--agent-cmd", "printf 'loop\\n' >> tracked.txt",
    "--eval-dir", ".bench/autoresearch",
  ]);
  const summaryPath = path.join(repoDir, ".bench", "autoresearch", "loop-summary.json");
  const summary = JSON.parse(await fs.readFile(summaryPath, "utf-8"));

  assert.equal(out.code, 0);
  assert.equal(summary.iterations, 2);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.rejected, 1);
});
