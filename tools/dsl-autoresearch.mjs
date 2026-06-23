#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const AUTORESEARCH_REPO = process.env.AUTORESEARCH_REPO_URL || "https://github.com/miolini/autoresearch-macos.git";
const AUTORESEARCH_PIN = process.env.AUTORESEARCH_PIN || "537c6e6d0ecf7d28f9d70ce20bb05d8c7ed9cfce";
const AUTORESEARCH_DIR = path.resolve(process.cwd(), "third_party/autoresearch-macos");
const PROGRAM_FILE = path.resolve(AUTORESEARCH_DIR, "program.units-dsl.md");

function usage() {
  return `
Usage:
  node tools/dsl-autoresearch.mjs setup
  node tools/dsl-autoresearch.mjs doctor
  node tools/dsl-autoresearch.mjs where

Env overrides:
  AUTORESEARCH_REPO_URL   Git URL for compatible autoresearch fork
  AUTORESEARCH_PIN        Commit SHA to checkout for reproducible runs
`;
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureParentDir() {
  await fs.mkdir(path.dirname(AUTORESEARCH_DIR), { recursive: true });
}

function makeProgram(repoRoot) {
  return `# Units DSL Autoresearch Program

You are running an autonomous improvement loop for the Units DSL stack.

## Repository Under Improvement

- Target repo: \`${repoRoot}\`
- Primary benchmark gate: \`pnpm bench:llm:live\`
- Full gate: \`make verify-all\`

## Goal

Improve robustness and quality of generated Units DSL while preserving correctness:

1. Keep live benchmark quality gates passing.
2. Improve parse success and required-structure pass rates under model variation.
3. Avoid regressions in existing benches/tests.

## Allowed Edit Scope

Prioritize edits in:

- \`tools/llm-bench.mjs\`
- \`bench/llm-cases.json\` (only if strictly needed for clearer requirements)
- tests under \`test/\` that validate LLM bench behavior

Do not modify unrelated product/runtime behavior unless required to fix a benchmarked correctness issue.

## Iteration Loop

1. \`cd ${repoRoot}\`
2. Run: \`pnpm bench:llm:live\`
3. Inspect failures in:
   - \`bench/results/llm-bench-live.md\`
   - \`bench/results/llm-bench-live.json\`
4. Make minimal targeted fix.
5. Re-run \`pnpm bench:llm:live\`.
6. If passing, run \`make verify-all\`.
7. Keep only changes that improve or preserve gate performance.

## Keep/Reject Rule

- Keep changes only if:
  - \`pnpm bench:llm:live\` passes, and
  - \`make verify-all\` passes.
- Reject and revert candidate changes that fail either criterion.

## Notes

- Prefer deterministic fixes over brittle prompt-only changes.
- Keep fixes explainable and bounded.
- Add small regression tests for newly fixed failure modes where practical.
`;
}

async function setup() {
  await ensureParentDir();
  const hasGit = await exists(path.join(AUTORESEARCH_DIR, ".git"));
  if (!hasGit) {
    await run("git", ["clone", AUTORESEARCH_REPO, AUTORESEARCH_DIR], { cwd: process.cwd() });
  }
  await run("git", ["fetch", "--all", "--tags"], { cwd: AUTORESEARCH_DIR });
  await run("git", ["checkout", AUTORESEARCH_PIN], { cwd: AUTORESEARCH_DIR });
  const program = makeProgram(path.resolve(process.cwd()));
  await fs.writeFile(PROGRAM_FILE, program, "utf-8");
  process.stdout.write([
    `Autoresearch repo: ${AUTORESEARCH_DIR}`,
    `Pinned commit: ${AUTORESEARCH_PIN}`,
    `Program file: ${PROGRAM_FILE}`,
    "",
    "Next:",
    `  cd ${AUTORESEARCH_DIR}`,
    "  UV_PYTHON=python3.13 uv sync",
    "  UV_PYTHON=python3.13 uv run prepare.py",
    "Then point your coding agent to program.units-dsl.md.",
    "",
  ].join("\n"));
}

async function doctor() {
  if (!(await exists(path.join(AUTORESEARCH_DIR, ".git")))) {
    throw new Error(`Autoresearch checkout missing at ${AUTORESEARCH_DIR}. Run setup first.`);
  }
  await run("uv", ["sync"], {
    cwd: AUTORESEARCH_DIR,
    env: { ...process.env, UV_PYTHON: "python3.13" },
  });
  await run("uv", ["run", "python", "-c", "import torch; print('torch', torch.__version__, 'mps', torch.backends.mps.is_available())"], {
    cwd: AUTORESEARCH_DIR,
    env: { ...process.env, UV_PYTHON: "python3.13" },
  });
  process.stdout.write("Doctor checks passed.\n");
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    process.stdout.write(usage());
    return;
  }
  if (cmd === "setup") {
    await setup();
    return;
  }
  if (cmd === "doctor") {
    await doctor();
    return;
  }
  if (cmd === "where") {
    process.stdout.write(`${AUTORESEARCH_DIR}\n`);
    return;
  }
  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
