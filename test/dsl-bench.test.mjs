import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { loadConfig, markdownReport, parseArgs } from "../tools/dsl-bench.mjs";

const execFileAsync = promisify(execFile);

test("dsl bench config loads curated cases and corpora", async () => {
  const config = await loadConfig("bench/dsl-bench.config.json");
  assert.equal(config.name, "units-dsl-bench-v1");
  assert.ok(config.cases.length >= 4);
  assert.ok(config.corpora.length >= 3);
});

test("dsl bench parseArgs supports quick mode and custom outputs", () => {
  const args = parseArgs([
    "--config", "bench/dsl-bench.config.json",
    "--out", "tmp/out.json",
    "--report", "tmp/out.md",
    "--quick",
  ]);
  assert.equal(args.config, "bench/dsl-bench.config.json");
  assert.equal(args.out, "tmp/out.json");
  assert.equal(args.report, "tmp/out.md");
  assert.equal(args.quick, true);
});

test("dsl bench markdown report includes plugin section", () => {
  const report = markdownReport({
    generatedAt: "2026-03-18T00:00:00.000Z",
    mode: "quick",
    config: { path: "bench/dsl-bench.config.json" },
    machine: { nodeVersion: process.version, platform: process.platform, arch: process.arch },
    summary: { caseCount: 1, corpusCount: 1 },
    cases: [
      {
        id: "todo_list",
        input: { chars: 100, nodes: 8 },
        parse: { avgMs: 0.01 },
        format: { avgMs: 0.02 },
        editLoop: { incrementalParse: { avgMs: 0.03 } },
        plugins: {
          astLoad: { metrics: { avgMs: 0.04 } },
          formatLoad: { metrics: { avgMs: 0.05 } },
          tokensLoad: { metrics: { avgMs: 0.06 } },
          highlightLoad: { metrics: { avgMs: 0.07 } },
        },
        renderScenarios: [
          { id: "base", size: 10, outputNodeCount: 20, metrics: { avgMs: 0.08, p95Ms: 0.09, opsPerSecond: 1000 } },
        ],
      },
    ],
    corpora: [
      { id: "examples", fileCount: 2, totals: { chars: 300, nodes: 20 }, parse: { avgMs: 0.1 }, format: { avgMs: 0.2 } },
    ],
  });
  assert.match(report, /Plugin \/ Compile Path/);
  assert.match(report, /AST Load ms/);
});

test("dsl bench CLI quick run writes plugin metrics", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsl-bench-cli-"));
  const outPath = path.join(tempDir, "dsl-bench.json");
  const reportPath = path.join(tempDir, "dsl-bench.md");

  await execFileAsync(process.execPath, [
    path.join(process.cwd(), "tools/dsl-bench.mjs"),
    "--config", path.join(process.cwd(), "bench/dsl-bench.config.json"),
    "--quick",
    "--out", outPath,
    "--report", reportPath,
  ], { cwd: process.cwd() });

  const payload = JSON.parse(await fs.readFile(outPath, "utf-8"));
  const report = await fs.readFile(reportPath, "utf-8");

  assert.equal(payload.mode, "quick");
  assert.ok(payload.cases.length >= 4);
  assert.ok(payload.corpora.length >= 3);
  assert.ok(payload.cases[0].plugins.astLoad.metrics.avgMs >= 0);
  assert.ok(payload.cases[0].plugins.highlightLoad.outputBytes > 0);
  assert.match(report, /Plugin \/ Compile Path/);
});
