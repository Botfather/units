import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_CONFIG = "bench/system-bench.config.json";
export const DEFAULT_UUID_FILE = ".bench/machine-id.json";
export const DEFAULT_PLAN_OUT = "bench/results/system-bench-plan.json";
export const DEFAULT_PLAN_REPORT = "bench/results/system-bench-plan.md";
export const DEFAULT_RUN_OUT = "bench/results/system-bench.json";
export const DEFAULT_RUN_REPORT = "bench/results/system-bench.md";
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOOL_VERSION_ARGS = {
  fio: ["--version"],
  iperf3: ["--version"],
  node: ["--version"],
  openssl: ["version"],
  sysbench: ["--version"],
};

export function parseArgs(argv) {
  const out = {
    command: "plan",
    config: DEFAULT_CONFIG,
    uuidFile: DEFAULT_UUID_FILE,
    out: null,
    report: null,
    help: false,
  };

  let index = 0;
  if (argv[0] && !String(argv[0]).startsWith("-")) {
    out.command = String(argv[0]);
    index = 1;
  }

  for (let i = index; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (arg === "--config") out.config = String(argv[++i] || out.config);
    else if (arg === "--uuid-file") out.uuidFile = String(argv[++i] || out.uuidFile);
    else if (arg === "--out") out.out = String(argv[++i] || "");
    else if (arg === "--report") out.report = String(argv[++i] || "");
    else if (arg === "--help" || arg === "-h") out.help = true;
  }

  if (!["plan", "run"].includes(out.command)) {
    throw new Error(`Unknown command "${out.command}". Use "plan" or "run".`);
  }

  if (!out.out) out.out = out.command === "run" ? DEFAULT_RUN_OUT : DEFAULT_PLAN_OUT;
  if (!out.report) out.report = out.command === "run" ? DEFAULT_RUN_REPORT : DEFAULT_PLAN_REPORT;

  return out;
}

export function usage() {
  return `
Usage:
  node tools/system-bench.mjs [plan|run]
    [--config bench/system-bench.config.json]
    [--uuid-file .bench/machine-id.json]
    [--out bench/results/system-bench-plan.json]
    [--report bench/results/system-bench-plan.md]

Commands:
  plan   Create a machine profile, persist a machine UUID, and write a benchmark plan report.
  run    Execute ready benchmark suites, capture outputs, and write a benchmark report.

Notes:
  - The UUID file is persisted locally so reports can be compared across runs on the same host.
  - Optional suites such as iperf3 stay in the plan but are skipped until their config is available.
  - This tool never runs benchmarks unless you explicitly use the "run" command.
`;
}

function ensurePositiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function firstLine(value) {
  const src = String(value || "").trim();
  if (!src) return null;
  return src.split(/\r?\n/, 1)[0].trim() || null;
}

function fmtNumber(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function toGiB(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return null;
  return fmtNumber(bytes / (1024 ** 3), 2);
}

function isUuidV4(value) {
  return UUID_V4_RE.test(String(value || ""));
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function hasValue(value) {
  return !(value == null || value === "");
}

function safeCall(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function quoteShell(value) {
  return /[\s"'\\]/.test(value) ? JSON.stringify(value) : value;
}

function commandToString(command = []) {
  return command.map((part) => quoteShell(String(part))).join(" ");
}

function readPathValue(input, key) {
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => (acc == null ? undefined : acc[part]), input);
}

export function resolveTemplateString(input, context) {
  const missing = [];
  const value = String(input || "").replace(/\{\{\s*([A-Za-z0-9_.-]+)(?:\s*\|\|\s*([^}]+))?\s*\}\}/g, (_, key, fallback) => {
    const resolved = readPathValue(context, key);
    if (hasValue(resolved)) return String(resolved);
    if (fallback != null) return String(fallback).trim();
    missing.push(String(key));
    return `<missing:${key}>`;
  });
  return { value, missing };
}

function resolveCommand(command, context) {
  const out = [];
  const missing = [];
  for (const part of command || []) {
    const resolved = resolveTemplateString(part, context);
    out.push(resolved.value);
    missing.push(...resolved.missing);
  }
  return { command: out, missing: unique(missing) };
}

function normalizePreflight(raw, defaults) {
  if (!raw) return null;
  if (typeof raw !== "object") {
    throw new Error("Suite preflight must be an object when provided.");
  }
  if (!Array.isArray(raw.command) || raw.command.length === 0) {
    throw new Error("Suite preflight must include a non-empty `command` array.");
  }
  return {
    description: raw.description ? String(raw.description) : null,
    tool: raw.tool ? String(raw.tool) : String(raw.command[0]),
    command: raw.command.map((part) => String(part)),
    timeoutMs: ensurePositiveInteger(raw.timeoutMs, defaults.timeoutMs),
  };
}

export function normalizeConfig(config, configPath = null) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Benchmark config must be a JSON object.");
  }

  const defaults = {
    timeoutMs: ensurePositiveInteger(config?.defaults?.timeoutMs, DEFAULT_TIMEOUT_MS),
    resultsDir: String(config?.defaults?.resultsDir || "bench/results/system"),
    scratchDir: String(config?.defaults?.scratchDir || ".bench/scratch"),
    diskBenchmarkFile: String(config?.defaults?.diskBenchmarkFile || ".bench/scratch/fio-benchmark.dat"),
    cpuMaxPrime: ensurePositiveInteger(config?.defaults?.cpuMaxPrime, 200000),
    memoryBlockSize: String(config?.defaults?.memoryBlockSize || "1M"),
    memoryTotalSize: String(config?.defaults?.memoryTotalSize || "16G"),
    diskFileSize: String(config?.defaults?.diskFileSize || "4G"),
    diskRuntimeSeconds: ensurePositiveInteger(config?.defaults?.diskRuntimeSeconds, 30),
    diskQueueDepth: ensurePositiveInteger(config?.defaults?.diskQueueDepth, 32),
    diskNumJobs: ensurePositiveInteger(config?.defaults?.diskNumJobs, 1),
    diskIoEngine: String(config?.defaults?.diskIoEngine || "posixaio"),
    diskPreflightIoEngine: String(config?.defaults?.diskPreflightIoEngine || "sync"),
    networkPort: ensurePositiveInteger(config?.defaults?.networkPort, 5201),
    networkDurationSeconds: ensurePositiveInteger(config?.defaults?.networkDurationSeconds, 20),
  };

  if (!Array.isArray(config.suites) || config.suites.length === 0) {
    throw new Error("Benchmark config must include a non-empty `suites` array.");
  }

  const suites = config.suites.map((suite, index) => {
    if (!suite || typeof suite !== "object" || Array.isArray(suite)) {
      throw new Error(`Suite at index ${index} must be an object.`);
    }
    if (!suite.id) throw new Error(`Suite at index ${index} is missing \`id\`.`);
    if (!Array.isArray(suite.command) || suite.command.length === 0) {
      throw new Error(`Suite ${suite.id} must include a non-empty \`command\` array.`);
    }
    return {
      id: String(suite.id),
      title: String(suite.title || suite.id),
      category: String(suite.category || "misc"),
      standard: String(suite.standard || suite.tool || suite.command[0]),
      tool: String(suite.tool || suite.command[0]),
      parser: suite.parser ? String(suite.parser) : null,
      description: suite.description ? String(suite.description) : null,
      notes: suite.notes ? String(suite.notes) : null,
      optional: Boolean(suite.optional),
      disabled: Boolean(suite.disabled),
      timeoutMs: ensurePositiveInteger(suite.timeoutMs, defaults.timeoutMs),
      expectedMetrics: Array.isArray(suite.expectedMetrics)
        ? suite.expectedMetrics.map((metric) => String(metric))
        : [],
      requiresEnv: Array.isArray(suite.requiresEnv)
        ? unique(suite.requiresEnv.map((name) => String(name)))
        : [],
      command: suite.command.map((part) => String(part)),
      preflight: normalizePreflight(suite.preflight, defaults),
    };
  });

  return {
    schemaVersion: ensurePositiveInteger(config.schemaVersion, 1),
    name: String(config.name || "system-standard"),
    description: config.description ? String(config.description) : null,
    configPath: configPath ? path.resolve(process.cwd(), configPath) : null,
    defaults,
    suites,
  };
}

export async function loadConfig(configPath, fsApi = fs) {
  const abs = path.resolve(process.cwd(), configPath);
  const raw = await fsApi.readFile(abs, "utf-8");
  const parsed = JSON.parse(raw);
  return normalizeConfig(parsed, abs);
}

export async function ensureMachineIdentity(uuidFile, hostSnapshot = {}, fsApi = fs) {
  const abs = path.resolve(process.cwd(), uuidFile);
  try {
    const raw = await fsApi.readFile(abs, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isUuidV4(parsed.machineId)) {
      throw new Error(`Machine identity file ${abs} is invalid. Delete it to regenerate.`);
    }
    return {
      machineId: parsed.machineId,
      createdAt: parsed.createdAt || null,
      hostSnapshot: parsed.hostSnapshot || null,
      filePath: abs,
      created: false,
    };
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }

  const payload = {
    machineId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    hostSnapshot: {
      hostname: hostSnapshot.hostname || null,
      platform: hostSnapshot.platform || null,
      arch: hostSnapshot.arch || null,
    },
  };

  await fsApi.mkdir(path.dirname(abs), { recursive: true });
  await fsApi.writeFile(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  return { ...payload, filePath: abs, created: true };
}

export async function runCommand(command, args = [], options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      timeout: ensurePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS),
      maxBuffer: options.maxBuffer || 50 * 1024 * 1024,
    });
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: 0,
      signal: null,
      timedOut: false,
      error: null,
    };
  } catch (err) {
    if (err && err.code === "ENOENT") throw err;
    return {
      stdout: err?.stdout || "",
      stderr: err?.stderr || "",
      exitCode: typeof err?.code === "number" ? err.code : null,
      signal: err?.signal || null,
      timedOut: /timed out/i.test(String(err?.message || "")),
      error: err?.message ? String(err.message) : String(err),
    };
  }
}

async function probeTool(tool, { cwd, env, runCommandFn }) {
  const args = TOOL_VERSION_ARGS[tool] || ["--version"];
  try {
    const result = await runCommandFn(tool, args, { cwd, env, timeoutMs: 5000, maxBuffer: 1024 * 1024 });
    const version = firstLine(result.stdout) || firstLine(result.stderr);
    return {
      name: tool,
      available: true,
      version,
      probeExitCode: result.exitCode,
      probeCommand: [tool, ...args],
      error: result.exitCode === 0 ? null : (result.error || firstLine(result.stderr)),
    };
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return {
        name: tool,
        available: false,
        version: null,
        probeExitCode: null,
        probeCommand: [tool, ...args],
        error: "Command not found.",
      };
    }
    return {
      name: tool,
      available: false,
      version: null,
      probeExitCode: null,
      probeCommand: [tool, ...args],
      error: err?.message ? String(err.message) : String(err),
    };
  }
}

export async function inspectTooling(toolNames, options = {}) {
  const names = unique(toolNames);
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const runCommandFn = options.runCommand || runCommand;
  const out = {};
  await Promise.all(names.map(async (tool) => {
    out[tool] = await probeTool(tool, { cwd, env, runCommandFn });
  }));
  return out;
}

async function readDiskUsage(targetPath, runCommandFn) {
  try {
    const result = await runCommandFn("df", ["-Pk", targetPath], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5000,
      maxBuffer: 1024 * 1024,
    });
    if (result.exitCode !== 0) return null;
    const lines = String(result.stdout || "").trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const cols = lines[1].trim().split(/\s+/);
    if (cols.length < 6) return null;
    const sizeKb = Number(cols[1]);
    const usedKb = Number(cols[2]);
    const availableKb = Number(cols[3]);
    const mountPoint = cols.at(-1) || null;
    return {
      targetPath,
      filesystem: cols[0] || null,
      sizeBytes: Number.isFinite(sizeKb) ? sizeKb * 1024 : null,
      usedBytes: Number.isFinite(usedKb) ? usedKb * 1024 : null,
      availableBytes: Number.isFinite(availableKb) ? availableKb * 1024 : null,
      sizeGiB: Number.isFinite(sizeKb) ? fmtNumber((sizeKb * 1024) / (1024 ** 3), 2) : null,
      availableGiB: Number.isFinite(availableKb) ? fmtNumber((availableKb * 1024) / (1024 ** 3), 2) : null,
      mountPoint,
    };
  } catch {
    return null;
  }
}

async function readGitValue(args, cwd, runCommandFn) {
  try {
    const result = await runCommandFn("git", args, {
      cwd,
      env: process.env,
      timeoutMs: 5000,
      maxBuffer: 1024 * 1024,
    });
    if (result.exitCode !== 0) return null;
    return String(result.stdout || "").trim() || null;
  } catch {
    return null;
  }
}

export async function collectMachineProfile(options = {}) {
  const cwd = options.cwd || process.cwd();
  const osApi = options.osApi || os;
  const runCommandFn = options.runCommand || runCommand;
  const cpuInfo = safeCall(() => osApi.cpus?.(), []);
  const cpus = Array.isArray(cpuInfo) ? cpuInfo : [];
  const logicalCores = safeCall(() => osApi.availableParallelism?.(), null) || cpus.length || null;
  const avgSpeed = cpus.length > 0
    ? fmtNumber(cpus.reduce((sum, cpu) => sum + (Number(cpu?.speed) || 0), 0) / cpus.length, 0)
    : null;
  const scratchTarget = path.resolve(cwd, options.scratchDir || ".bench/scratch");
  const disk = await readDiskUsage(scratchTarget, runCommandFn);
  const gitRevision = await readGitValue(["rev-parse", "HEAD"], cwd, runCommandFn);
  const gitBranch = await readGitValue(["rev-parse", "--abbrev-ref", "HEAD"], cwd, runCommandFn);
  const totalMem = safeCall(() => osApi.totalmem?.(), null);
  const loadAverage = safeCall(() => osApi.loadavg?.(), []);
  const uptimeSeconds = safeCall(() => osApi.uptime?.(), null);

  return {
    hostname: safeCall(() => osApi.hostname?.(), null) || null,
    platform: safeCall(() => osApi.platform?.(), null) || process.platform,
    release: safeCall(() => osApi.release?.(), null) || null,
    arch: safeCall(() => osApi.arch?.(), null) || process.arch,
    machine: safeCall(() => osApi.machine?.(), null) || null,
    version: safeCall(() => osApi.version?.(), null) || null,
    uptimeSeconds: typeof uptimeSeconds === "number" ? uptimeSeconds : null,
    loadAverage: Array.isArray(loadAverage) ? loadAverage.map((value) => fmtNumber(value, 2)) : [],
    cpu: {
      model: cpus[0]?.model || null,
      logicalCores,
      averageSpeedMHz: avgSpeed,
    },
    memory: {
      totalBytes: typeof totalMem === "number" ? totalMem : null,
      totalGiB: toGiB(typeof totalMem === "number" ? totalMem : null),
    },
    node: {
      version: process.version,
      v8: process.versions?.v8 || null,
      uv: process.versions?.uv || null,
    },
    repository: {
      root: cwd,
      gitRevision,
      gitBranch,
    },
    disk,
  };
}

function buildTemplateContext({ config, identity, machineProfile, env, cwd }) {
  const resultsDir = path.resolve(cwd, config.defaults.resultsDir);
  const scratchDir = path.resolve(cwd, config.defaults.scratchDir);
  const diskBenchmarkFile = path.resolve(cwd, config.defaults.diskBenchmarkFile);
  return {
    defaults: config.defaults,
    env,
    identity: {
      machineId: identity.machineId,
      createdAt: identity.createdAt,
    },
    machine: machineProfile,
    paths: {
      cwd,
      resultsDir,
      scratchDir,
      diskBenchmarkFile,
    },
  };
}

function evaluateSuiteStatus({ suite, resolvedCommand, resolvedPreflight, tooling, env }) {
  if (suite.disabled) {
    return { status: "disabled", reason: "Suite is disabled in config." };
  }

  const missingEnv = suite.requiresEnv.filter((name) => !hasValue(env?.[name]));
  const missingContext = unique([
    ...resolvedCommand.missing,
    ...(resolvedPreflight?.missing || []),
  ]);

  const preflightTool = suite.preflight?.tool || null;
  const missingTool = !tooling[suite.tool]?.available
    ? suite.tool
    : (preflightTool && !tooling[preflightTool]?.available ? preflightTool : null);

  if (missingTool) {
    return {
      status: "missing_dependency",
      reason: `${missingTool} is not available on this machine.`,
    };
  }

  if (missingEnv.length > 0 || missingContext.length > 0) {
    const names = unique([...missingEnv, ...missingContext]);
    return {
      status: "requires_configuration",
      reason: `Missing configuration: ${names.join(", ")}.`,
    };
  }

  return { status: "ready", reason: null };
}

function summarizePlanStatuses(suites) {
  const summary = {
    total: suites.length,
    ready: 0,
    optional: 0,
    disabled: 0,
    missingDependency: 0,
    requiresConfiguration: 0,
  };
  for (const suite of suites) {
    if (suite.optional) summary.optional++;
    if (suite.status === "ready") summary.ready++;
    else if (suite.status === "disabled") summary.disabled++;
    else if (suite.status === "missing_dependency") summary.missingDependency++;
    else if (suite.status === "requires_configuration") summary.requiresConfiguration++;
  }
  return summary;
}

export async function buildBenchmarkPlan({
  config,
  identity,
  machineProfile,
  cwd = process.cwd(),
  env = process.env,
  tooling = null,
  inspectToolingFn = inspectTooling,
}) {
  const templateContext = buildTemplateContext({ config, identity, machineProfile, env, cwd });
  const toolNames = unique(config.suites.flatMap((suite) => [suite.tool, suite.preflight?.tool]));
  const resolvedTooling = tooling || await inspectToolingFn(toolNames, { cwd, env });

  const suites = config.suites.map((suite) => {
    const resolvedCommand = resolveCommand(suite.command, templateContext);
    const resolvedPreflight = suite.preflight ? resolveCommand(suite.preflight.command, templateContext) : null;
    const statusInfo = evaluateSuiteStatus({
      suite,
      resolvedCommand,
      resolvedPreflight,
      tooling: resolvedTooling,
      env,
    });
    const requiredEnv = suite.requiresEnv.map((name) => ({
      name,
      configured: hasValue(env?.[name]),
      value: hasValue(env?.[name]) ? String(env[name]) : null,
    }));

    return {
      id: suite.id,
      title: suite.title,
      category: suite.category,
      standard: suite.standard,
      tool: suite.tool,
      parser: suite.parser,
      description: suite.description,
      notes: suite.notes,
      optional: suite.optional,
      expectedMetrics: suite.expectedMetrics,
      timeoutMs: suite.timeoutMs,
      status: statusInfo.status,
      reason: statusInfo.reason,
      requiredEnv,
      missingContext: unique([
        ...resolvedCommand.missing,
        ...(resolvedPreflight?.missing || []),
      ]),
      command: resolvedCommand.command,
      commandString: commandToString(resolvedCommand.command),
      preflight: suite.preflight ? {
        description: suite.preflight.description,
        tool: suite.preflight.tool,
        timeoutMs: suite.preflight.timeoutMs,
        command: resolvedPreflight.command,
        commandString: commandToString(resolvedPreflight.command),
      } : null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: "plan",
    config: {
      path: config.configPath,
      schemaVersion: config.schemaVersion,
      name: config.name,
      description: config.description,
      defaults: config.defaults,
    },
    machine: {
      id: identity.machineId,
      createdAt: identity.createdAt,
      identityFile: identity.filePath,
      hostSnapshot: identity.hostSnapshot,
      profile: machineProfile,
    },
    paths: templateContext.paths,
    tooling: resolvedTooling,
    summary: summarizePlanStatuses(suites),
    suites,
  };
}

function parseNumberFromMatch(regex, input) {
  const match = String(input || "").match(regex);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseSysbenchCpuOutput(output) {
  const text = String(output || "");
  return {
    events_per_second: parseNumberFromMatch(/events per second:\s+([0-9.]+)/i, text),
    total_time_seconds: parseNumberFromMatch(/total time:\s+([0-9.]+)s/i, text),
    total_events: parseNumberFromMatch(/total number of events:\s+([0-9.]+)/i, text),
    latency_ms_min: parseNumberFromMatch(/min:\s+([0-9.]+)/i, text),
    latency_ms_avg: parseNumberFromMatch(/avg:\s+([0-9.]+)/i, text),
    latency_ms_max: parseNumberFromMatch(/max:\s+([0-9.]+)/i, text),
    latency_ms_95: parseNumberFromMatch(/95th percentile:\s+([0-9.]+)/i, text),
  };
}

function parseSysbenchMemoryOutput(output) {
  const text = String(output || "");
  return {
    operations_per_second: parseNumberFromMatch(/Total operations:\s+\d+\s+\(([0-9.]+) per second\)/i, text),
    throughput_mib_per_second: parseNumberFromMatch(/MiB transferred \(([0-9.]+) MiB\/sec\)/i, text),
    total_time_seconds: parseNumberFromMatch(/total time:\s+([0-9.]+)s/i, text),
    total_events: parseNumberFromMatch(/total number of events:\s+([0-9.]+)/i, text),
    latency_ms_avg: parseNumberFromMatch(/avg:\s+([0-9.]+)/i, text),
    latency_ms_95: parseNumberFromMatch(/95th percentile:\s+([0-9.]+)/i, text),
  };
}

function aggregateMetric(values, selector, mode = "sum") {
  const picked = values
    .map(selector)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (picked.length === 0) return null;
  if (mode === "avg") return picked.reduce((sum, value) => sum + value, 0) / picked.length;
  return picked.reduce((sum, value) => sum + value, 0);
}

function parseJsonDocument(output) {
  const text = String(output || "").trim();
  if (!text) return {};
  if (text[0] === "{" || text[0] === "[") return JSON.parse(text);

  const jsonStart = text.search(/[\[{]/);
  if (jsonStart === -1) return JSON.parse(text);
  return JSON.parse(text.slice(jsonStart));
}

function parseFioJsonOutput(output) {
  const parsed = parseJsonDocument(output);
  const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
  return {
    read_bw_bytes_per_second: aggregateMetric(jobs, (job) => Number(job?.read?.bw_bytes || 0)),
    write_bw_bytes_per_second: aggregateMetric(jobs, (job) => Number(job?.write?.bw_bytes || 0)),
    read_iops: aggregateMetric(jobs, (job) => Number(job?.read?.iops || 0)),
    write_iops: aggregateMetric(jobs, (job) => Number(job?.write?.iops || 0)),
    read_clat_ns_mean: aggregateMetric(jobs, (job) => Number(job?.read?.clat_ns?.mean || 0), "avg"),
    write_clat_ns_mean: aggregateMetric(jobs, (job) => Number(job?.write?.clat_ns?.mean || 0), "avg"),
    job_count: jobs.length,
  };
}

function parseIperf3JsonOutput(output) {
  const parsed = parseJsonDocument(output);
  const protocol = parsed?.start?.test_start?.protocol || null;
  const sent = parsed?.end?.sum_sent || parsed?.end?.sum || null;
  const received = parsed?.end?.sum_received || parsed?.end?.sum || null;
  return {
    protocol,
    seconds: Number(parsed?.start?.test_start?.duration || 0) || null,
    sent_bits_per_second: Number(sent?.bits_per_second || 0) || null,
    received_bits_per_second: Number(received?.bits_per_second || 0) || null,
    retransmits: Number(sent?.retransmits || 0) || null,
  };
}

export function parseBenchmarkOutput(parser, stdout, stderr = "") {
  if (!parser) {
    return { metrics: {}, error: null };
  }

  try {
    if (parser === "sysbench_cpu") return { metrics: parseSysbenchCpuOutput(stdout), error: null };
    if (parser === "sysbench_memory") return { metrics: parseSysbenchMemoryOutput(stdout), error: null };
    if (parser === "fio_json") return { metrics: parseFioJsonOutput(stdout), error: null };
    if (parser === "iperf3_json") return { metrics: parseIperf3JsonOutput(stdout), error: null };
    return { metrics: {}, error: `Unknown parser "${parser}".` };
  } catch (err) {
    return {
      metrics: {},
      error: err?.message ? String(err.message) : firstLine(stderr) || String(err),
    };
  }
}

async function executeStep(step, { cwd, env, runCommandFn }) {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  try {
    const result = await runCommandFn(step.command[0], step.command.slice(1), {
      cwd,
      env,
      timeoutMs: step.timeoutMs,
    });
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: fmtNumber(performance.now() - t0, 2),
      ...result,
    };
  } catch (err) {
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: fmtNumber(performance.now() - t0, 2),
      stdout: err?.stdout || "",
      stderr: err?.stderr || "",
      exitCode: null,
      signal: null,
      timedOut: false,
      error: err?.message ? String(err.message) : String(err),
      missingCommand: err?.code === "ENOENT",
    };
  }
}

function summarizeExecution(suites) {
  const summary = {
    total: suites.length,
    executed: 0,
    passed: 0,
    warnings: 0,
    failed: 0,
    skipped: 0,
    timedOut: 0,
    parseErrors: 0,
  };
  for (const suite of suites) {
    const status = suite.execution?.status;
    if (!status || status === "skipped") {
      summary.skipped++;
      continue;
    }
    summary.executed++;
    if (status === "passed") summary.passed++;
    else if (status === "passed_with_parse_error") summary.warnings++;
    else summary.failed++;
    if (suite.execution?.timedOut) summary.timedOut++;
    if (suite.execution?.parseError) summary.parseErrors++;
  }
  return summary;
}

export async function executeBenchmarkPlan(plan, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const runCommandFn = options.runCommand || runCommand;

  await fs.mkdir(plan.paths.scratchDir, { recursive: true });
  await fs.mkdir(plan.paths.resultsDir, { recursive: true });

  const suites = [];
  for (const suite of plan.suites) {
    if (suite.status !== "ready") {
      suites.push({
        ...suite,
        execution: {
          status: "skipped",
          reason: suite.reason,
          timedOut: false,
          parseError: null,
          metrics: null,
        },
      });
      continue;
    }

    let preflight = null;
    if (suite.preflight) {
      preflight = await executeStep({
        command: suite.preflight.command,
        timeoutMs: suite.preflight.timeoutMs,
      }, { cwd, env, runCommandFn });
      if (preflight.exitCode !== 0) {
        suites.push({
          ...suite,
          execution: {
            status: "failed_preflight",
            reason: preflight.error || firstLine(preflight.stderr) || "Preflight command failed.",
            timedOut: Boolean(preflight.timedOut),
            parseError: null,
            metrics: null,
            preflight,
          },
        });
        continue;
      }
    }

    const result = await executeStep({
      command: suite.command,
      timeoutMs: suite.timeoutMs,
    }, { cwd, env, runCommandFn });

    const parsed = result.exitCode === 0
      ? parseBenchmarkOutput(suite.parser, result.stdout, result.stderr)
      : { metrics: null, error: null };

    const status = result.exitCode === 0
      ? (parsed.error ? "passed_with_parse_error" : "passed")
      : "failed";

    suites.push({
      ...suite,
      execution: {
        status,
        reason: result.exitCode === 0
          ? null
          : (result.error || firstLine(result.stderr) || "Benchmark command failed."),
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        parseError: parsed.error,
        metrics: parsed.metrics,
        stdout: result.stdout,
        stderr: result.stderr,
        preflight,
      },
    });
  }

  return {
    ...plan,
    generatedAt: new Date().toISOString(),
    mode: "run",
    planningSummary: plan.summary,
    summary: summarizeExecution(suites),
    suites,
  };
}

function formatMetricValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return fmtNumber(value, 2);
  if (value == null || value === "") return "-";
  return String(value);
}

function summarizeMetrics(metrics, expectedMetrics = []) {
  if (!metrics || typeof metrics !== "object") return "-";
  const keys = expectedMetrics.length > 0
    ? expectedMetrics.filter((key) => key in metrics)
    : Object.keys(metrics).slice(0, 4);
  if (keys.length === 0) return "-";
  return keys.map((key) => `${key}=${formatMetricValue(metrics[key])}`).join(", ");
}

export function markdownReport(payload) {
  const lines = [];
  const title = payload.mode === "run" ? "System Benchmark Report" : "System Benchmark Plan";
  const profile = payload.machine?.profile || {};
  const cpu = profile.cpu || {};
  const memory = profile.memory || {};
  const disk = profile.disk || {};

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- Generated: \`${payload.generatedAt}\``);
  lines.push(`- Machine UUID: \`${payload.machine?.id || "-"}\``);
  lines.push(`- Identity file: \`${payload.machine?.identityFile || "-"}\``);
  lines.push(`- Config: \`${payload.config?.path || payload.config?.name || "-"}\``);
  lines.push(`- Suites: \`${payload.suites?.length || 0}\``);
  if (payload.mode === "run") {
    lines.push(`- Executed: \`${payload.summary?.executed || 0}\``);
    lines.push(`- Passed cleanly: \`${payload.summary?.passed || 0}\``);
    lines.push(`- Warnings: \`${payload.summary?.warnings || 0}\``);
    lines.push(`- Failed: \`${payload.summary?.failed || 0}\``);
    lines.push(`- Parse errors: \`${payload.summary?.parseErrors || 0}\``);
  } else {
    lines.push(`- Ready: \`${payload.summary?.ready || 0}\``);
    lines.push(`- Missing dependencies: \`${payload.summary?.missingDependency || 0}\``);
    lines.push(`- Needs configuration: \`${payload.summary?.requiresConfiguration || 0}\``);
  }
  lines.push("");
  lines.push("## Machine Profile");
  lines.push("");
  lines.push("| Host | Platform | Arch | CPU | Cores | RAM GiB | Disk Free GiB | Git |");
  lines.push("|---|---|---|---|---:|---:|---:|---|");
  lines.push(`| ${profile.hostname || "-"} | ${profile.platform || "-"} ${profile.release || ""}`.trim() +
    ` | ${profile.arch || "-"} | ${cpu.model || "-"} | ${cpu.logicalCores || "-"} | ${memory.totalGiB || "-"} | ${disk.availableGiB || "-"} | ${profile.repository?.gitRevision || "-"} |`);
  lines.push("");
  lines.push("## Tooling");
  lines.push("");
  lines.push("| Tool | Available | Version | Probe |");
  lines.push("|---|---|---|---|");
  for (const tool of Object.keys(payload.tooling || {}).sort()) {
    const item = payload.tooling[tool];
    lines.push(`| ${tool} | ${item.available ? "yes" : "no"} | ${item.version || "-"} | \`${commandToString(item.probeCommand || [])}\` |`);
  }
  lines.push("");
  lines.push("## Suites");
  lines.push("");
  lines.push("| Suite | Category | Standard | Status | Metrics |");
  lines.push("|---|---|---|---|---|");
  for (const suite of payload.suites || []) {
    const status = payload.mode === "run" ? suite.execution?.status || suite.status : suite.status;
    const metrics = payload.mode === "run"
      ? summarizeMetrics(suite.execution?.metrics, suite.expectedMetrics)
      : suite.expectedMetrics.join(", ") || "-";
    lines.push(`| ${suite.id} | ${suite.category} | ${suite.standard} | ${status} | ${metrics} |`);
  }
  lines.push("");
  lines.push("## Suite Details");
  lines.push("");
  for (const suite of payload.suites || []) {
    lines.push(`### ${suite.title}`);
    lines.push("");
    if (suite.description) lines.push(suite.description);
    if (suite.notes) lines.push(`- Notes: ${suite.notes}`);
    lines.push(`- Status: \`${payload.mode === "run" ? suite.execution?.status || suite.status : suite.status}\``);
    lines.push(`- Tool: \`${suite.tool}\``);
    lines.push(`- Command: \`${suite.commandString}\``);
    if (suite.preflight?.commandString) lines.push(`- Preflight: \`${suite.preflight.commandString}\``);
    if (suite.reason) lines.push(`- Reason: ${suite.reason}`);
    if (suite.requiredEnv?.length > 0) {
      const envSummary = suite.requiredEnv
        .map((item) => `${item.name}=${item.configured ? item.value : "<missing>"}`)
        .join(", ");
      lines.push(`- Required env: ${envSummary}`);
    }
    if (suite.expectedMetrics?.length > 0) {
      lines.push(`- Expected metrics: ${suite.expectedMetrics.join(", ")}`);
    }
    if (payload.mode === "run" && suite.execution) {
      lines.push(`- Duration ms: ${suite.execution.durationMs ?? "-"}`);
      if (suite.execution.reason) lines.push(`- Execution note: ${suite.execution.reason}`);
      if (suite.execution.metrics) {
        lines.push(`- Metrics: ${summarizeMetrics(suite.execution.metrics, suite.expectedMetrics)}`);
      }
      if (suite.execution.parseError) {
        lines.push(`- Parse error: ${suite.execution.parseError}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export async function writeFileSafe(filePath, content, fsApi = fs) {
  const abs = path.resolve(process.cwd(), filePath);
  await fsApi.mkdir(path.dirname(abs), { recursive: true });
  await fsApi.writeFile(abs, content, "utf-8");
  return abs;
}
