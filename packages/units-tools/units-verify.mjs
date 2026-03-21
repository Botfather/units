#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  compileTransformProgram,
  runTransformProgram,
} from "@botfather/units/transform";
import {
  normalizeDomTree,
  normalizeA11yTree,
  normalizeIrNode,
} from "@botfather/units/tree-ir";
import {
  scoreProgram,
  verifyProgram,
} from "@botfather/units/reward";

function parseArgs(argv) {
  const out = {
    source: "dom",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--program") out.program = String(argv[++i] || "");
    else if (arg === "--input") out.input = String(argv[++i] || "");
    else if (arg === "--before") out.before = String(argv[++i] || "");
    else if (arg === "--after") out.after = String(argv[++i] || "");
    else if (arg === "--source") out.source = String(argv[++i] || out.source);
    else if (arg === "--context") out.context = String(argv[++i] || "");
    else if (arg === "--expectations") out.expectations = String(argv[++i] || "");
    else if (arg === "--out") out.out = String(argv[++i] || "");
    else if (arg === "--gate-action-recall") out.gateActionRecall = Number(argv[++i]);
    else if (arg === "--gate-name-recall") out.gateNameRecall = Number(argv[++i]);
    else if (arg === "--gate-text-f1") out.gateTextF1 = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function usage() {
  return `\nUsage:\n  units-verify --program <program.ui> --input <tree.json> [--source dom|a11y|ir]\n  units-verify --before <before.json> --after <after.json> [--source dom|a11y|ir]\n\nOptional:\n  --context <context.json>\n  --expectations <expectations.json>\n  --gate-action-recall <num>\n  --gate-name-recall <num>\n  --gate-text-f1 <num>\n  --out <result.json>\n`;
}

function normalizeTree(sourceType, tree) {
  if (sourceType === "dom") return normalizeDomTree(tree);
  if (sourceType === "a11y") return normalizeA11yTree(tree);
  return normalizeIrNode(tree);
}

async function readJson(file) {
  const abs = path.resolve(process.cwd(), file);
  const raw = await fs.readFile(abs, "utf-8");
  return JSON.parse(raw);
}

async function writeJson(file, value) {
  const abs = path.resolve(process.cwd(), file);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  return abs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const sourceType = String(args.source || "dom").toLowerCase();
  const gates = {
    action_recall: Number.isFinite(args.gateActionRecall) ? args.gateActionRecall : undefined,
    name_recall: Number.isFinite(args.gateNameRecall) ? args.gateNameRecall : undefined,
    text_f1: Number.isFinite(args.gateTextF1) ? args.gateTextF1 : undefined,
  };

  const expectations = args.expectations ? await readJson(args.expectations) : {};

  let inputTree;
  let outputTree;
  let run = null;

  if (args.program && args.input) {
    const [programSource, rawInputTree, context] = await Promise.all([
      fs.readFile(path.resolve(process.cwd(), args.program), "utf-8"),
      readJson(args.input),
      args.context ? readJson(args.context) : Promise.resolve({}),
    ]);

    inputTree = normalizeTree(sourceType, rawInputTree);
    const program = compileTransformProgram(programSource);
    run = runTransformProgram(program, inputTree, context || {});
    outputTree = run.tree;
  } else if (args.before && args.after) {
    const [rawBefore, rawAfter] = await Promise.all([
      readJson(args.before),
      readJson(args.after),
    ]);
    inputTree = normalizeTree(sourceType, rawBefore);
    outputTree = normalizeTree(sourceType, rawAfter);
  } else {
    process.stderr.write("Provide either --program + --input or --before + --after\n");
    process.stderr.write(usage());
    process.exit(1);
  }

  const score = scoreProgram({
    inputTree,
    outputTree,
    expectations,
  });
  const verification = verifyProgram(score, gates);

  const payload = {
    source_type: sourceType,
    score,
    verification,
    program: run?.program || null,
    trace: run?.trace || null,
  };

  if (args.out) {
    const outFile = await writeJson(args.out, payload);
    process.stdout.write(`Wrote ${outFile}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }

  if (!verification.passed) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
