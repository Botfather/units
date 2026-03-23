#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_PROGRAM_FILE = "third_party/autoresearch-macos/program.units-dsl.md";
const DEFAULT_LIVE_RESULT = "bench/results/llm-bench-live.json";
const DEFAULT_EVAL_OUT_DIR = ".bench/autoresearch";

function usage() {
  return `
Usage:
  node tools/dsl-autoresearch-runner.mjs eval
  node tools/dsl-autoresearch-runner.mjs trial --runtime codex
  node tools/dsl-autoresearch-runner.mjs loop --runtime codex [--iterations 3]
  node tools/dsl-autoresearch-runner.mjs trial --agent-cmd "<command>"
  node tools/dsl-autoresearch-runner.mjs loop --agent-cmd "<command>" [--iterations 3]

Commands:
  eval   Run live bench + verify-all and print a score summary.
  trial  Run one agent trial and keep/revert based on gates + score.
  loop   Run multiple trials.

Options:
  --agent-cmd <cmd>         Shell command that performs one candidate edit.
                            Supports templates: {program}, {repo}, {iteration}.
  --iterations <n>          Number of loop iterations (default 3).
  --program-file <path>     Program markdown for agent guidance.
  --live-result <path>      JSON file written by bench:llm:live.
  --eval-dir <path>         Directory for iteration logs.
  --allow-dirty             Allow running with dirty git tree (not recommended).
  --verify-cmd <cmd>        Defaults to "make verify-all".
  --bench-cmd <cmd>         Defaults to "pnpm bench:llm:live".
  --runtime <name>          "command" (default) or "codex".
  --codex-bin <path>        Codex executable path (default "codex").
  --codex-model <model>     Optional Codex model for exec mode.
  --codex-sandbox <mode>    read-only | workspace-write | danger-full-access (default workspace-write).
  --codex-full-auto         Add --full-auto to codex exec.
  --codex-unsafe            Add --dangerously-bypass-approvals-and-sandbox (use only in trusted env).

Environment:
  AUTORESEARCH_AGENT_CMD can be used instead of --agent-cmd.
`;
}

function parseArgs(argv) {
  const out = {
    cmd: null,
    agentCmd: process.env.AUTORESEARCH_AGENT_CMD || "",
    iterations: 3,
    programFile: DEFAULT_PROGRAM_FILE,
    liveResult: DEFAULT_LIVE_RESULT,
    evalDir: DEFAULT_EVAL_OUT_DIR,
    allowDirty: false,
    verifyCmd: "make verify-all",
    benchCmd: "pnpm bench:llm:live",
    runtime: "command",
    codexBin: process.env.CODEX_BIN || "codex",
    codexModel: process.env.CODEX_MODEL || "",
    codexSandbox: process.env.CODEX_SANDBOX || "workspace-write",
    codexFullAuto: false,
    codexUnsafe: false,
  };
  if (argv.length > 0 && !String(argv[0] || "").startsWith("-")) out.cmd = String(argv[0] || "");
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agent-cmd") out.agentCmd = String(argv[++i] || "");
    else if (a === "--iterations") out.iterations = Math.max(1, Number(argv[++i] || out.iterations));
    else if (a === "--program-file") out.programFile = String(argv[++i] || out.programFile);
    else if (a === "--live-result") out.liveResult = String(argv[++i] || out.liveResult);
    else if (a === "--eval-dir") out.evalDir = String(argv[++i] || out.evalDir);
    else if (a === "--allow-dirty") out.allowDirty = true;
    else if (a === "--verify-cmd") out.verifyCmd = String(argv[++i] || out.verifyCmd);
    else if (a === "--bench-cmd") out.benchCmd = String(argv[++i] || out.benchCmd);
    else if (a === "--runtime") out.runtime = String(argv[++i] || out.runtime);
    else if (a === "--codex-bin") out.codexBin = String(argv[++i] || out.codexBin);
    else if (a === "--codex-model") out.codexModel = String(argv[++i] || out.codexModel);
    else if (a === "--codex-sandbox") out.codexSandbox = String(argv[++i] || out.codexSandbox);
    else if (a === "--codex-full-auto") out.codexFullAuto = true;
    else if (a === "--codex-unsafe") out.codexUnsafe = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  if (!out.cmd && argv.length > 0 && (argv[0] === "--help" || argv[0] === "-h")) out.help = true;
  return out;
}

function runShell(command, options = {}) {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-lc", command], {
      stdio: "inherit",
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
    });
    child.on("exit", (code) => resolve(Number(code || 0)));
  });
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

async function gitStatusPorcelain() {
  let out = "";
  await new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-lc", "git status --porcelain"], { cwd: process.cwd() });
    child.stdout.on("data", (d) => { out += String(d || ""); });
    child.on("exit", () => resolve());
  });
  return out.trim();
}

async function gitDiffNameOnly() {
  let out = "";
  await new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-lc", "git status --porcelain"], { cwd: process.cwd() });
    child.stdout.on("data", (d) => { out += String(d || ""); });
    child.on("exit", () => resolve());
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z?]{1,2}\s+/, ""));
}

function shQuote(value) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function buildCodexPrompt({ programText, repoRoot, iteration }) {
  return [
    "You are Codex running an autonomous DSL robustness iteration.",
    `Iteration: ${iteration}`,
    `Repository: ${repoRoot}`,
    "",
    "Follow this program exactly:",
    programText,
    "",
    "Task for this iteration:",
    "1. Inspect current live benchmark failures or fragility in bench/results/llm-bench-live.*",
    "2. Make one minimal, deterministic improvement.",
    "3. Limit edits to: tools/llm-bench.mjs, bench/llm-cases.json, test/*llm* or test/dsl-autoresearch-runner.test.mjs.",
    "4. Do not modify third_party/*.",
    "5. Stop after applying changes; do not run long unrelated tasks.",
  ].join("\n");
}

async function runCodexIteration(iteration, options, programPath, repoRoot) {
  const programText = await fs.readFile(programPath, "utf-8");
  const evalDir = path.resolve(repoRoot, options.evalDir);
  await fs.mkdir(evalDir, { recursive: true });
  const promptFile = path.join(evalDir, `codex-prompt-${iteration}.md`);
  const outputFile = path.join(evalDir, `codex-last-message-${iteration}.txt`);
  const prompt = buildCodexPrompt({ programText, repoRoot, iteration });
  await fs.writeFile(promptFile, prompt, "utf-8");

  const parts = [];
  parts.push(`cat ${shQuote(promptFile)} | ${shQuote(options.codexBin)} exec`);
  parts.push(`--cd ${shQuote(repoRoot)}`);
  if (options.codexModel) parts.push(`--model ${shQuote(options.codexModel)}`);
  if (options.codexSandbox) parts.push(`--sandbox ${shQuote(options.codexSandbox)}`);
  if (options.codexFullAuto) parts.push("--full-auto");
  if (options.codexUnsafe) parts.push("--dangerously-bypass-approvals-and-sandbox");
  parts.push(`--output-last-message ${shQuote(outputFile)}`);
  parts.push("-");
  const cmd = parts.join(" ");
  return runShell(cmd);
}

async function runAgentStep(iteration, options, repoRoot, programPath) {
  if (options.runtime === "codex") {
    return runCodexIteration(iteration, options, programPath, repoRoot);
  }
  const agentCmd = fillTemplate(options.agentCmd, { program: programPath, repo: repoRoot, iteration });
  if (!agentCmd.trim()) throw new Error("Missing --agent-cmd (or AUTORESEARCH_AGENT_CMD).");
  return runShell(agentCmd);
}

export function summarizeLiveResult(payload) {
  const summaries = Array.isArray(payload?.summaries) ? payload.summaries : [];
  const quality = payload?.qualityGate || { violations: [] };
  const parsePcts = summaries.map((s) => Number(s?.parseOkPct)).filter(Number.isFinite);
  const reqPcts = summaries.map((s) => Number(s?.requiredPassPct)).filter(Number.isFinite);
  const minParse = parsePcts.length ? Math.min(...parsePcts) : 0;
  const minRequired = reqPcts.length ? Math.min(...reqPcts) : 0;
  const avgParse = parsePcts.length ? parsePcts.reduce((a, b) => a + b, 0) / parsePcts.length : 0;
  const avgRequired = reqPcts.length ? reqPcts.reduce((a, b) => a + b, 0) / reqPcts.length : 0;
  const violations = Array.isArray(quality?.violations) ? quality.violations : [];
  const gatePass = violations.length === 0;
  return {
    gatePass,
    violations,
    minParse,
    minRequired,
    avgParse,
    avgRequired,
    modelCount: summaries.length,
  };
}

export function scoreSummary(summary) {
  const gateBonus = summary.gatePass ? 100000 : 0;
  const violationPenalty = (summary.violations?.length || 0) * 1000;
  const stability = (summary.minParse * 100) + (summary.minRequired * 100);
  const average = summary.avgParse + summary.avgRequired;
  return gateBonus + stability + average - violationPenalty;
}

async function evaluateOnce(options = {}) {
  const benchCode = await runShell(options.benchCmd || "pnpm bench:llm:live");
  let payload = null;
  try {
    payload = await readJson(path.resolve(process.cwd(), options.liveResult || DEFAULT_LIVE_RESULT));
  } catch {
    payload = {};
  }
  const summary = summarizeLiveResult(payload);
  const verifyCode = benchCode === 0 ? await runShell(options.verifyCmd || "make verify-all") : 1;
  const score = scoreSummary(summary);
  return {
    benchCode,
    verifyCode,
    score,
    summary,
    acceptedByGate: benchCode === 0 && verifyCode === 0 && summary.gatePass,
  };
}

function fillTemplate(template, vars) {
  return String(template || "")
    .replaceAll("{program}", vars.program)
    .replaceAll("{repo}", vars.repo)
    .replaceAll("{iteration}", String(vars.iteration));
}

async function ensureCleanTree(allowDirty) {
  const status = await gitStatusPorcelain();
  if (!status || allowDirty) return;
  throw new Error("Working tree is dirty. Commit/stash first, or pass --allow-dirty.");
}

async function writeIterationLog(evalDir, name, payload) {
  await fs.mkdir(evalDir, { recursive: true });
  const file = path.join(evalDir, `${name}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf-8");
  return file;
}

async function revertTrackedChanges() {
  await runShell("git restore --staged --worktree .");
}

async function runTrial(iteration, options, baselineScore) {
  const repoRoot = process.cwd();
  const program = path.resolve(repoRoot, options.programFile);

  const beforeFiles = await gitDiffNameOnly();
  const agentCode = await runAgentStep(iteration, options, repoRoot, program);
  const afterFiles = await gitDiffNameOnly();
  const touched = afterFiles.filter((f) => !beforeFiles.includes(f));
  if (agentCode !== 0 || touched.length === 0) {
    return {
      iteration,
      agentCode,
      touched,
      kept: false,
      reason: agentCode !== 0 ? "agent_command_failed" : "no_changes",
    };
  }

  const evaluation = await evaluateOnce(options);
  const keep = evaluation.acceptedByGate && evaluation.score >= baselineScore;
  if (!keep) {
    await revertTrackedChanges();
  }
  return {
    iteration,
    agentCode,
    touched,
    kept: keep,
    reason: keep ? "accepted" : "reverted",
    evaluation,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.cmd) {
    process.stdout.write(usage());
    return;
  }

  if (!["eval", "trial", "loop"].includes(args.cmd)) {
    throw new Error(`Unknown command "${args.cmd}".`);
  }
  if (!["command", "codex"].includes(args.runtime)) {
    throw new Error(`Unknown runtime "${args.runtime}". Use "command" or "codex".`);
  }
  if (args.runtime === "command" && !args.agentCmd.trim() && args.cmd !== "eval") {
    throw new Error("Missing --agent-cmd for runtime=command.");
  }

  await ensureCleanTree(args.allowDirty);

  if (args.cmd === "eval") {
    const out = await evaluateOnce(args);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    process.exit(out.acceptedByGate ? 0 : 1);
    return;
  }

  const baseline = await evaluateOnce(args);
  const baseScore = baseline.score;
  await writeIterationLog(args.evalDir, "baseline", baseline);
  process.stdout.write(`Baseline score: ${baseScore.toFixed(2)} (gate=${baseline.acceptedByGate ? "pass" : "fail"})\n`);

  if (args.cmd === "trial") {
    const trial = await runTrial(1, args, baseScore);
    await writeIterationLog(args.evalDir, "trial-1", trial);
    process.stdout.write(`${JSON.stringify(trial, null, 2)}\n`);
    process.exit(trial.kept ? 0 : 1);
    return;
  }

  const loopResults = [];
  let currentBest = baseScore;
  for (let i = 1; i <= args.iterations; i++) {
    process.stdout.write(`\n=== Trial ${i}/${args.iterations} ===\n`);
    const one = await runTrial(i, args, currentBest);
    loopResults.push(one);
    await writeIterationLog(args.evalDir, `trial-${i}`, one);
    if (one.kept && one.evaluation?.score > currentBest) {
      currentBest = one.evaluation.score;
      process.stdout.write(`Accepted trial ${i}; new best score ${currentBest.toFixed(2)}\n`);
    } else if (one.kept) {
      process.stdout.write(`Accepted trial ${i}; score unchanged ${currentBest.toFixed(2)}\n`);
    } else {
      process.stdout.write(`Rejected trial ${i}; reason=${one.reason}\n`);
    }
  }

  const accepted = loopResults.filter((r) => r.kept).length;
  const summary = {
    iterations: args.iterations,
    accepted,
    rejected: args.iterations - accepted,
    baselineScore: baseScore,
    bestScore: currentBest,
  };
  await writeIterationLog(args.evalDir, "loop-summary", summary);
  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
  process.exit(accepted > 0 ? 0 : 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack || err}\n`);
    process.exit(1);
  });
}
