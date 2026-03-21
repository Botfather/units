#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  runSynthesisLoop,
} from "@botfather/units/synthesis";
import {
  writeVerifiedProgram,
} from "@botfather/units/library";

function parseArgs(argv) {
  const out = {
    rounds: 2,
    candidates: 4,
    minDelta: 0.03,
    source: "any",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seed-dir") out.seedDir = String(argv[++i] || "");
    else if (arg === "--seed") out.seed = String(argv[++i] || "");
    else if (arg === "--dataset") out.dataset = String(argv[++i] || "");
    else if (arg === "--gates") out.gates = String(argv[++i] || "");
    else if (arg === "--source") out.source = String(argv[++i] || "any");
    else if (arg === "--rounds") out.rounds = Number(argv[++i]);
    else if (arg === "--candidates") out.candidates = Number(argv[++i]);
    else if (arg === "--min-delta") out.minDelta = Number(argv[++i]);
    else if (arg === "--model") out.model = String(argv[++i] || "");
    else if (arg === "--base-url") out.baseUrl = String(argv[++i] || out.baseUrl);
    else if (arg === "--library-dir") out.libraryDir = String(argv[++i] || "");
    else if (arg === "--candidate-file") out.candidateFile = String(argv[++i] || "");
    else if (arg === "--out") out.out = String(argv[++i] || "");
    else if (arg === "--help" || arg === "-h") out.help = true;
  }

  return out;
}

function usage() {
  return `\nUsage:\n  units-synthesize --dataset <dataset.json> [--seed-dir <dir> | --seed <a.ui,b.ui>]\n                  [--gates gates.json]\n                  [--rounds 2] [--candidates 4] [--min-delta 0.03]\n                  [--model gpt-4.1-mini] [--base-url https://api.openai.com/v1]\n                  [--candidate-file candidates.json]\n                  [--library-dir <library-dir>]\n                  [--out result.json]\n`;
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

async function collectUiFiles(entry, isRoot = false) {
  const abs = path.resolve(process.cwd(), entry);
  const base = path.basename(abs);
  if (base === "node_modules" || base === ".git" || base === "dist" || base === "build" || base === ".vite") {
    return [];
  }

  let stat = await fs.lstat(abs);
  if (stat.isSymbolicLink()) {
    if (!isRoot) return [];
    stat = await fs.stat(abs);
  }

  if (stat.isFile()) return abs.endsWith(".ui") ? [abs] : [];

  const out = [];
  const items = await fs.readdir(abs);
  for (const item of items) {
    const sub = await collectUiFiles(path.join(abs, item), false);
    out.push(...sub);
  }
  return out;
}

async function loadSeedPrograms(args) {
  const out = [];

  if (args.seedDir) {
    const files = await collectUiFiles(args.seedDir, true);
    for (const file of files) {
      const source = await fs.readFile(file, "utf-8");
      const metadataFile = file.replace(/\.ui$/, ".meta.json");
      let metadata = null;
      try {
        metadata = JSON.parse(await fs.readFile(metadataFile, "utf-8"));
      } catch {
        metadata = null;
      }
      out.push({ source, metadata });
    }
  }

  if (args.seed) {
    const files = String(args.seed)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const rel of files) {
      const file = path.resolve(process.cwd(), rel);
      const source = await fs.readFile(file, "utf-8");
      out.push({ source, metadata: null });
    }
  }

  return out;
}

async function loadDataset(datasetFile) {
  const abs = path.resolve(process.cwd(), datasetFile);
  const baseDir = path.dirname(abs);
  const raw = await fs.readFile(abs, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Dataset must be an array.");

  const out = [];
  for (const item of parsed) {
    const one = { ...item };
    if (!one.inputTree && one.inputFile) {
      const file = path.resolve(baseDir, one.inputFile);
      one.inputTree = JSON.parse(await fs.readFile(file, "utf-8"));
    }
    if (!one.inputTree && one.tree) {
      one.inputTree = one.tree;
    }
    out.push(one);
  }
  return out;
}

async function callOpenAiCandidates({
  apiKey,
  baseUrl,
  model,
  bestSource,
  candidates,
}) {
  if (!apiKey || !model) return [];

  const endpoint = `${String(baseUrl).replace(/\/$/, "")}/responses`;
  const system = [
    "You generate Units transform programs.",
    "Return a strict JSON array of strings.",
    "Each string must be valid .ui source with Program(kind:'transform').",
  ].join("\n");

  const user = [
    `Create ${candidates} alternative transform programs.`,
    "Program to improve:",
    bestSource || "",
  ].join("\n\n");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_output_tokens: 2000,
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: user }] },
      ],
    }),
  });

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  const text = typeof payload?.output_text === "string"
    ? payload.output_text
    : "";

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  if (!args.dataset) {
    process.stderr.write("Missing --dataset\n");
    process.stderr.write(usage());
    process.exit(1);
  }

  const [seedPrograms, dataset, gateConfig, candidateFilePayload] = await Promise.all([
    loadSeedPrograms(args),
    loadDataset(args.dataset),
    args.gates ? readJson(args.gates) : Promise.resolve({}),
    args.candidateFile ? readJson(args.candidateFile) : Promise.resolve([]),
  ]);

  const staticCandidates = Array.isArray(candidateFilePayload)
    ? candidateFilePayload
    : Array.isArray(candidateFilePayload?.candidates)
      ? candidateFilePayload.candidates
      : [];

  const apiKey = process.env.OPENAI_API_KEY || "";

  const result = await runSynthesisLoop({
    seedPrograms,
    dataset,
    rounds: args.rounds,
    candidatesPerRound: args.candidates,
    minDelta: args.minDelta,
    gates: gateConfig,
    generateCandidates: async ({ round, currentBest, candidatesPerRound }) => {
      const fromFile = staticCandidates
        .map((item) => (typeof item === "string" ? item : item?.source))
        .filter(Boolean)
        .slice((round - 1) * candidatesPerRound, round * candidatesPerRound);

      const fromModel = await callOpenAiCandidates({
        apiKey,
        baseUrl: args.baseUrl,
        model: args.model,
        bestSource: currentBest?.source || "",
        candidates: Math.max(0, candidatesPerRound - fromFile.length),
      });

      return [...fromFile, ...fromModel].slice(0, candidatesPerRound);
    },
  });

  const promotedWrites = [];
  if (args.libraryDir) {
    for (const entry of result.promoted || []) {
      const written = await writeVerifiedProgram({
        directory: args.libraryDir,
        programSource: entry.source,
        metadata: entry.metadata,
      });
      promotedWrites.push({
        program_id: entry.metadata.program_id,
        ...written,
      });
    }
  }

  const payload = {
    ...result,
    promoted_writes: promotedWrites,
    config: {
      ...result.config,
      rounds: args.rounds,
      candidatesPerRound: args.candidates,
      minDelta: args.minDelta,
      model: args.model || null,
      libraryDir: args.libraryDir || null,
    },
  };

  if (args.out) {
    const outFile = await writeJson(args.out, payload);
    process.stdout.write(`Wrote ${outFile}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
