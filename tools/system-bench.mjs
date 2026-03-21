#!/usr/bin/env node
import os from "node:os";
import process from "node:process";
import {
  buildBenchmarkPlan,
  collectMachineProfile,
  ensureMachineIdentity,
  executeBenchmarkPlan,
  loadConfig,
  markdownReport,
  parseArgs,
  usage,
  writeFileSafe,
} from "./system-bench-lib.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const config = await loadConfig(args.config);
  const identity = await ensureMachineIdentity(args.uuidFile, {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
  });
  const profile = await collectMachineProfile({
    cwd: process.cwd(),
    scratchDir: config.defaults.scratchDir,
  });
  const plan = await buildBenchmarkPlan({
    config,
    identity,
    machineProfile: profile,
    cwd: process.cwd(),
    env: process.env,
  });

  const payload = args.command === "run"
    ? await executeBenchmarkPlan(plan, { cwd: process.cwd(), env: process.env })
    : plan;

  const outPath = await writeFileSafe(args.out, `${JSON.stringify(payload, null, 2)}\n`);
  const reportPath = await writeFileSafe(args.report, markdownReport(payload));

  process.stdout.write(`Wrote ${outPath}\nWrote ${reportPath}\n`);

  if (args.command === "run" && payload.summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
