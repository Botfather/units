#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { parseUnits } from "../packages/units/units-parser.js";
import { formatUnits } from "../packages/units/units-print.js";
import { createUnitsRenderer } from "../packages/units/units-custom-renderer.js";
import { findChangedRange, incrementalParse } from "../packages/units/incremental.js";
import unitsPlugin from "../packages/vite-plugin-units/index.js";
import unitsToolsPlugin from "../packages/vite-plugin-units-tools/index.js";

const DEFAULT_CONFIG = "bench/dsl-bench.config.json";
const DEFAULT_OUT = "bench/results/dsl-bench.json";
const DEFAULT_REPORT = "bench/results/dsl-bench.md";

const DEFAULT_SETTINGS = {
  parse: { warmup: 25, minSamples: 120, maxSamples: 4000, targetMs: 250 },
  format: { warmup: 12, minSamples: 60, maxSamples: 1200, targetMs: 250 },
  render: { warmup: 12, minSamples: 50, maxSamples: 800, targetMs: 250 },
  edit: { warmup: 25, minSamples: 120, maxSamples: 3000, targetMs: 200 },
  corpus: { warmup: 3, minSamples: 8, maxSamples: 60, targetMs: 300 },
};

const QUICK_SETTINGS = {
  parse: { warmup: 10, minSamples: 40, maxSamples: 800, targetMs: 100 },
  format: { warmup: 6, minSamples: 20, maxSamples: 300, targetMs: 100 },
  render: { warmup: 6, minSamples: 16, maxSamples: 200, targetMs: 100 },
  edit: { warmup: 10, minSamples: 40, maxSamples: 500, targetMs: 100 },
  corpus: { warmup: 1, minSamples: 3, maxSamples: 12, targetMs: 120 },
};

export function parseArgs(argv) {
  const out = {
    config: DEFAULT_CONFIG,
    out: DEFAULT_OUT,
    report: DEFAULT_REPORT,
    quick: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (arg === "--config") out.config = String(argv[++i] || out.config);
    else if (arg === "--out") out.out = String(argv[++i] || out.out);
    else if (arg === "--report") out.report = String(argv[++i] || out.report);
    else if (arg === "--quick") out.quick = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function usage() {
  return `
Usage:
  node tools/dsl-bench.mjs [--config bench/dsl-bench.config.json]
                           [--out bench/results/dsl-bench.json]
                           [--report bench/results/dsl-bench.md]
                           [--quick]

Benchmarks:
  - parse throughput on curated DSL files
  - format / printer throughput and stability
  - custom renderer throughput with realistic scope sizes
  - edit-loop work via changed-range detection and incrementalParse()
  - corpus parse / format throughput over real .ui collections
`;
}

function fmtNumber(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarizeSamples(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const totalMs = sorted.reduce((sum, value) => sum + value, 0);
  const avgMs = sorted.length ? totalMs / sorted.length : null;
  return {
    samples: sorted.length,
    totalMs: fmtNumber(totalMs, 3),
    avgMs: fmtNumber(avgMs, 4),
    minMs: fmtNumber(sorted[0] ?? null, 4),
    p50Ms: fmtNumber(percentile(sorted, 50), 4),
    p95Ms: fmtNumber(percentile(sorted, 95), 4),
    maxMs: fmtNumber(sorted.at(-1) ?? null, 4),
    opsPerSecond: avgMs && avgMs > 0 ? fmtNumber(1000 / avgMs, 2) : null,
  };
}

function benchmark(fn, settings) {
  for (let i = 0; i < settings.warmup; i++) fn();
  const samples = [];
  let totalMs = 0;
  while (samples.length < settings.maxSamples) {
    const t0 = performance.now();
    fn();
    const ms = performance.now() - t0;
    samples.push(ms);
    totalMs += ms;
    if (samples.length >= settings.minSamples && totalMs >= settings.targetMs) break;
  }
  return summarizeSamples(samples);
}

async function writeFileSafe(filePath, content) {
  const abs = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  return abs;
}

export async function loadConfig(configPath) {
  const abs = path.resolve(process.cwd(), configPath);
  const raw = await fs.readFile(abs, "utf-8");
  const parsed = JSON.parse(raw);
  return {
    path: abs,
    schemaVersion: Number(parsed.schemaVersion || 1),
    name: String(parsed.name || "dsl-bench"),
    description: parsed.description ? String(parsed.description) : null,
    cases: Array.isArray(parsed.cases) ? parsed.cases : [],
    corpora: Array.isArray(parsed.corpora) ? parsed.corpora : [],
  };
}

async function walkUiFiles(entryPath, out = []) {
  const abs = path.resolve(process.cwd(), entryPath);
  const stat = await fs.stat(abs);
  if (stat.isFile()) {
    if (abs.endsWith(".ui")) out.push(abs);
    return out;
  }
  const entries = await fs.readdir(abs, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(abs, entry.name);
    if (entry.isDirectory()) await walkUiFiles(child, out);
    else if (entry.isFile() && entry.name.endsWith(".ui")) out.push(child);
  }
  return out;
}

function makeItems(count, mapper) {
  return Array.from({ length: count }, (_, index) => mapper(index));
}

function noop() {}

function makeScope(preset, size) {
  if (preset === "todo") {
    return {
      draft: "Review benchmark report",
      items: makeItems(size, (index) => ({
        id: `task-${index}`,
        title: `Task ${index + 1}`,
        done: index % 3 === 0,
      })),
      onDraft: noop,
      addTask: noop,
      toggleTask: noop,
      removeTask: noop,
    };
  }
  if (preset === "chat") {
    return {
      draft: "Ship it",
      messages: makeItems(size, (index) => ({
        id: `msg-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        author: index % 2 === 0 ? "Tushar" : "Units",
        text: `Message ${index + 1} in the thread`,
      })),
      onDraft: noop,
      sendMessage: noop,
    };
  }
  if (preset === "expression_heavy") {
    const cards = makeItems(size, (index) => ({
      id: `card-${index}`,
      title: `Card ${index + 1}`,
    }));
    const metrics = Object.fromEntries(cards.map((card, index) => [card.id, { score: (index * 7) % 100 }]));
    const permissions = Object.fromEntries(cards.map((card, index) => [card.id, index % 9 !== 0]));
    return {
      layout: { columns: 4, gap: 12 },
      filters: { enabled: true, mode: "smart" },
      cards,
      metrics,
      permissions,
      routes: { detail: "/detail" },
      openCard: noop,
    };
  }
  if (preset === "gallery") {
    return {
      userInitial: "TM",
      user: { name: "Tushar Mohan", role: "Builder", location: "Bengaluru" },
      email: "tushar@example.com",
      notifications: true,
      progress: 72,
      stats: makeItems(size, (index) => ({
        label: `Metric ${index + 1}`,
        value: `${(index + 1) * 10}`,
        trend: index % 2 === 0 ? "+12%" : "-3%",
      })),
    };
  }
  return {};
}

function makeEditedSource(source) {
  const text = String(source || "");
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace === -1) return `${text}\ntext 'edited'\n`;
  return `${text.slice(0, lastBrace)}  text 'edited'\n${text.slice(lastBrace)}`;
}

function analyzeAst(ast) {
  const stats = {
    nodes: 0,
    tags: 0,
    directives: 0,
    texts: 0,
    exprs: 0,
    props: 0,
    events: 0,
    boolProps: 0,
    valueProps: 0,
    exprProps: 0,
  };

  function visit(node) {
    if (!node) return;
    stats.nodes++;
    if (node.type === "tag") {
      stats.tags++;
      for (const prop of node.props || []) {
        stats.props++;
        if (prop.kind === "event") stats.events++;
        else if (prop.kind === "bool") stats.boolProps++;
        else if (prop.kind === "value") stats.valueProps++;
        else if (prop.kind === "expr") stats.exprProps++;
      }
      for (const child of node.children || []) visit(child);
      return;
    }
    if (node.type === "directive") {
      stats.directives++;
      for (const child of node.children || []) visit(child);
      return;
    }
    if (node.type === "text") {
      stats.texts++;
      return;
    }
    if (node.type === "expr") {
      stats.exprs++;
      return;
    }
    if (node.type === "document") {
      for (const child of node.body || []) visit(child);
    }
  }

  visit(ast);
  return stats;
}

function createBenchmarkRenderer() {
  const host = {
    element: (name, props, events, children) => ({ type: "element", name, props, events, children }),
    text: (value) => ({ type: "text", value }),
    fragment: (children) => ({ type: "fragment", children }),
  };
  return createUnitsRenderer(host);
}

function createPluginHarness() {
  const units = unitsPlugin();
  const tools = unitsToolsPlugin();
  return {
    astLoad: (id) => units.load(id),
    formatLoad: (id) => tools.load(`${id}?format`),
    tokensLoad: (id) => tools.load(`${id}?tokens`),
    highlightLoad: (id) => tools.load(`${id}?highlight`),
  };
}

function countRenderedNodes(node) {
  if (node == null) return 0;
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + countRenderedNodes(child), 0);
  if (typeof node !== "object") return 1;
  if (node.type === "text") return 1;
  if (node.type === "fragment") return 1 + countRenderedNodes(node.children || []);
  if (node.type === "element") return 1 + countRenderedNodes(node.children || []);
  return 1;
}

async function benchmarkCase(caseConfig, settings) {
  const abs = path.resolve(process.cwd(), caseConfig.file);
  const source = await fs.readFile(abs, "utf-8");
  const parsed = parseUnits(source);
  const formatted = formatUnits(source);
  const reparsedFormatted = formatUnits(formatted);
  const astStats = analyzeAst(parsed);
  const editedSource = makeEditedSource(source);
  const renderer = createBenchmarkRenderer();
  const pluginHarness = createPluginHarness();

  const parseMetrics = benchmark(() => parseUnits(source), settings.parse);
  const formatMetrics = benchmark(() => formatUnits(source), settings.format);
  const changeRangeMetrics = benchmark(() => findChangedRange(source, editedSource), settings.edit);
  const incrementalMetrics = benchmark(() => incrementalParse(parsed, source, editedSource), settings.edit);

  const renderScenarios = [];
  for (const scenario of caseConfig.renderScenarios || []) {
    const scope = makeScope(caseConfig.scopePreset, Number(scenario.size || 0));
    const rendered = renderer.render(parsed, scope, { set: noop });
    const renderMetrics = benchmark(() => renderer.render(parsed, scope, { set: noop }), settings.render);
    renderScenarios.push({
      id: String(scenario.id),
      size: Number(scenario.size || 0),
      outputNodeCount: countRenderedNodes(rendered),
      metrics: renderMetrics,
    });
  }

  const pluginOutputs = {
    ast: String(pluginHarness.astLoad(abs) || ""),
    format: String(pluginHarness.formatLoad(abs) || ""),
    tokens: String(pluginHarness.tokensLoad(abs) || ""),
    highlight: String(pluginHarness.highlightLoad(abs) || ""),
  };
  const plugins = {
    astLoad: {
      outputBytes: Buffer.byteLength(pluginOutputs.ast),
      metrics: benchmark(() => pluginHarness.astLoad(abs), settings.format),
    },
    formatLoad: {
      outputBytes: Buffer.byteLength(pluginOutputs.format),
      metrics: benchmark(() => pluginHarness.formatLoad(abs), settings.format),
    },
    tokensLoad: {
      outputBytes: Buffer.byteLength(pluginOutputs.tokens),
      metrics: benchmark(() => pluginHarness.tokensLoad(abs), settings.format),
    },
    highlightLoad: {
      outputBytes: Buffer.byteLength(pluginOutputs.highlight),
      metrics: benchmark(() => pluginHarness.highlightLoad(abs), settings.format),
    },
  };

  return {
    id: String(caseConfig.id),
    title: String(caseConfig.title || caseConfig.id),
    file: abs,
    scopePreset: String(caseConfig.scopePreset || ""),
    input: {
      chars: source.length,
      lines: source.split(/\r?\n/).length,
      ...astStats,
    },
    quality: {
      formatStable: formatted === reparsedFormatted,
      formattedChars: formatted.length,
    },
    parse: parseMetrics,
    format: formatMetrics,
    editLoop: {
      changedRange: changeRangeMetrics,
      incrementalParse: incrementalMetrics,
      editDeltaChars: editedSource.length - source.length,
    },
    plugins,
    renderScenarios,
  };
}

async function benchmarkCorpus(corpusConfig, settings, quick) {
  const discovered = [];
  for (const entry of corpusConfig.paths || []) {
    await walkUiFiles(entry, discovered);
  }
  discovered.sort();
  const limited = corpusConfig.limit ? discovered.slice(0, corpusConfig.limit) : discovered;
  const files = quick && limited.length > 50 ? limited.slice(0, 50) : limited;
  const sources = await Promise.all(files.map((file) => fs.readFile(file, "utf-8")));
  const parsedDocs = sources.map((source) => parseUnits(source));
  const totals = parsedDocs.reduce((acc, ast, index) => {
    const stats = analyzeAst(ast);
    acc.files++;
    acc.chars += sources[index].length;
    acc.lines += sources[index].split(/\r?\n/).length;
    acc.nodes += stats.nodes;
    acc.tags += stats.tags;
    acc.directives += stats.directives;
    acc.props += stats.props;
    return acc;
  }, { files: 0, chars: 0, lines: 0, nodes: 0, tags: 0, directives: 0, props: 0 });

  const parseMetrics = benchmark(() => {
    for (const source of sources) parseUnits(source);
  }, settings.corpus);

  const formatMetrics = benchmark(() => {
    for (const source of sources) formatUnits(source);
  }, settings.corpus);

  return {
    id: String(corpusConfig.id),
    title: String(corpusConfig.title || corpusConfig.id),
    fileCount: files.length,
    totals,
    parse: parseMetrics,
    format: formatMetrics,
  };
}

function formatMetric(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

export function markdownReport(payload) {
  const lines = [];
  lines.push("# DSL Benchmark Report");
  lines.push("");
  lines.push(`- Generated: \`${payload.generatedAt}\``);
  lines.push(`- Config: \`${payload.config.path}\``);
  lines.push(`- Mode: \`${payload.mode}\``);
  lines.push(`- Node: \`${payload.machine.nodeVersion}\``);
  lines.push(`- Platform: \`${payload.machine.platform} ${payload.machine.arch}\``);
  lines.push(`- Cases: \`${payload.summary.caseCount}\``);
  lines.push(`- Corpora: \`${payload.summary.corpusCount}\``);
  lines.push("");
  lines.push("## Curated Cases");
  lines.push("");
  lines.push("| Case | Chars | Nodes | Parse Avg ms | Format Avg ms | Edit Avg ms | Render Scenarios |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const item of payload.cases) {
    const renderSummary = item.renderScenarios
      .map((scenario) => `${scenario.id}:${formatMetric(scenario.metrics.avgMs, 3)}ms`)
      .join(", ");
    lines.push(`| ${item.id} | ${item.input.chars} | ${item.input.nodes} | ${formatMetric(item.parse.avgMs, 4)} | ${formatMetric(item.format.avgMs, 4)} | ${formatMetric(item.editLoop.incrementalParse.avgMs, 4)} | ${renderSummary} |`);
  }
  lines.push("");
  lines.push("## Corpus Throughput");
  lines.push("");
  lines.push("| Corpus | Files | Chars | Nodes | Parse Avg ms | Format Avg ms |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const item of payload.corpora) {
    lines.push(`| ${item.id} | ${item.fileCount} | ${item.totals.chars} | ${item.totals.nodes} | ${formatMetric(item.parse.avgMs, 3)} | ${formatMetric(item.format.avgMs, 3)} |`);
  }
  lines.push("");
  lines.push("## Render Scenarios");
  lines.push("");
  lines.push("| Case | Scenario | Data Size | Output Nodes | Avg ms | P95 ms | Ops/s |");
  lines.push("|---|---|---:|---:|---:|---:|---:|");
  for (const item of payload.cases) {
    for (const scenario of item.renderScenarios) {
      lines.push(`| ${item.id} | ${scenario.id} | ${scenario.size} | ${scenario.outputNodeCount} | ${formatMetric(scenario.metrics.avgMs, 4)} | ${formatMetric(scenario.metrics.p95Ms, 4)} | ${formatMetric(scenario.metrics.opsPerSecond, 2)} |`);
    }
  }
  lines.push("");
  lines.push("## Plugin / Compile Path");
  lines.push("");
  lines.push("| Case | AST Load ms | Format Load ms | Tokens Load ms | Highlight Load ms |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const item of payload.cases) {
    lines.push(`| ${item.id} | ${formatMetric(item.plugins.astLoad.metrics.avgMs, 4)} | ${formatMetric(item.plugins.formatLoad.metrics.avgMs, 4)} | ${formatMetric(item.plugins.tokensLoad.metrics.avgMs, 4)} | ${formatMetric(item.plugins.highlightLoad.metrics.avgMs, 4)} |`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- `parse` benchmarks isolate `parseUnits(source)`.");
  lines.push("- `format` benchmarks measure parser + printer cost via `formatUnits(source)`.");
  lines.push("- `render` benchmarks parse once, then measure custom-renderer tree construction with realistic scope data.");
  lines.push("- `edit` benchmarks include `findChangedRange()` and `incrementalParse()`, which now attempts append/subtree fast paths before full-parse fallback.");
  lines.push("- `plugin` benchmarks measure the synchronous load path used by the Vite plugins for AST, format, token, and highlight outputs.");
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const config = await loadConfig(args.config);
  const settings = args.quick ? QUICK_SETTINGS : DEFAULT_SETTINGS;
  const cases = [];
  for (const caseConfig of config.cases) {
    cases.push(await benchmarkCase(caseConfig, settings));
  }
  const corpora = [];
  for (const corpusConfig of config.corpora) {
    corpora.push(await benchmarkCorpus(corpusConfig, settings, args.quick));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: args.quick ? "quick" : "full",
    config: {
      path: config.path,
      schemaVersion: config.schemaVersion,
      name: config.name,
      description: config.description,
    },
    machine: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
    summary: {
      caseCount: cases.length,
      corpusCount: corpora.length,
    },
    cases,
    corpora,
  };

  const outPath = await writeFileSafe(args.out, `${JSON.stringify(payload, null, 2)}\n`);
  const reportPath = await writeFileSafe(args.report, markdownReport(payload));
  process.stdout.write(`Wrote ${outPath}\nWrote ${reportPath}\n`);
}

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryHref === import.meta.url) {
  main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
