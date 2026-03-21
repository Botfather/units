import { spawn } from "node:child_process";

const THRESHOLDS = {
  lines: Number.parseFloat(process.env.COVERAGE_LINES_MIN ?? "94"),
  branches: Number.parseFloat(process.env.COVERAGE_BRANCHES_MIN ?? "70"),
  functions: Number.parseFloat(process.env.COVERAGE_FUNCTIONS_MIN ?? "93"),
};

const requestedTests = process.argv.slice(2);
const testTargets = requestedTests.length > 0 ? requestedTests : ["./test"];
const nodeArgs = ["--test", "--experimental-test-coverage", ...testTargets];

const child = spawn(process.execPath, nodeArgs, {
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

let combinedOutput = "";

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  combinedOutput += text;
  process.stdout.write(text);
});

child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  combinedOutput += text;
  process.stderr.write(text);
});

child.on("close", (code, signal) => {
  if (signal) {
    console.error(`Coverage run terminated by signal: ${signal}`);
    process.exit(1);
  }

  if (code !== 0) {
    process.exit(code ?? 1);
  }

  const tableRegex = /all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/gi;
  let match;
  let lastMatch = null;
  while ((match = tableRegex.exec(combinedOutput)) !== null) {
    lastMatch = match;
  }

  if (!lastMatch) {
    console.error(
      "Could not parse coverage summary from Node test output. Expected an 'all files' coverage row.",
    );
    process.exit(1);
  }

  const measured = {
    lines: Number.parseFloat(lastMatch[1]),
    branches: Number.parseFloat(lastMatch[2]),
    functions: Number.parseFloat(lastMatch[3]),
  };

  const failures = [];
  if (measured.lines < THRESHOLDS.lines) {
    failures.push(`lines ${measured.lines.toFixed(2)}% < ${THRESHOLDS.lines.toFixed(2)}%`);
  }
  if (measured.branches < THRESHOLDS.branches) {
    failures.push(
      `branches ${measured.branches.toFixed(2)}% < ${THRESHOLDS.branches.toFixed(2)}%`,
    );
  }
  if (measured.functions < THRESHOLDS.functions) {
    failures.push(
      `functions ${measured.functions.toFixed(2)}% < ${THRESHOLDS.functions.toFixed(2)}%`,
    );
  }

  if (failures.length > 0) {
    console.error("Coverage thresholds failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `Coverage thresholds passed: lines ${measured.lines.toFixed(2)}%, branches ${measured.branches.toFixed(2)}%, functions ${measured.functions.toFixed(2)}%`,
  );
});
