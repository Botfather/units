#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { parseUnits } from "../packages/units/units-parser.js";
import { formatUnits } from "../packages/units/units-print.js";

const DEFAULT_CASES = "bench/llm-cases.json";
const DEFAULT_OUT = "bench/results/llm-bench.json";
const DEFAULT_REPORT = "bench/results/llm-bench.md";
const DEFAULT_MODELS = ["gpt-4.1-mini", "gpt-4o-mini"];
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_REPAIR_ATTEMPTS = 1;
const DEFAULT_LIVE_MIN_PARSE_OK_PCT = 90;
const DEFAULT_LIVE_MIN_REQUIRED_PCT = 80;

const DEFAULT_SYSTEM_PROMPT = [
  "You are editing a Units .ui file.",
  "Return only valid Units DSL. Never output XML/HTML/JSX/Lisp/JSON/markdown.",
  "Use Units grammar only: Tag (props) { children }, directives #if/#for/#slot/#key, text '...'.",
  "Always use parentheses for props and comma-separated props.",
  "Use single quotes.",
  "Always key loops with #key.",
  "Use explicit event handlers: !event { handler(@event) }.",
  "Do not wrap output in code fences and do not add explanation.",
  "Example:",
  "App {",
  "  #if (@items.length == 0) {",
  "    text 'Nothing here yet.'",
  "  }",
  "}",
  "",
  "Before finalizing, self-check that output parses as Units DSL and includes required structures from the request.",
  "Return only valid Units DSL; no markdown fences or explanation.",
].join("\n");

function parseArgs(argv) {
  const out = {
    mode: "offline",
    cases: DEFAULT_CASES,
    out: DEFAULT_OUT,
    report: DEFAULT_REPORT,
    runs: 1,
    models: [...DEFAULT_MODELS],
    baseUrl: process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    temperature: 0,
    maxOutputTokens: 1200,
    repairAttempts: DEFAULT_REPAIR_ATTEMPTS,
    qualityGate: null,
    minParseOkPct: null,
    minRequiredPassPct: null,
    minExactMatchPct: null,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode") out.mode = String(argv[++i] || out.mode);
    else if (arg === "--cases") out.cases = String(argv[++i] || out.cases);
    else if (arg === "--out") out.out = String(argv[++i] || out.out);
    else if (arg === "--report") out.report = String(argv[++i] || out.report);
    else if (arg === "--runs") out.runs = Math.max(1, Number(argv[++i] || out.runs));
    else if (arg === "--models") {
      out.models = String(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--base-url") out.baseUrl = String(argv[++i] || out.baseUrl);
    else if (arg === "--temperature") out.temperature = Number(argv[++i] || out.temperature);
    else if (arg === "--max-output-tokens") out.maxOutputTokens = Math.max(1, Number(argv[++i] || out.maxOutputTokens));
    else if (arg === "--repair-attempts") out.repairAttempts = Math.max(0, Number(argv[++i] || out.repairAttempts));
    else if (arg === "--quality-gate") out.qualityGate = true;
    else if (arg === "--no-quality-gate") out.qualityGate = false;
    else if (arg === "--min-parse-ok-pct") out.minParseOkPct = Number(argv[++i] || out.minParseOkPct);
    else if (arg === "--min-required-pct") out.minRequiredPassPct = Number(argv[++i] || out.minRequiredPassPct);
    else if (arg === "--min-exact-pct") out.minExactMatchPct = Number(argv[++i] || out.minExactMatchPct);
    else if (arg === "--system-prompt-file") out.systemPromptFile = String(argv[++i] || "");
    else if (arg === "--help" || arg === "-h") {
      out.help = true;
    }
  }
  return out;
}

function usage() {
  return `
Usage:
  node tools/llm-bench.mjs [--mode offline|live] [--cases bench/llm-cases.json]
                           [--models gpt-4.1-mini,gpt-4o-mini] [--runs 1]
                           [--out bench/results/llm-bench.json]
                           [--report bench/results/llm-bench.md]

Modes:
  offline  Analyze reference DSL + estimate token usage.
  live     Query OpenAI models and record real usage tokens + quality checks.

Live mode env:
  OPENAI_API_KEY=...
Optional:
  OPENAI_BASE_URL=https://api.openai.com/v1

Live quality options:
  --repair-attempts 1
  --quality-gate / --no-quality-gate
  --min-parse-ok-pct 90
  --min-required-pct 80
  --min-exact-pct 70
`;
}

function estimateTokens(text) {
  const src = String(text || "");
  if (!src) return 0;
  const rough = Math.ceil(src.length / 4);
  const chunks = src.match(/[A-Za-z0-9_]+|[^\s]/g) || [];
  return Math.ceil((rough + chunks.length) / 2);
}

function stripFence(value) {
  const src = String(value || "").trim();
  const m = src.match(/^```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)\n```$/);
  if (m) return m[1].trim();
  return src;
}

function countAstStats(ast) {
  let nodes = 0;
  let depthMax = 0;
  const typeCounts = { tag: 0, text: 0, expr: 0, directive: 0 };
  function walk(node, depth) {
    if (!node || typeof node !== "object") return;
    if (node.type && node.type !== "document") {
      nodes++;
      depthMax = Math.max(depthMax, depth);
      if (typeCounts[node.type] != null) typeCounts[node.type]++;
    }
    const children = [];
    if (Array.isArray(node.body)) children.push(...node.body);
    if (Array.isArray(node.children)) children.push(...node.children);
    for (const child of children) walk(child, depth + 1);
  }
  walk(ast, 0);
  return { nodes, depthMax, typeCounts };
}

function analyzeSource(source, requiredSnippets = []) {
  const src = String(source || "");
  const chars = src.length;
  const estimatedTokens = estimateTokens(src);
  const required = Array.isArray(requiredSnippets) ? requiredSnippets : [];
  const requiredMatched = required.filter((snippet) => src.includes(String(snippet)));
  const requiredPass = requiredMatched.length === required.length;
  let parseOk = false;
  let parseError = null;
  let parseMs = null;
  let formatStable = null;
  let normalized = null;
  let astStats = { nodes: 0, depthMax: 0, typeCounts: { tag: 0, text: 0, expr: 0, directive: 0 } };
  const t0 = performance.now();
  try {
    const ast = parseUnits(src);
    parseMs = performance.now() - t0;
    parseOk = true;
    astStats = countAstStats(ast);
    normalized = formatUnits(src);
    formatStable = normalized.trimEnd() === src.trimEnd();
  } catch (err) {
    parseMs = performance.now() - t0;
    parseError = err && err.message ? String(err.message) : String(err);
  }
  return {
    chars,
    estimatedTokens,
    parseOk,
    parseError,
    parseMs,
    formatStable,
    normalized,
    requiredTotal: required.length,
    requiredMatchedCount: requiredMatched.length,
    requiredPass,
    astNodes: astStats.nodes,
    astDepthMax: astStats.depthMax,
    astTypeCounts: astStats.typeCounts,
  };
}

function extractResponseText(payload) {
  if (payload && typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }
  const parts = [];
  for (const item of payload?.output || []) {
    for (const c of item?.content || []) {
      if (typeof c?.text === "string") parts.push(c.text);
      else if (typeof c?.value === "string") parts.push(c.value);
    }
  }
  return parts.join("\n").trim();
}

async function callOpenAI({
  apiKey,
  baseUrl,
  model,
  systemPrompt,
  userPrompt,
  temperature,
  maxOutputTokens,
}) {
  const endpoint = `${String(baseUrl).replace(/\/$/, "")}/responses`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      max_output_tokens: maxOutputTokens,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
        { role: "user", content: [{ type: "input_text", text: userPrompt }] },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const json = await response.json();
  const usage = json?.usage || {};
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? null;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? null;
  const totalTokens = usage.total_tokens ?? (
    typeof inputTokens === "number" && typeof outputTokens === "number"
      ? inputTokens + outputTokens
      : null
  );
  return {
    raw: json,
    text: extractResponseText(json),
    usage: { inputTokens, outputTokens, totalTokens },
  };
}

async function loadCases(casesPath) {
  const abs = path.resolve(process.cwd(), casesPath);
  const raw = await fs.readFile(abs, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`Expected an array in ${abs}`);
  const baseDir = path.dirname(abs);
  const out = [];

  for (const item of parsed) {
    const one = { ...item };
    if (!one.id) throw new Error("Each case must include `id`.");
    if (!one.prompt) throw new Error(`Case ${one.id} is missing \`prompt\`.`);

    if (!one.expectedDsl && one.expectedDslFile) {
      const file = path.resolve(baseDir, one.expectedDslFile);
      one.expectedDsl = await fs.readFile(file, "utf-8");
    }

    const baselines = {};
    if (one.baselines && typeof one.baselines === "object") {
      Object.assign(baselines, one.baselines);
    }
    if (one.baselineFiles && typeof one.baselineFiles === "object") {
      for (const [name, relPath] of Object.entries(one.baselineFiles)) {
        const file = path.resolve(baseDir, relPath);
        baselines[name] = await fs.readFile(file, "utf-8");
      }
    }
    one.baselines = baselines;
    delete one.baselineFiles;

    out.push(one);
  }
  return out;
}

function makeCompressionRows(cases) {
  const rows = [];
  for (const item of cases) {
    if (!item.expectedDsl) continue;
    const dslTokens = estimateTokens(item.expectedDsl);
    for (const [name, baseline] of Object.entries(item.baselines || {})) {
      const baselineTokens = estimateTokens(String(baseline || ""));
      if (!baselineTokens) continue;
      const ratio = dslTokens / baselineTokens;
      rows.push({
        caseId: item.id,
        baseline: name,
        dslTokens,
        baselineTokens,
        ratio,
        savingsPct: (1 - ratio) * 100,
      });
    }
  }
  return rows;
}

function avg(values) {
  const valid = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function pct(numerator, denominator) {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

function summarizeByModel(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.model)) map.set(r.model, []);
    map.get(r.model).push(r);
  }
  const rows = [];
  for (const [model, items] of map.entries()) {
    const parseOkCount = items.filter((r) => r.analysis.parseOk).length;
    const reqEligible = items.filter((r) => r.analysis.requiredTotal > 0);
    const reqPassCount = reqEligible.filter((r) => r.analysis.requiredPass).length;
    const exactEligible = items.filter((r) => r.exactMatch !== null);
    const exactPassCount = exactEligible.filter((r) => r.exactMatch === true).length;
    rows.push({
      model,
      samples: items.length,
      parseOkPct: pct(parseOkCount, items.length),
      requiredPassPct: pct(reqPassCount, reqEligible.length),
      exactMatchPct: pct(exactPassCount, exactEligible.length),
      avgInputTokens: avg(items.map((r) => r.tokens.input)),
      avgOutputTokens: avg(items.map((r) => r.tokens.output)),
      avgTotalTokens: avg(items.map((r) => r.tokens.total)),
      avgParseMs: avg(items.map((r) => r.analysis.parseMs)),
    });
  }
  rows.sort((a, b) => (b.parseOkPct || 0) - (a.parseOkPct || 0));
  return rows;
}

function clampPct(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function usageFromResponse(responseUsage, promptText, generated) {
  const input = typeof responseUsage?.inputTokens === "number"
    ? responseUsage.inputTokens
    : estimateTokens(promptText);
  const output = typeof responseUsage?.outputTokens === "number"
    ? responseUsage.outputTokens
    : estimateTokens(generated);
  const total = typeof responseUsage?.totalTokens === "number"
    ? responseUsage.totalTokens
    : input + output;
  return {
    input,
    output,
    total,
    source: (
      typeof responseUsage?.inputTokens === "number" || typeof responseUsage?.outputTokens === "number"
    ) ? "provider_usage" : "estimated",
  };
}

function mergeUsage(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    input: (a.input || 0) + (b.input || 0),
    output: (a.output || 0) + (b.output || 0),
    total: (a.total || 0) + (b.total || 0),
    source: a.source === b.source ? a.source : "mixed",
  };
}

function buildRepairPrompt({ prompt, generated, parseError, requiredSnippets }) {
  const required = Array.isArray(requiredSnippets) && requiredSnippets.length > 0
    ? requiredSnippets.map((snippet) => `- ${snippet}`).join("\n")
    : "- (none)";
  return [
    "Your previous answer was invalid or incomplete Units DSL.",
    `Original task: ${prompt}`,
    `Parser error: ${parseError || "(none)"} `,
    "Required snippets to include:",
    required,
    "",
    "Fix and return only valid Units DSL.",
    "Do not output any explanation.",
    "Previous output:",
    generated,
  ].join("\n");
}

function evaluateQualityGate(summaries, thresholds) {
  const violations = [];
  for (const summary of summaries) {
    if (thresholds.minParseOkPct != null && summary.parseOkPct != null && summary.parseOkPct < thresholds.minParseOkPct) {
      violations.push({
        model: summary.model,
        metric: "parseOkPct",
        value: summary.parseOkPct,
        min: thresholds.minParseOkPct,
      });
    }
    if (thresholds.minRequiredPassPct != null && summary.requiredPassPct != null && summary.requiredPassPct < thresholds.minRequiredPassPct) {
      violations.push({
        model: summary.model,
        metric: "requiredPassPct",
        value: summary.requiredPassPct,
        min: thresholds.minRequiredPassPct,
      });
    }
    if (thresholds.minExactMatchPct != null && summary.exactMatchPct != null && summary.exactMatchPct < thresholds.minExactMatchPct) {
      violations.push({
        model: summary.model,
        metric: "exactMatchPct",
        value: summary.exactMatchPct,
        min: thresholds.minExactMatchPct,
      });
    }
  }
  return violations;
}

function fmt(n, digits = 2) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

function markdownReport({ config, summaries, compression, records, qualityGate }) {
  const lines = [];
  lines.push("# LLM Benchmark Report");
  lines.push("");
  lines.push(`- Mode: \`${config.mode}\``);
  lines.push(`- Generated: \`${config.generatedAt}\``);
  lines.push(`- Cases: \`${config.caseCount}\``);
  lines.push(`- Runs per model/case: \`${config.runs}\``);
  lines.push(`- Models: \`${config.models.join(", ")}\``);
  lines.push("");
  lines.push("## Model Summary");
  lines.push("");
  lines.push("| Model | Samples | Parse OK % | Required % | Exact % | Avg Input Tok | Avg Output Tok | Avg Total Tok | Avg Parse ms |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const s of summaries) {
    lines.push(`| ${s.model} | ${s.samples} | ${fmt(s.parseOkPct)} | ${fmt(s.requiredPassPct)} | ${fmt(s.exactMatchPct)} | ${fmt(s.avgInputTokens)} | ${fmt(s.avgOutputTokens)} | ${fmt(s.avgTotalTokens)} | ${fmt(s.avgParseMs, 3)} |`);
  }
  lines.push("");
  if (config.mode === "live" && qualityGate?.enabled) {
    lines.push("## Quality Gate");
    lines.push("");
    lines.push(`- Parse OK minimum %: \`${qualityGate.thresholds.minParseOkPct ?? "-"}\``);
    lines.push(`- Required minimum %: \`${qualityGate.thresholds.minRequiredPassPct ?? "-"}\``);
    lines.push(`- Exact minimum %: \`${qualityGate.thresholds.minExactMatchPct ?? "-"}\``);
    lines.push(`- Status: \`${qualityGate.violations.length === 0 ? "pass" : "fail"}\``);
    if (qualityGate.violations.length > 0) {
      lines.push("");
      lines.push("| Model | Metric | Value % | Minimum % |");
      lines.push("|---|---|---:|---:|");
      for (const v of qualityGate.violations) {
        lines.push(`| ${v.model} | ${v.metric} | ${fmt(v.value)} | ${fmt(v.min)} |`);
      }
    }
    lines.push("");
  }
  if (compression.length > 0) {
    lines.push("## Estimated DSL Compression");
    lines.push("");
    lines.push("| Case | Baseline | DSL Tok | Baseline Tok | DSL/Baseline | Savings % |");
    lines.push("|---|---|---:|---:|---:|---:|");
    for (const row of compression) {
      lines.push(`| ${row.caseId} | ${row.baseline} | ${row.dslTokens} | ${row.baselineTokens} | ${fmt(row.ratio, 3)} | ${fmt(row.savingsPct)} |`);
    }
    lines.push("");
  }
  const parseFailures = records.filter((r) => !r.analysis.parseOk);
  if (parseFailures.length > 0) {
    lines.push("## Parse Failures");
    lines.push("");
    for (const fail of parseFailures.slice(0, 20)) {
      lines.push(`- \`${fail.model}\` / \`${fail.caseId}\` / run ${fail.run}: ${fail.analysis.parseError}`);
    }
    lines.push("");
  }
  lines.push("## Notes");
  lines.push("");
  lines.push("- Offline mode uses estimated tokens only.");
  lines.push("- Live mode prefers provider usage fields (`input_tokens`, `output_tokens`).");
  return lines.join("\n") + "\n";
}

async function writeFileSafe(filePath, content) {
  const abs = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  return abs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  if (!["offline", "live"].includes(args.mode)) {
    throw new Error(`Invalid --mode "${args.mode}". Use "offline" or "live".`);
  }
  if (!Array.isArray(args.models) || args.models.length === 0) {
    throw new Error("Pass at least one model via --models.");
  }
  args.repairAttempts = Math.max(0, Number.isFinite(args.repairAttempts) ? Math.floor(args.repairAttempts) : DEFAULT_REPAIR_ATTEMPTS);

  if (args.systemPromptFile) {
    args.systemPrompt = await fs.readFile(path.resolve(process.cwd(), args.systemPromptFile), "utf-8");
  }

  const qualityGateEnabled = args.qualityGate == null ? args.mode === "live" : Boolean(args.qualityGate);
  const qualityThresholds = {
    minParseOkPct: clampPct(args.minParseOkPct ?? (qualityGateEnabled && args.mode === "live" ? DEFAULT_LIVE_MIN_PARSE_OK_PCT : null)),
    minRequiredPassPct: clampPct(args.minRequiredPassPct ?? (qualityGateEnabled && args.mode === "live" ? DEFAULT_LIVE_MIN_REQUIRED_PCT : null)),
    minExactMatchPct: clampPct(args.minExactMatchPct),
  };

  const cases = await loadCases(args.cases);
  const records = [];
  const apiKey = process.env.OPENAI_API_KEY || null;

  if (args.mode === "live" && !apiKey) {
    throw new Error("OPENAI_API_KEY is required for --mode live.");
  }

  for (const model of args.models) {
    for (const oneCase of cases) {
      for (let run = 1; run <= args.runs; run++) {
        const promptText = `${args.systemPrompt}\n\n${oneCase.prompt}`;
        let generated = oneCase.expectedDsl || "";
        let usageTokens = {
          input: estimateTokens(promptText),
          output: estimateTokens(generated),
          total: estimateTokens(promptText) + estimateTokens(generated),
          source: "estimated",
        };
        let rawResponse = null;
        let analysis = null;
        const repairLog = [];

        if (args.mode === "live") {
          const response = await callOpenAI({
            apiKey,
            baseUrl: args.baseUrl,
            model,
            systemPrompt: args.systemPrompt,
            userPrompt: oneCase.prompt,
            temperature: args.temperature,
            maxOutputTokens: args.maxOutputTokens,
          });
          rawResponse = response.raw;
          generated = stripFence(response.text);
          usageTokens = usageFromResponse(response.usage, promptText, generated);
          analysis = analyzeSource(generated, oneCase.requiredSnippets || []);

          for (let attempt = 1; attempt <= args.repairAttempts; attempt++) {
            if (analysis.parseOk && analysis.requiredPass) break;
            const repairPrompt = buildRepairPrompt({
              prompt: oneCase.prompt,
              generated,
              parseError: analysis.parseError,
              requiredSnippets: oneCase.requiredSnippets || [],
            });
            const repairResponse = await callOpenAI({
              apiKey,
              baseUrl: args.baseUrl,
              model,
              systemPrompt: args.systemPrompt,
              userPrompt: repairPrompt,
              temperature: args.temperature,
              maxOutputTokens: args.maxOutputTokens,
            });
            rawResponse = repairResponse.raw;
            generated = stripFence(repairResponse.text);
            usageTokens = mergeUsage(
              usageTokens,
              usageFromResponse(repairResponse.usage, `${args.systemPrompt}\n\n${repairPrompt}`, generated),
            );
            analysis = analyzeSource(generated, oneCase.requiredSnippets || []);
            repairLog.push({
              attempt,
              parseOk: analysis.parseOk,
              requiredPass: analysis.requiredPass,
              parseError: analysis.parseError,
            });
          }
        }

        if (!analysis) analysis = analyzeSource(generated, oneCase.requiredSnippets || []);
        let exactMatch = null;
        if (oneCase.expectedDsl && analysis.parseOk) {
          try {
            exactMatch = formatUnits(generated).trimEnd() === formatUnits(oneCase.expectedDsl).trimEnd();
          } catch {
            exactMatch = false;
          }
        }

        records.push({
          model,
          run,
          caseId: oneCase.id,
          mode: args.mode,
          tokens: usageTokens,
          analysis,
          exactMatch,
          prompt: oneCase.prompt,
          output: generated,
          rawResponse,
          repairLog,
        });
      }
    }
  }

  const compression = makeCompressionRows(cases);
  const summaries = summarizeByModel(records);
  const qualityViolations = qualityGateEnabled
    ? evaluateQualityGate(summaries, qualityThresholds)
    : [];
  const qualityGate = {
    enabled: qualityGateEnabled,
    thresholds: qualityThresholds,
    violations: qualityViolations,
  };
  const payload = {
    generatedAt: new Date().toISOString(),
    config: {
      mode: args.mode,
      runs: args.runs,
      models: args.models,
      casesPath: args.cases,
      baseUrl: args.baseUrl,
      repairAttempts: args.repairAttempts,
      qualityGate,
    },
    caseCount: cases.length,
    cases: cases.map((c) => ({
      id: c.id,
      prompt: c.prompt,
      hasExpected: Boolean(c.expectedDsl),
      requiredSnippets: c.requiredSnippets || [],
      baselineNames: Object.keys(c.baselines || {}),
    })),
    summaries,
    qualityGate,
    compression,
    records,
  };

  const reportMd = markdownReport({
    config: {
      mode: args.mode,
      generatedAt: payload.generatedAt,
      caseCount: cases.length,
      runs: args.runs,
      models: args.models,
    },
    summaries,
    qualityGate,
    compression,
    records,
  });

  const outPath = await writeFileSafe(args.out, `${JSON.stringify(payload, null, 2)}\n`);
  const reportPath = await writeFileSafe(args.report, reportMd);
  process.stdout.write(`Wrote ${outPath}\nWrote ${reportPath}\n`);
  if (qualityGateEnabled && qualityViolations.length > 0) {
    process.stderr.write(`Live quality gate failed with ${qualityViolations.length} violation(s).\n`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
