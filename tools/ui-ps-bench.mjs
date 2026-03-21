#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  createUnitsAgentMiddleware,
} from "../packages/units-agent-middleware/index.js";
import {
  loadVerifiedLibrary,
} from "../packages/units/transform-library.js";
import {
  scoreProgram,
  verifyProgram,
} from "../packages/units/reward.js";

const DEFAULT_FIXTURES = "bench/ui-ps-fixtures.json";
const DEFAULT_LIBRARY = "bench/ui-ps-library";
const DEFAULT_OUT = "bench/results/ui-ps-bench.json";
const DEFAULT_REPORT = "bench/results/ui-ps-bench.md";

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (nums.length === 0) return null;
  const total = nums.reduce((sum, value) => sum + value, 0);
  return total / nums.length;
}

function compactNumber(value, digits = 4) {
  const n = round(value, digits);
  if (n == null) return "-";
  return String(n);
}

async function writeFileSafe(filePath, content) {
  const abs = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  return abs;
}

export function parseArgs(argv) {
  const out = {
    fixtures: DEFAULT_FIXTURES,
    library: DEFAULT_LIBRARY,
    out: DEFAULT_OUT,
    report: DEFAULT_REPORT,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (arg === "--fixtures") out.fixtures = String(argv[++i] || out.fixtures);
    else if (arg === "--library" || arg === "--library-dir") out.library = String(argv[++i] || out.library);
    else if (arg === "--out") out.out = String(argv[++i] || out.out);
    else if (arg === "--report") out.report = String(argv[++i] || out.report);
    else if (arg === "--gate-action-recall") out.gateActionRecall = toFinite(argv[++i]);
    else if (arg === "--gate-name-recall") out.gateNameRecall = toFinite(argv[++i]);
    else if (arg === "--gate-text-f1") out.gateTextF1 = toFinite(argv[++i]);
    else if (arg === "--help" || arg === "-h") out.help = true;
  }

  return out;
}

function usage() {
  return `
Usage:
  node tools/ui-ps-bench.mjs [--fixtures bench/ui-ps-fixtures.json]
                             [--library bench/ui-ps-library]
                             [--out bench/results/ui-ps-bench.json]
                             [--report bench/results/ui-ps-bench.md]
                             [--gate-action-recall 1.0]
                             [--gate-name-recall 0.98]
                             [--gate-text-f1 0.95]

Evaluates verified transform programs over host-tree fixtures and reports:
  - completeness (action/name/text/state)
  - efficiency (node/token/depth reduction)
  - selected-program candidate scoring per fixture
`;
}

async function maybeReadCaseTree(fixturesAbsPath, oneCase) {
  if (oneCase && typeof oneCase === "object" && oneCase.tree && typeof oneCase.tree === "object") {
    return oneCase.tree;
  }

  const treeFile = oneCase?.treeFile || oneCase?.tree_file || null;
  if (!treeFile) {
    throw new Error(`Fixture case \"${oneCase?.id || "unknown"}\" is missing tree or treeFile.`);
  }

  const absTreePath = path.resolve(path.dirname(fixturesAbsPath), String(treeFile));
  const raw = await fs.readFile(absTreePath, "utf-8");
  return JSON.parse(raw);
}

export async function loadFixtures(fixturesPath) {
  const abs = path.resolve(process.cwd(), fixturesPath || DEFAULT_FIXTURES);
  const raw = JSON.parse(await fs.readFile(abs, "utf-8"));

  const cases = [];
  for (const item of Array.isArray(raw.cases) ? raw.cases : []) {
    const tree = await maybeReadCaseTree(abs, item);
    cases.push({
      id: String(item?.id || `case_${cases.length + 1}`),
      title: item?.title ? String(item.title) : null,
      sourceType: String(item?.sourceType || item?.source_type || "dom").toLowerCase(),
      tree,
      expectations: item?.expectations && typeof item.expectations === "object" ? item.expectations : {},
      taskContext: item?.taskContext && typeof item.taskContext === "object" ? item.taskContext : {},
    });
  }

  return {
    path: abs,
    name: String(raw.name || "ui-ps-fixtures"),
    description: raw.description ? String(raw.description) : null,
    gates: raw.gates && typeof raw.gates === "object" ? raw.gates : {},
    cases,
  };
}

function asCompactCandidate(candidate) {
  return {
    program_id: candidate?.program?.program_id || null,
    source_type: candidate?.program?.source_type || null,
    total: round(candidate?.score?.total),
    action_recall: round(candidate?.score?.metrics?.action_recall),
    token_reduction: round(candidate?.score?.metrics?.token_reduction),
    passed: candidate?.verification?.passed === true,
  };
}

function summarizeSelectedPrograms(caseRows) {
  const byProgram = new Map();

  for (const one of caseRows) {
    const id = one.selected_program_id;
    if (!id) continue;

    const previous = byProgram.get(id) || {
      selected_count: 0,
      total_scores: [],
      action_recalls: [],
      token_reductions: [],
      source_types: new Set(),
    };

    previous.selected_count += 1;
    previous.total_scores.push(one.score.total);
    previous.action_recalls.push(one.score.metrics.action_recall);
    previous.token_reductions.push(one.score.metrics.token_reduction);
    previous.source_types.add(one.source_type);

    byProgram.set(id, previous);
  }

  return [...byProgram.entries()]
    .map(([programId, stats]) => ({
      program_id: programId,
      selected_count: stats.selected_count,
      source_types: [...stats.source_types].sort(),
      avg_total_score: round(average(stats.total_scores)),
      avg_action_recall: round(average(stats.action_recalls)),
      avg_token_reduction: round(average(stats.token_reductions)),
    }))
    .sort((left, right) => right.selected_count - left.selected_count);
}

export function markdownReport(payload) {
  const lines = [];
  lines.push("# UI-PS Baseline Report");
  lines.push("");
  lines.push(`Generated: ${payload.generatedAt}`);
  lines.push(`Fixtures: \`${payload.config.fixtures}\``);
  lines.push(`Library: \`${payload.config.library}\``);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Cases: \`${payload.summary.case_count}\``);
  lines.push(`- Transformed: \`${payload.summary.transformed_count}\``);
  lines.push(`- Gate pass: \`${payload.summary.gate_pass_count}\``);
  lines.push(`- Avg action recall: \`${compactNumber(payload.summary.avg_action_recall)}\``);
  lines.push(`- Avg token reduction: \`${compactNumber(payload.summary.avg_token_reduction)}\``);
  lines.push(`- Avg total score: \`${compactNumber(payload.summary.avg_total_score)}\``);
  lines.push(`- Avg score delta vs identity baseline: \`${compactNumber(payload.summary.avg_delta_from_baseline)}\``);
  lines.push("");

  lines.push("## Per-case");
  lines.push("");
  lines.push("| Case | Source | Selected Program | Transformed | Action Recall | Token Reduction | Total | Delta vs Baseline | Gate Pass |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|");
  for (const one of payload.cases) {
    lines.push(`| ${one.id} | ${one.source_type} | ${one.selected_program_id || "-"} | ${one.transformed ? "yes" : "no"} | ${compactNumber(one.score.metrics.action_recall)} | ${compactNumber(one.score.metrics.token_reduction)} | ${compactNumber(one.score.total)} | ${compactNumber(one.delta_from_baseline)} | ${one.verification.passed ? "yes" : "no"} |`);
  }
  lines.push("");

  lines.push("## Selected Program Summary");
  lines.push("");
  if (!payload.selected_programs.length) {
    lines.push("No program was selected for these fixtures (all fell back to pass-through).");
    lines.push("");
  } else {
    lines.push("| Program | Count | Sources | Avg Total | Avg Action Recall | Avg Token Reduction |");
    lines.push("|---|---:|---|---:|---:|---:|");
    for (const one of payload.selected_programs) {
      lines.push(`| ${one.program_id} | ${one.selected_count} | ${one.source_types.join(", ")} | ${compactNumber(one.avg_total_score)} | ${compactNumber(one.avg_action_recall)} | ${compactNumber(one.avg_token_reduction)} |`);
    }
    lines.push("");
  }

  lines.push("## Candidate Leaderboard (Top 3 / case)");
  lines.push("");
  for (const one of payload.cases) {
    lines.push(`### ${one.id}`);
    if (!one.candidates.length) {
      lines.push("No candidate programs available for this source type.");
      lines.push("");
      continue;
    }
    const top = one.candidates.slice(0, 3);
    lines.push("| Program | Passed | Total | Action Recall | Token Reduction |");
    lines.push("|---|---:|---:|---:|---:|");
    for (const candidate of top) {
      lines.push(`| ${candidate.program_id || "-"} | ${candidate.passed ? "yes" : "no"} | ${compactNumber(candidate.total)} | ${compactNumber(candidate.action_recall)} | ${compactNumber(candidate.token_reduction)} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export async function runBench(options = {}) {
  const fixtures = await loadFixtures(options.fixtures || DEFAULT_FIXTURES);
  const libraryDir = path.resolve(process.cwd(), options.library || DEFAULT_LIBRARY);

  const gates = {
    ...fixtures.gates,
    ...(Number.isFinite(options.gateActionRecall) ? { action_recall: options.gateActionRecall } : {}),
    ...(Number.isFinite(options.gateNameRecall) ? { name_recall: options.gateNameRecall } : {}),
    ...(Number.isFinite(options.gateTextF1) ? { text_f1: options.gateTextF1 } : {}),
  };

  const middleware = createUnitsAgentMiddleware({
    libraryDir,
    gates,
  });

  const libraryEntries = await loadVerifiedLibrary(libraryDir, {
    includeInactive: false,
    sourceType: "any",
  });

  const cases = [];

  for (const oneCase of fixtures.cases) {
    const rewrite = await middleware.rewrite({
      tree: oneCase.tree,
      sourceType: oneCase.sourceType,
      taskContext: oneCase.taskContext,
      expectations: oneCase.expectations,
    });

    const inputTree = rewrite.input_tree || rewrite.normalized_tree || rewrite.tree;
    const outputTree = rewrite.transformed === true
      ? rewrite.tree
      : inputTree;

    const identityScore = scoreProgram({
      inputTree,
      outputTree: inputTree,
      expectations: oneCase.expectations,
    });

    const transformedScore = rewrite.scores || scoreProgram({
      inputTree,
      outputTree,
      expectations: oneCase.expectations,
    });

    const transformedVerification = rewrite.verification || verifyProgram(transformedScore, gates);

    const candidates = Array.isArray(rewrite.candidate_scores)
      ? rewrite.candidate_scores.map((item) => asCompactCandidate(item))
      : [];

    candidates.sort((left, right) => {
      const l = typeof left.total === "number" ? left.total : Number.NEGATIVE_INFINITY;
      const r = typeof right.total === "number" ? right.total : Number.NEGATIVE_INFINITY;
      return r - l;
    });

    cases.push({
      id: oneCase.id,
      title: oneCase.title,
      source_type: rewrite.source_type || oneCase.sourceType,
      transformed: rewrite.transformed === true,
      selected_program_id: rewrite.selected_program?.program_id || null,
      selected_program: rewrite.selected_program || null,
      score: {
        total: round(transformedScore.total),
        R_completeness: round(transformedScore.R_completeness),
        R_efficiency: round(transformedScore.R_efficiency),
        metrics: {
          action_recall: round(transformedScore.metrics?.action_recall),
          name_recall: round(transformedScore.metrics?.name_recall),
          text_f1: round(transformedScore.metrics?.text_f1),
          state_recall: round(transformedScore.metrics?.state_recall),
          node_reduction: round(transformedScore.metrics?.node_reduction),
          token_reduction: round(transformedScore.metrics?.token_reduction),
          depth_reduction: round(transformedScore.metrics?.depth_reduction),
        },
      },
      baseline: {
        total: round(identityScore.total),
        R_completeness: round(identityScore.R_completeness),
        R_efficiency: round(identityScore.R_efficiency),
      },
      delta_from_baseline: round((transformedScore.total || 0) - (identityScore.total || 0)),
      verification: {
        passed: transformedVerification.passed === true,
        failures: transformedVerification.failures || [],
      },
      candidates,
    });
  }

  const summary = {
    case_count: cases.length,
    transformed_count: cases.filter((one) => one.transformed).length,
    gate_pass_count: cases.filter((one) => one.verification.passed).length,
    avg_action_recall: round(average(cases.map((one) => one.score.metrics.action_recall))),
    avg_token_reduction: round(average(cases.map((one) => one.score.metrics.token_reduction))),
    avg_total_score: round(average(cases.map((one) => one.score.total))),
    avg_delta_from_baseline: round(average(cases.map((one) => one.delta_from_baseline))),
  };

  return {
    generatedAt: new Date().toISOString(),
    machine: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
    },
    config: {
      fixtures: fixtures.path,
      library: libraryDir,
      gates,
      fixture_name: fixtures.name,
      fixture_description: fixtures.description,
    },
    library: {
      program_count: libraryEntries.length,
      program_ids: libraryEntries.map((entry) => entry.metadata?.program_id).filter(Boolean),
    },
    summary,
    cases,
    selected_programs: summarizeSelectedPrograms(cases),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const payload = await runBench(args);
  const report = markdownReport(payload);

  if (args.out) {
    const outAbs = await writeFileSafe(args.out, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(`Wrote ${outAbs}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }

  if (args.report) {
    const reportAbs = await writeFileSafe(args.report, report);
    process.stdout.write(`Wrote ${reportAbs}\n`);
  }
}

const isMain = import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
