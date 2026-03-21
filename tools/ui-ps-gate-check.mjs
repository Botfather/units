#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_RESULT = "bench/results/ui-ps-bench.json";
const DEFAULT_GATES = "bench/ui-ps-gates.json";

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtNumber(value, digits = 4) {
  const n = toFinite(value);
  if (n == null) return "n/a";
  return String(Number(n.toFixed(digits)));
}

async function readJson(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(abs, "utf-8");
  return JSON.parse(raw);
}

export function parseArgs(argv) {
  const out = {
    result: DEFAULT_RESULT,
    gates: DEFAULT_GATES,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (arg === "--result") out.result = String(argv[++i] || out.result);
    else if (arg === "--gates") out.gates = String(argv[++i] || out.gates);
    else if (arg === "--help" || arg === "-h") out.help = true;
  }

  return out;
}

function usage() {
  return `
Usage:
  node tools/ui-ps-gate-check.mjs [--result bench/results/ui-ps-bench.json]
                                  [--gates bench/ui-ps-gates.json]

Fails (exit 1) if any configured threshold is not met.
`;
}

function buildChecks(payload, gates) {
  const summary = payload?.summary && typeof payload.summary === "object"
    ? payload.summary
    : {};

  const checks = [
    {
      key: "min_case_count",
      label: "Case count",
      actual: toFinite(summary.case_count),
      min: toFinite(gates.min_case_count),
    },
    {
      key: "min_transformed_count",
      label: "Transformed count",
      actual: toFinite(summary.transformed_count),
      min: toFinite(gates.min_transformed_count),
    },
    {
      key: "min_semantic_loss_case_count",
      label: "Semantic-loss case count",
      actual: toFinite(summary.semantic_loss_case_count),
      min: toFinite(gates.min_semantic_loss_case_count),
    },
    {
      key: "min_gate_pass_count",
      label: "Gate pass count",
      actual: toFinite(summary.gate_pass_count),
      min: toFinite(gates.min_gate_pass_count),
    },
    {
      key: "min_semantic_loss_gate_pass_count",
      label: "Semantic-loss gate pass count",
      actual: toFinite(summary.semantic_loss_gate_pass_count),
      min: toFinite(gates.min_semantic_loss_gate_pass_count),
    },
    {
      key: "min_avg_action_recall",
      label: "Average action recall",
      actual: toFinite(summary.avg_action_recall),
      min: toFinite(gates.min_avg_action_recall),
    },
    {
      key: "min_avg_token_reduction",
      label: "Average token reduction",
      actual: toFinite(summary.avg_token_reduction),
      min: toFinite(gates.min_avg_token_reduction),
    },
    {
      key: "min_avg_total_score",
      label: "Average total score",
      actual: toFinite(summary.avg_total_score),
      min: toFinite(gates.min_avg_total_score),
    },
    {
      key: "min_avg_delta_from_baseline",
      label: "Average delta from baseline",
      actual: toFinite(summary.avg_delta_from_baseline),
      min: toFinite(gates.min_avg_delta_from_baseline),
    },
  ].filter((item) => item.min != null);

  return checks.map((one) => ({
    ...one,
    passed: one.actual != null && one.actual >= one.min,
  }));
}

function buildProgramChecks(payload, gates) {
  const required = Array.isArray(gates.required_program_ids)
    ? gates.required_program_ids.map((item) => String(item)).filter(Boolean)
    : [];

  if (required.length === 0) return [];

  const seen = new Set(
    Array.isArray(payload?.library?.program_ids)
      ? payload.library.program_ids.map((item) => String(item)).filter(Boolean)
      : [],
  );

  return required.map((programId) => ({
    program_id: programId,
    passed: seen.has(programId),
  }));
}

export function evaluateGates(payload, gates) {
  const thresholdChecks = buildChecks(payload, gates);
  const programChecks = buildProgramChecks(payload, gates);

  const failures = [];

  for (const check of thresholdChecks) {
    if (check.passed) continue;
    failures.push(
      `${check.label} failed: expected >= ${fmtNumber(check.min)}, got ${fmtNumber(check.actual)}`,
    );
  }

  for (const check of programChecks) {
    if (check.passed) continue;
    failures.push(`Required program missing from library: ${check.program_id}`);
  }

  return {
    passed: failures.length === 0,
    failures,
    checks: {
      thresholds: thresholdChecks,
      programs: programChecks,
    },
  };
}

export async function runGateCheck(options = {}) {
  const payload = await readJson(options.result || DEFAULT_RESULT);
  const gates = await readJson(options.gates || DEFAULT_GATES);

  const evaluation = evaluateGates(payload, gates);

  return {
    resultPath: path.resolve(process.cwd(), options.result || DEFAULT_RESULT),
    gatesPath: path.resolve(process.cwd(), options.gates || DEFAULT_GATES),
    payload,
    gates,
    evaluation,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const result = await runGateCheck(args);

  process.stdout.write(`UI-PS gate check\n`);
  process.stdout.write(`- Result: ${result.resultPath}\n`);
  process.stdout.write(`- Gates: ${result.gatesPath}\n`);

  const thresholds = result.evaluation.checks.thresholds;
  if (thresholds.length > 0) {
    process.stdout.write(`- Threshold checks:\n`);
    for (const one of thresholds) {
      process.stdout.write(`  - ${one.label}: ${one.passed ? "pass" : "fail"} (actual=${fmtNumber(one.actual)}, min=${fmtNumber(one.min)})\n`);
    }
  }

  const programs = result.evaluation.checks.programs;
  if (programs.length > 0) {
    process.stdout.write(`- Required programs:\n`);
    for (const one of programs) {
      process.stdout.write(`  - ${one.program_id}: ${one.passed ? "present" : "missing"}\n`);
    }
  }

  if (!result.evaluation.passed) {
    process.stderr.write(`\nUI-PS gate check failed:\n`);
    for (const failure of result.evaluation.failures) {
      process.stderr.write(`- ${failure}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(`UI-PS gate check passed\n`);
}

const isMain = import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
