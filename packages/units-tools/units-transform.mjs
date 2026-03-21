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
  serializeAgentTree,
} from "@botfather/units/tree-ir";

function parseArgs(argv) {
  const out = {
    source: "dom",
    context: null,
    out: null,
    traceOut: null,
    agentOut: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--program") out.program = String(argv[++i] || "");
    else if (arg === "--input") out.input = String(argv[++i] || "");
    else if (arg === "--source") out.source = String(argv[++i] || out.source);
    else if (arg === "--context") out.context = String(argv[++i] || "");
    else if (arg === "--out") out.out = String(argv[++i] || "");
    else if (arg === "--trace-out") out.traceOut = String(argv[++i] || "");
    else if (arg === "--agent-out") out.agentOut = String(argv[++i] || "");
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function usage() {
  return `\nUsage:\n  units-transform --program <program.ui> --input <tree.json>\n                  [--source dom|a11y|ir]\n                  [--context context.json]\n                  [--out result.json]\n                  [--trace-out trace.json]\n                  [--agent-out agent.json]\n`;
}

function normalizeInput(sourceType, tree) {
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

  if (!args.program || !args.input) {
    process.stderr.write("Missing required args --program and --input\n");
    process.stderr.write(usage());
    process.exit(1);
  }

  const programPath = path.resolve(process.cwd(), args.program);
  const sourceType = String(args.source || "dom").toLowerCase();

  const [programSource, rawInputTree, context] = await Promise.all([
    fs.readFile(programPath, "utf-8"),
    readJson(args.input),
    args.context ? readJson(args.context) : Promise.resolve({}),
  ]);

  const inputTree = normalizeInput(sourceType, rawInputTree);
  const program = compileTransformProgram(programSource);
  const run = runTransformProgram(program, inputTree, context || {});

  const payload = {
    source_type: sourceType,
    program: run.program,
    tree: run.tree,
    trace: run.trace,
  };

  if (args.out) {
    const outFile = await writeJson(args.out, payload);
    process.stdout.write(`Wrote ${outFile}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }

  if (args.traceOut) {
    const outFile = await writeJson(args.traceOut, run.trace);
    process.stdout.write(`Wrote ${outFile}\n`);
  }

  if (args.agentOut) {
    const outFile = await writeJson(args.agentOut, serializeAgentTree(run.tree));
    process.stdout.write(`Wrote ${outFile}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
