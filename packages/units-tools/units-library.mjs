#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  createVerifiedProgramMetadata,
  loadVerifiedLibrary,
  writeVerifiedProgram,
  rollbackProgram,
} from "@botfather/units/library";

function parseArgs(argv) {
  const hasCommand = argv[0] && !String(argv[0]).startsWith("-");
  const out = {
    command: hasCommand ? String(argv[0]) : "inspect",
  };

  for (let i = hasCommand ? 1 : 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir") out.dir = String(argv[++i] || "");
    else if (arg === "--source") out.source = String(argv[++i] || "any");
    else if (arg === "--program") out.program = String(argv[++i] || "");
    else if (arg === "--program-id") out.programId = String(argv[++i] || "");
    else if (arg === "--scores") out.scores = String(argv[++i] || "");
    else if (arg === "--constraints-passed") out.constraintsPassed = String(argv[++i] || "");
    else if (arg === "--provenance") out.provenance = String(argv[++i] || "");
    else if (arg === "--reason") out.reason = String(argv[++i] || "manual");
    else if (arg === "--out") out.out = String(argv[++i] || "");
    else if (arg === "--help" || arg === "-h") out.help = true;
  }

  return out;
}

function usage() {
  return `\nUsage:\n  units-library inspect --dir <library-dir> [--source dom|a11y|any]\n  units-library promote --dir <library-dir> --program <program.ui>\n                       [--source dom|a11y|any]\n                       [--program-id id]\n                       [--scores verify-output.json]\n                       [--constraints-passed true|false]\n  units-library rollback --dir <library-dir> --program-id <id> [--reason text]\n`;
}

function parseBoolean(value, fallback = false) {
  if (value == null) return fallback;
  const text = String(value).toLowerCase();
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  return fallback;
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

async function runInspect(args) {
  if (!args.dir) throw new Error("inspect requires --dir");

  const entries = await loadVerifiedLibrary(args.dir, {
    includeInactive: true,
    sourceType: args.source || "any",
  });

  const payload = {
    directory: path.resolve(process.cwd(), args.dir),
    count: entries.length,
    programs: entries.map((entry) => ({
      program_id: entry.metadata.program_id,
      source_type: entry.metadata.source_type,
      active: entry.metadata.active !== false,
      constraints_passed: entry.metadata.constraints_passed === true,
      total: entry.metadata.scores?.total ?? null,
      created_at: entry.metadata.created_at,
      fingerprint: entry.metadata.fingerprint,
      paths: entry.paths,
    })),
  };

  if (args.out) {
    const file = await writeJson(args.out, payload);
    process.stdout.write(`Wrote ${file}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

async function runPromote(args) {
  if (!args.dir) throw new Error("promote requires --dir");
  if (!args.program) throw new Error("promote requires --program");

  const programPath = path.resolve(process.cwd(), args.program);
  const programSource = await fs.readFile(programPath, "utf-8");

  const scorePayload = args.scores ? await readJson(args.scores) : {};
  const scores = scorePayload?.score || scorePayload;
  const derivedConstraint = scorePayload?.verification?.passed;
  const constraintsPassed = args.constraintsPassed != null
    ? parseBoolean(args.constraintsPassed, false)
    : Boolean(derivedConstraint);
  const provenance = args.provenance ? await readJson(args.provenance) : undefined;

  const metadata = createVerifiedProgramMetadata({
    programSource,
    sourceType: args.source || "any",
    scores,
    constraintsPassed,
    programId: args.programId,
    provenance,
  });

  const written = await writeVerifiedProgram({
    directory: args.dir,
    programSource,
    metadata,
  });

  const payload = {
    metadata,
    paths: written,
  };

  if (args.out) {
    const file = await writeJson(args.out, payload);
    process.stdout.write(`Wrote ${file}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

async function runRollback(args) {
  if (!args.dir) throw new Error("rollback requires --dir");
  if (!args.programId) throw new Error("rollback requires --program-id");

  const result = await rollbackProgram({
    directory: args.dir,
    programId: args.programId,
    rollbackReason: args.reason || "manual",
  });

  const payload = {
    program_id: args.programId,
    metadata_path: result.metadataPath,
    metadata: result.metadata,
  };

  if (args.out) {
    const file = await writeJson(args.out, payload);
    process.stdout.write(`Wrote ${file}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  if (args.command === "inspect") {
    await runInspect(args);
    return;
  }
  if (args.command === "promote") {
    await runPromote(args);
    return;
  }
  if (args.command === "rollback") {
    await runRollback(args);
    return;
  }

  throw new Error(`Unknown command \"${args.command}\"`);
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
