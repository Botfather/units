import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import {
  buildBenchmarkPlan,
  ensureMachineIdentity,
  executeBenchmarkPlan,
  loadConfig,
  markdownReport,
  normalizeConfig,
  parseBenchmarkOutput,
} from "../tools/system-bench-lib.mjs";

const execFileAsync = promisify(execFile);
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeProfile(root = process.cwd()) {
  return {
    hostname: "bench-host",
    platform: "darwin",
    release: "24.3.0",
    arch: "arm64",
    cpu: {
      model: "Benchmark CPU",
      logicalCores: 8,
      averageSpeedMHz: 3200,
    },
    memory: {
      totalBytes: 32 * 1024 ** 3,
      totalGiB: 32,
    },
    disk: {
      targetPath: path.join(root, ".bench", "scratch"),
      filesystem: "apfs",
      sizeBytes: 1024 ** 4,
      usedBytes: 200 * 1024 ** 3,
      availableBytes: 824 * 1024 ** 3,
      sizeGiB: 1024,
      availableGiB: 824,
      mountPoint: "/",
    },
    repository: {
      root,
      gitRevision: "abc123def456",
      gitBranch: "main",
    },
    node: {
      version: process.version,
      v8: process.versions.v8,
      uv: process.versions.uv,
    },
  };
}

test("ensureMachineIdentity creates a UUID once and reuses it", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-bench-id-"));
  const uuidFile = path.join(tempDir, ".bench", "machine-id.json");

  const first = await ensureMachineIdentity(uuidFile, {
    hostname: "bench-host",
    platform: "darwin",
    arch: "arm64",
  });
  const second = await ensureMachineIdentity(uuidFile, {
    hostname: "changed-host",
    platform: "linux",
    arch: "x64",
  });

  assert.match(first.machineId, UUID_V4_RE);
  assert.equal(second.machineId, first.machineId);
  assert.equal(second.created, false);
  assert.equal(second.hostSnapshot.hostname, "bench-host");
});

test("repo system benchmark config stays valid and covers core categories", async () => {
  const config = await loadConfig("bench/system-bench.config.json");
  const categories = new Set(config.suites.map((suite) => suite.category));

  assert.ok(config.suites.length >= 10);
  assert.ok(categories.has("cpu"));
  assert.ok(categories.has("memory"));
  assert.ok(categories.has("disk"));
  assert.ok(categories.has("network"));
});

test("buildBenchmarkPlan resolves machine values and flags missing dependencies or config", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-bench-plan-"));
  const config = normalizeConfig({
    name: "test-plan",
    defaults: {
      scratchDir: ".bench/scratch",
      diskBenchmarkFile: ".bench/scratch/fio.dat",
      cpuMaxPrime: 40000,
    },
    suites: [
      {
        "id": "ready_suite",
        "title": "Ready Suite",
        "category": "cpu",
        "standard": "mock",
        "tool": "node",
        "parser": "sysbench_cpu",
        "command": ["node", "-e", "process.stdout.write('ok')", "{{machine.cpu.logicalCores}}", "{{defaults.cpuMaxPrime}}"]
      },
      {
        "id": "missing_tool",
        "title": "Missing Tool",
        "category": "cpu",
        "standard": "mock",
        "tool": "missing-binary",
        "command": ["missing-binary", "--version"]
      },
      {
        "id": "needs_env",
        "title": "Needs Env",
        "category": "network",
        "standard": "mock",
        "tool": "node",
        "requiresEnv": ["IPERF3_HOST"],
        "command": ["node", "-e", "process.stdout.write(process.env.IPERF3_HOST || '')", "{{env.IPERF3_HOST}}"]
      }
    ],
  });

  const plan = await buildBenchmarkPlan({
    config,
    identity: {
      machineId: "e5ab7a57-6df9-4ad6-86be-003d98e7f54f",
      createdAt: "2026-03-17T00:00:00.000Z",
      hostSnapshot: { hostname: "bench-host", platform: "darwin", arch: "arm64" },
      filePath: path.join(tempDir, ".bench", "machine-id.json"),
    },
    machineProfile: makeProfile(tempDir),
    cwd: tempDir,
    env: {},
    tooling: {
      node: { available: true, version: process.version, probeCommand: ["node", "--version"] },
      "missing-binary": { available: false, version: null, probeCommand: ["missing-binary", "--version"] },
    },
  });

  assert.equal(plan.summary.ready, 1);
  assert.equal(plan.summary.missingDependency, 1);
  assert.equal(plan.summary.requiresConfiguration, 1);
  assert.equal(plan.suites[0].command.at(-2), "8");
  assert.equal(plan.suites[0].command.at(-1), "40000");
  assert.equal(plan.suites[1].status, "missing_dependency");
  assert.equal(plan.suites[2].status, "requires_configuration");
});

test("benchmark parsers extract core metrics from standard tool outputs", () => {
  const cpu = parseBenchmarkOutput("sysbench_cpu", `
CPU speed:
    events per second:  6508.16

General statistics:
    total time:                          10.0008s
    total number of events:              65104

Latency (ms):
         min:                                    0.15
         avg:                                    0.15
         max:                                    1.33
         95th percentile:                        0.17
`);
  const memory = parseBenchmarkOutput("sysbench_memory", `
Total operations: 16384 (17159665.64 per second)

16384.00 MiB transferred (16757.49 MiB/sec)

General statistics:
    total time:                          1.0000s
    total number of events:              16384

Latency (ms):
         avg:                                    0.06
         95th percentile:                        0.08
`);
  const fio = parseBenchmarkOutput("fio_json", `note: both iodepth >= 1 and synchronous I/O engine are selected, queue depth will be capped at 1
${JSON.stringify({
  jobs: [
    {
      read: { bw_bytes: 1048576, iops: 256, clat_ns: { mean: 1500 } },
      write: { bw_bytes: 524288, iops: 128, clat_ns: { mean: 3200 } },
    },
  ],
})}`);
  const iperf = parseBenchmarkOutput("iperf3_json", JSON.stringify({
    start: { test_start: { protocol: "TCP", duration: 20 } },
    end: {
      sum_sent: { bits_per_second: 910000000, retransmits: 4 },
      sum_received: { bits_per_second: 905000000 },
    },
  }));

  assert.equal(cpu.error, null);
  assert.equal(cpu.metrics.events_per_second, 6508.16);
  assert.equal(memory.metrics.throughput_mib_per_second, 16757.49);
  assert.equal(fio.metrics.read_iops, 256);
  assert.equal(iperf.metrics.protocol, "TCP");
  assert.equal(iperf.metrics.received_bits_per_second, 905000000);
});

test("executeBenchmarkPlan runs ready suites with preflight and parses output", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-bench-run-"));
  const plan = {
    generatedAt: "2026-03-17T00:00:00.000Z",
    mode: "plan",
    config: { path: path.join(tempDir, "bench.json"), name: "mock" },
    machine: {
      id: "cc9584c0-05f6-425f-8973-2849b0e1a6aa",
      identityFile: path.join(tempDir, ".bench", "machine-id.json"),
      profile: makeProfile(tempDir),
    },
    paths: {
      resultsDir: path.join(tempDir, "results"),
      scratchDir: path.join(tempDir, ".bench", "scratch"),
      diskBenchmarkFile: path.join(tempDir, ".bench", "scratch", "fio.dat"),
      cwd: tempDir,
    },
    tooling: {
      node: { available: true, version: process.version, probeCommand: ["node", "--version"] },
    },
    summary: { total: 1, ready: 1, optional: 0, disabled: 0, missingDependency: 0, requiresConfiguration: 0 },
    suites: [
      {
        id: "mock_cpu",
        title: "Mock CPU",
        category: "cpu",
        standard: "sysbench",
        tool: "node",
        parser: "sysbench_cpu",
        description: null,
        notes: null,
        optional: false,
        expectedMetrics: ["events_per_second", "latency_ms_avg"],
        timeoutMs: 5000,
        status: "ready",
        reason: null,
        requiredEnv: [],
        missingContext: [],
        command: ["node", "-e", "console.log(`CPU speed:\\n    events per second:  777.77\\n\\nGeneral statistics:\\n    total time:                          2.0000s\\n    total number of events:              1555\\n\\nLatency (ms):\\n         avg:                                    0.22\\n         95th percentile:                        0.30\\n`)"],
        commandString: "node mock",
        preflight: {
          description: "preflight",
          tool: "node",
          timeoutMs: 5000,
          command: ["node", "-e", "process.stdout.write('preflight-ok')"],
          commandString: "node preflight",
        },
      },
    ],
  };

  const executed = await executeBenchmarkPlan(plan);
  const suite = executed.suites[0];

  assert.equal(executed.summary.executed, 1);
  assert.equal(executed.summary.passed, 1);
  assert.equal(suite.execution.status, "passed");
  assert.equal(suite.execution.preflight.exitCode, 0);
  assert.equal(suite.execution.metrics.events_per_second, 777.77);
  assert.equal(suite.execution.metrics.latency_ms_avg, 0.22);
});

test("executeBenchmarkPlan counts parse warnings separately from clean passes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-bench-warning-"));
  const plan = {
    generatedAt: "2026-03-17T00:00:00.000Z",
    mode: "plan",
    config: { path: path.join(tempDir, "bench.json"), name: "mock" },
    machine: {
      id: "cc9584c0-05f6-425f-8973-2849b0e1a6aa",
      identityFile: path.join(tempDir, ".bench", "machine-id.json"),
      profile: makeProfile(tempDir),
    },
    paths: {
      resultsDir: path.join(tempDir, "results"),
      scratchDir: path.join(tempDir, ".bench", "scratch"),
      diskBenchmarkFile: path.join(tempDir, ".bench", "scratch", "fio.dat"),
      cwd: tempDir,
    },
    tooling: {
      node: { available: true, version: process.version, probeCommand: ["node", "--version"] },
    },
    summary: { total: 1, ready: 1, optional: 0, disabled: 0, missingDependency: 0, requiresConfiguration: 0 },
    suites: [
      {
        id: "mock_warning",
        title: "Mock Warning",
        category: "disk",
        standard: "fio",
        tool: "node",
        parser: "fio_json",
        description: null,
        notes: null,
        optional: false,
        expectedMetrics: ["read_iops"],
        timeoutMs: 5000,
        status: "ready",
        reason: null,
        requiredEnv: [],
        missingContext: [],
        command: ["node", "-e", "process.stdout.write('note: warning\\nnot-json')"],
        commandString: "node mock-warning",
        preflight: null,
      },
    ],
  };

  const executed = await executeBenchmarkPlan(plan);
  const suite = executed.suites[0];

  assert.equal(executed.summary.executed, 1);
  assert.equal(executed.summary.passed, 0);
  assert.equal(executed.summary.warnings, 1);
  assert.equal(executed.summary.failed, 0);
  assert.equal(executed.summary.parseErrors, 1);
  assert.equal(suite.execution.status, "passed_with_parse_error");
  assert.match(suite.execution.parseError, /Unexpected token|not valid JSON/);
});

test("executeBenchmarkPlan skips fio suites when shm is blocked by environment", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-bench-fio-skip-"));
  const plan = {
    generatedAt: "2026-03-17T00:00:00.000Z",
    mode: "plan",
    config: { path: path.join(tempDir, "bench.json"), name: "mock" },
    machine: {
      id: "cc9584c0-05f6-425f-8973-2849b0e1a6aa",
      identityFile: path.join(tempDir, ".bench", "machine-id.json"),
      profile: makeProfile(tempDir),
    },
    paths: {
      resultsDir: path.join(tempDir, "results"),
      scratchDir: path.join(tempDir, ".bench", "scratch"),
      diskBenchmarkFile: path.join(tempDir, ".bench", "scratch", "fio.dat"),
      cwd: tempDir,
    },
    tooling: {
      fio: { available: true, version: "fio-3.41", probeCommand: ["fio", "--version"] },
      node: { available: true, version: process.version, probeCommand: ["node", "--version"] },
    },
    summary: { total: 2, ready: 2, optional: 0, disabled: 0, missingDependency: 0, requiresConfiguration: 0 },
    suites: [
      {
        id: "fio_preflight_blocked",
        title: "Fio Preflight Blocked",
        category: "disk",
        standard: "fio",
        tool: "fio",
        parser: "fio_json",
        description: null,
        notes: null,
        optional: false,
        expectedMetrics: ["read_iops"],
        timeoutMs: 5000,
        status: "ready",
        reason: null,
        requiredEnv: [],
        missingContext: [],
        command: ["node", "-e", "process.stdout.write('{}')"],
        commandString: "node fio-main",
        preflight: {
          description: "preflight",
          tool: "node",
          timeoutMs: 5000,
          command: [
            "node",
            "-e",
            "process.stderr.write('shmat: Operation not permitted\\nerror: failed to setup shm segment\\n'); process.exit(1)",
          ],
          commandString: "node fio-preflight",
        },
      },
      {
        id: "fio_run_blocked",
        title: "Fio Run Blocked",
        category: "disk",
        standard: "fio",
        tool: "fio",
        parser: "fio_json",
        description: null,
        notes: null,
        optional: false,
        expectedMetrics: ["read_iops"],
        timeoutMs: 5000,
        status: "ready",
        reason: null,
        requiredEnv: [],
        missingContext: [],
        command: [
          "node",
          "-e",
          "process.stderr.write('error: failed to setup shm segment\\n'); process.exit(1)",
        ],
        commandString: "node fio-main",
        preflight: null,
      },
    ],
  };

  const executed = await executeBenchmarkPlan(plan);

  assert.equal(executed.summary.executed, 0);
  assert.equal(executed.summary.failed, 0);
  assert.equal(executed.summary.skipped, 2);
  assert.equal(executed.suites[0].execution.status, "skipped");
  assert.equal(executed.suites[1].execution.status, "skipped");
  assert.match(executed.suites[0].execution.reason, /shared-memory setup/i);
});

test("markdownReport includes machine UUID and suite status details", () => {
  const report = markdownReport({
    generatedAt: "2026-03-17T00:00:00.000Z",
    mode: "plan",
    config: { path: "bench/system-bench.config.json", name: "system-standard-v1" },
    machine: {
      id: "f7fd9f73-f64e-420f-b6db-7637ff76f8e5",
      identityFile: ".bench/machine-id.json",
      profile: makeProfile(process.cwd()),
    },
    tooling: {
      node: { available: true, version: process.version, probeCommand: ["node", "--version"] },
    },
    summary: { total: 1, ready: 1, optional: 0, disabled: 0, missingDependency: 0, requiresConfiguration: 0 },
    suites: [
      {
        id: "cpu_sysbench_single",
        title: "CPU Prime Single Thread",
        category: "cpu",
        standard: "sysbench",
        status: "ready",
        tool: "sysbench",
        commandString: "sysbench cpu run",
        expectedMetrics: ["events_per_second"],
        requiredEnv: [],
      },
    ],
  });

  assert.match(report, /Machine UUID: `f7fd9f73-f64e-420f-b6db-7637ff76f8e5`/);
  assert.match(report, /cpu_sysbench_single/);
  assert.match(report, /CPU Prime Single Thread/);
});

test("markdownReport shows warning counts for run payloads", () => {
  const report = markdownReport({
    generatedAt: "2026-03-17T00:00:00.000Z",
    mode: "run",
    config: { path: "bench/system-bench.config.json", name: "system-standard-v1" },
    machine: {
      id: "f7fd9f73-f64e-420f-b6db-7637ff76f8e5",
      identityFile: ".bench/machine-id.json",
      profile: makeProfile(process.cwd()),
    },
    tooling: {
      node: { available: true, version: process.version, probeCommand: ["node", "--version"] },
    },
    summary: { total: 1, executed: 1, passed: 0, warnings: 1, failed: 0, skipped: 0, timedOut: 0, parseErrors: 1 },
    suites: [
      {
        id: "disk_fio_seq_read",
        title: "Disk Sequential Read",
        category: "disk",
        standard: "fio",
        status: "ready",
        tool: "fio",
        commandString: "fio --name=seq_read",
        expectedMetrics: ["read_iops"],
        requiredEnv: [],
        execution: {
          status: "passed_with_parse_error",
          durationMs: 123,
          metrics: {},
          parseError: "bad json",
        },
      },
    ],
  });

  assert.match(report, /Passed cleanly: `0`/);
  assert.match(report, /Warnings: `1`/);
  assert.match(report, /Parse errors: `1`/);
});

test("CLI plan command writes a report and JSON payload without running benchmarks", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "system-bench-cli-"));
  const configPath = path.join(tempDir, "config.json");
  const uuidPath = path.join(tempDir, ".bench", "machine-id.json");
  const outPath = path.join(tempDir, "plan.json");
  const reportPath = path.join(tempDir, "plan.md");

  await fs.writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    name: "cli-plan",
    defaults: {
      scratchDir: ".bench/scratch",
      diskBenchmarkFile: ".bench/scratch/fio.dat",
    },
    suites: [
      {
        id: "node_probe",
        title: "Node Probe",
        category: "cpu",
        standard: "mock",
        tool: "node",
        command: ["node", "-e", "process.stdout.write('not-run')"],
      },
    ],
  }, null, 2));

  await execFileAsync(process.execPath, [
    path.join(process.cwd(), "tools/system-bench.mjs"),
    "plan",
    "--config",
    configPath,
    "--uuid-file",
    uuidPath,
    "--out",
    outPath,
    "--report",
    reportPath,
  ], { cwd: process.cwd() });

  const payload = JSON.parse(await fs.readFile(outPath, "utf-8"));
  const report = await fs.readFile(reportPath, "utf-8");

  assert.equal(payload.mode, "plan");
  assert.match(payload.machine.id, UUID_V4_RE);
  assert.equal(payload.suites[0].status, "ready");
  assert.match(report, /System Benchmark Plan/);
});
