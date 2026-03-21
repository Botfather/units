#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { parseUnits } from "../packages/units/units-parser.js";
import { formatUnits } from "../packages/units/units-print.js";

const DEFAULT_PAIRS = "bench/react-vs-dsl-pairs.json";
const DEFAULT_OUT = "bench/results/react-vs-dsl.json";
const DEFAULT_REPORT = "bench/results/react-vs-dsl.md";
const DEFAULT_WINDOWS = [8192, 32768, 128000, 200000];
const DEFAULT_TOKENIZER_MODE = "approx";
const DEFAULT_PROVIDER_MODEL = "gpt-4.1-mini";
const DEFAULT_PROVIDER_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const DEFAULT_PROVIDER_CACHE = "bench/results/provider-token-cache.json";
const PROVIDER_TOKENIZER_ID = "provider_input";

function parseArgs(argv) {
  const out = {
    pairs: DEFAULT_PAIRS,
    out: DEFAULT_OUT,
    report: DEFAULT_REPORT,
    windows: [...DEFAULT_WINDOWS],
    includeSynthetic: true,
    syntheticLimit: null,
    tokenizerMode: DEFAULT_TOKENIZER_MODE,
    providerModel: DEFAULT_PROVIDER_MODEL,
    providerBaseUrl: DEFAULT_PROVIDER_BASE_URL,
    providerCache: DEFAULT_PROVIDER_CACHE,
    providerMaxCases: null,
    providerConcurrency: 4,
    providerMinPositivePct: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pairs") out.pairs = String(argv[++i] || out.pairs);
    else if (arg === "--out") out.out = String(argv[++i] || out.out);
    else if (arg === "--report") out.report = String(argv[++i] || out.report);
    else if (arg === "--windows") {
      out.windows = String(argv[++i] || "")
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v) && v > 0);
    } else if (arg === "--include-synthetic") {
      out.includeSynthetic = String(argv[++i] || "true") !== "false";
    } else if (arg === "--synthetic-limit") {
      const n = Number(argv[++i]);
      out.syntheticLimit = Number.isFinite(n) && n > 0 ? n : null;
    } else if (arg === "--tokenizer-mode") {
      out.tokenizerMode = String(argv[++i] || out.tokenizerMode);
    } else if (arg === "--provider-model") {
      out.providerModel = String(argv[++i] || out.providerModel);
    } else if (arg === "--provider-base-url") {
      out.providerBaseUrl = String(argv[++i] || out.providerBaseUrl);
    } else if (arg === "--provider-cache") {
      out.providerCache = String(argv[++i] || out.providerCache);
    } else if (arg === "--provider-max-cases") {
      const n = Number(argv[++i]);
      out.providerMaxCases = Number.isFinite(n) && n > 0 ? n : null;
    } else if (arg === "--provider-concurrency") {
      const n = Number(argv[++i]);
      out.providerConcurrency = Number.isFinite(n) && n > 0 ? Math.floor(n) : out.providerConcurrency;
    } else if (arg === "--provider-min-positive-pct") {
      const n = Number(argv[++i]);
      out.providerMinPositivePct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : out.providerMinPositivePct;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    }
  }
  return out;
}

function usage() {
  return `
Usage:
  node tools/react-vs-dsl-bench.mjs [--pairs bench/react-vs-dsl-pairs.json]
                                    [--out bench/results/react-vs-dsl.json]
                                    [--report bench/results/react-vs-dsl.md]
                                    [--windows 8192,32768,128000,200000]
                                    [--include-synthetic true]
                                    [--synthetic-limit 100]
                                    [--tokenizer-mode approx|provider|both]
                                    [--provider-model gpt-4.1-mini]
                                    [--provider-max-cases 50]
                                    [--provider-min-positive-pct 80]

Provider mode requires:
  OPENAI_API_KEY=...
`;
}

function lexicalTokens(text) {
  const src = String(text || "");
  if (!src) return 0;
  const tokens = src.match(
    /[A-Za-z_$][A-Za-z0-9_$]*|0x[0-9A-Fa-f]+|\d+\.\d+|\d+|=>|==|!=|<=|>=|\+\+|--|&&|\|\||\?\?|\.\.\.|[{}()[\].,;:+\-*/%<>=!?:@#'"`]/g,
  );
  return tokens ? tokens.length : 0;
}

function charsDiv4Tokens(text) {
  const src = String(text || "");
  if (!src) return 0;
  return Math.ceil(src.length / 4);
}

const APPROX_TOKENIZERS = [
  { id: "chars_div4", label: "Chars/4 Approx", fn: charsDiv4Tokens },
  { id: "lexical", label: "Lexical Approx", fn: lexicalTokens },
];

function pct(numerator, denominator) {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

function avg(values) {
  const valid = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function fmt(n, digits = 2) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

function analyzeDsl(dsl) {
  const src = String(dsl || "");
  let parseOk = false;
  let parseError = null;
  let formatStable = null;
  let normalized = null;
  try {
    parseUnits(src);
    parseOk = true;
    normalized = formatUnits(src);
    formatStable = normalized.trimEnd() === src.trimEnd();
  } catch (err) {
    parseError = err && err.message ? String(err.message) : String(err);
  }
  return { parseOk, parseError, formatStable, normalized };
}

async function readText(baseDir, relPath, inlineValue) {
  if (typeof inlineValue === "string") return inlineValue;
  if (!relPath) return "";
  const abs = path.resolve(baseDir, relPath);
  return fs.readFile(abs, "utf-8");
}

function contextUsage(tokenCount, windows) {
  return windows.map((windowSize) => ({
    window: windowSize,
    usagePct: (tokenCount / windowSize) * 100,
  }));
}

function comparePair({ id, source, reactCode, dslCode, windows, tokenizers }) {
  const dslQuality = analyzeDsl(dslCode);
  const tokenMetrics = {};
  for (const tokenizer of tokenizers) {
    const reactTokens = tokenizer.fn(reactCode);
    const dslTokens = tokenizer.fn(dslCode);
    const savingsTokens = reactTokens - dslTokens;
    const savingsPct = reactTokens > 0 ? (savingsTokens / reactTokens) * 100 : null;
    tokenMetrics[tokenizer.id] = {
      reactTokens,
      dslTokens,
      savingsTokens,
      savingsPct,
      reactContext: contextUsage(reactTokens, windows),
      dslContext: contextUsage(dslTokens, windows),
    };
  }
  return {
    id,
    source,
    reactChars: String(reactCode || "").length,
    dslChars: String(dslCode || "").length,
    dslQuality,
    tokenMetrics,
  };
}

function makePropsDsl(propCount, exprComplexity) {
  const out = [];
  for (let i = 0; i < propCount; i++) {
    if (i % 3 === 0) out.push(`title${i}:'Block ${i}'`);
    else if (i % 3 === 1) out.push(`active${i}?=@${exprComplexity ? "(state.flags?.[i] ?? false)" : "state.enabled"}`);
    else out.push(`value${i}=@${exprComplexity ? "(state.items?.[i]?.score ?? 0)" : "state.count"}`);
  }
  return out.length > 0 ? ` (${out.join(", ")})` : "";
}

function makePropsReact(propCount, exprComplexity) {
  const out = [];
  for (let i = 0; i < propCount; i++) {
    if (i % 3 === 0) out.push(`title${i}="Block ${i}"`);
    else if (i % 3 === 1) out.push(`active${i}={${exprComplexity ? "state.flags?.[i] ?? false" : "state.enabled"}}`);
    else out.push(`value${i}={${exprComplexity ? "state.items?.[i]?.score ?? 0" : "state.count"}}`);
  }
  return out.length > 0 ? ` ${out.join(" ")}` : "";
}

function makeEventsDsl(eventCount, exprComplexity, indent) {
  const lines = [];
  for (let i = 0; i < eventCount; i++) {
    const body = exprComplexity
      ? `onAction${i}(@item.id, @index, @(state.mode ?? 'default'))`
      : `onAction${i}(@item.id)`;
    lines.push(`${"  ".repeat(indent)}Button (!click { ${body} }) {`);
    lines.push(`${"  ".repeat(indent + 1)}text 'Action ${i + 1}'`);
    lines.push(`${"  ".repeat(indent)}}`);
  }
  return lines;
}

function makeEventsReact(eventCount, exprComplexity, indent) {
  const lines = [];
  for (let i = 0; i < eventCount; i++) {
    const body = exprComplexity
      ? `onAction${i}(item.id, index, state.mode ?? "default")`
      : `onAction${i}(item.id)`;
    lines.push(`${"  ".repeat(indent)}<Button onClick={() => ${body}}>Action ${i + 1}</Button>`);
  }
  return lines;
}

function makeTextDsl(textMode, indent) {
  if (textMode === "interpolated") {
    return `${"  ".repeat(indent)}text 'Row @{item.label} in @{state.mode}'`;
  }
  return `${"  ".repeat(indent)}text 'Row item'`;
}

function makeTextReact(textMode, indent) {
  if (textMode === "interpolated") {
    return `${"  ".repeat(indent)}<span>{\`Row \${item.label} in \${state.mode}\`}</span>`;
  }
  return `${"  ".repeat(indent)}<span>Row item</span>`;
}

function generateSyntheticPair({
  depth,
  propCount,
  eventCount,
  withCondition,
  loopMode,
  textMode,
  exprComplexity,
}) {
  const label = [
    `d${depth}`,
    `p${propCount}`,
    `e${eventCount}`,
    withCondition ? "cond1" : "cond0",
    `loop${loopMode}`,
    textMode === "interpolated" ? "txti" : "txtp",
    exprComplexity ? "expr1" : "expr0",
  ].join("_");

  const dslLines = ["App {"];
  const reactLines = ["<App>"];
  let dslIndent = 1;
  let reactIndent = 1;

  for (let i = 0; i < depth; i++) {
    dslLines.push(`${"  ".repeat(dslIndent)}Section${i} {`);
    dslIndent++;
    reactLines.push(`${"  ".repeat(reactIndent)}<Section${i}>`);
    reactIndent++;
  }

  dslLines.push(`${"  ".repeat(dslIndent)}Panel${makePropsDsl(propCount, exprComplexity)} {`);
  dslIndent++;
  reactLines.push(`${"  ".repeat(reactIndent)}<Panel${makePropsReact(propCount, exprComplexity)}>`);
  reactIndent++;

  if (loopMode === 0) {
    dslLines.push(`${"  ".repeat(dslIndent)}Row {`);
    dslLines.push(makeTextDsl(textMode, dslIndent + 1));
    dslLines.push(`${"  ".repeat(dslIndent)}}`);
    reactLines.push(`${"  ".repeat(reactIndent)}<Row>`);
    reactLines.push(makeTextReact(textMode, reactIndent + 1));
    reactLines.push(`${"  ".repeat(reactIndent)}</Row>`);
  } else if (loopMode === 1) {
    dslLines.push(`${"  ".repeat(dslIndent)}#for (item, index in @items) {`);
    dslLines.push(`${"  ".repeat(dslIndent + 1)}#key (@item.id)`);
    dslLines.push(`${"  ".repeat(dslIndent + 1)}Row {`);
    dslLines.push(makeTextDsl(textMode, dslIndent + 2));
    dslLines.push(`${"  ".repeat(dslIndent + 1)}}`);
    dslLines.push(`${"  ".repeat(dslIndent)}}`);

    reactLines.push(`${"  ".repeat(reactIndent)}{items.map((item, index) => (`);
    reactLines.push(`${"  ".repeat(reactIndent + 1)}<Row key={item.id}>`);
    reactLines.push(makeTextReact(textMode, reactIndent + 2));
    reactLines.push(`${"  ".repeat(reactIndent + 1)}</Row>`);
    reactLines.push(`${"  ".repeat(reactIndent)}))}`);
  } else {
    dslLines.push(`${"  ".repeat(dslIndent)}#for (group in @groups) {`);
    dslLines.push(`${"  ".repeat(dslIndent + 1)}#key (@group.id)`);
    dslLines.push(`${"  ".repeat(dslIndent + 1)}#for (item, index in @group.items) {`);
    dslLines.push(`${"  ".repeat(dslIndent + 2)}#key (@item.id)`);
    dslLines.push(`${"  ".repeat(dslIndent + 2)}Row {`);
    dslLines.push(makeTextDsl(textMode, dslIndent + 3));
    dslLines.push(`${"  ".repeat(dslIndent + 2)}}`);
    dslLines.push(`${"  ".repeat(dslIndent + 1)}}`);
    dslLines.push(`${"  ".repeat(dslIndent)}}`);

    reactLines.push(`${"  ".repeat(reactIndent)}{groups.map((group) => (`);
    reactLines.push(`${"  ".repeat(reactIndent + 1)}<React.Fragment key={group.id}>`);
    reactLines.push(`${"  ".repeat(reactIndent + 2)}{group.items.map((item, index) => (`);
    reactLines.push(`${"  ".repeat(reactIndent + 3)}<Row key={item.id}>`);
    reactLines.push(makeTextReact(textMode, reactIndent + 4));
    reactLines.push(`${"  ".repeat(reactIndent + 3)}</Row>`);
    reactLines.push(`${"  ".repeat(reactIndent + 2)}))}`);
    reactLines.push(`${"  ".repeat(reactIndent + 1)}</React.Fragment>`);
    reactLines.push(`${"  ".repeat(reactIndent)}))}`);
  }

  if (withCondition) {
    dslLines.push(`${"  ".repeat(dslIndent)}#if (@showMeta) {`);
    dslLines.push(`${"  ".repeat(dslIndent + 1)}Meta {`);
    dslLines.push(`${"  ".repeat(dslIndent + 2)}text 'Enabled'`);
    dslLines.push(`${"  ".repeat(dslIndent + 1)}}`);
    dslLines.push(`${"  ".repeat(dslIndent)}}`);
    dslLines.push(`${"  ".repeat(dslIndent)}#else {`);
    dslLines.push(`${"  ".repeat(dslIndent + 1)}Meta {`);
    dslLines.push(`${"  ".repeat(dslIndent + 2)}text 'Disabled'`);
    dslLines.push(`${"  ".repeat(dslIndent + 1)}}`);
    dslLines.push(`${"  ".repeat(dslIndent)}}`);

    reactLines.push(`${"  ".repeat(reactIndent)}{showMeta ? (`);
    reactLines.push(`${"  ".repeat(reactIndent + 1)}<Meta>Enabled</Meta>`);
    reactLines.push(`${"  ".repeat(reactIndent)}) : (`);
    reactLines.push(`${"  ".repeat(reactIndent + 1)}<Meta>Disabled</Meta>`);
    reactLines.push(`${"  ".repeat(reactIndent)})}`);
  }

  dslLines.push(...makeEventsDsl(eventCount, exprComplexity, dslIndent));
  reactLines.push(...makeEventsReact(eventCount, exprComplexity, reactIndent));

  dslIndent--;
  dslLines.push(`${"  ".repeat(dslIndent)}}`);
  reactIndent--;
  reactLines.push(`${"  ".repeat(reactIndent)}</Panel>`);

  for (let i = depth - 1; i >= 0; i--) {
    dslIndent--;
    dslLines.push(`${"  ".repeat(dslIndent)}}`);
    reactIndent--;
    reactLines.push(`${"  ".repeat(reactIndent)}</Section${i}>`);
  }

  dslLines.push("}");
  reactLines.push("</App>");

  return {
    id: `synthetic_${label}`,
    source: "synthetic",
    reactCode: `${reactLines.join("\n")}\n`,
    dslCode: `${dslLines.join("\n")}\n`,
    dimensions: { depth, propCount, eventCount, withCondition, loopMode, textMode, exprComplexity },
  };
}

function generateSyntheticPairs(limit = null) {
  const depths = [1, 2, 3];
  const propCounts = [0, 2, 4];
  const eventCounts = [0, 1, 2];
  const conditions = [false, true];
  const loopModes = [0, 1, 2];
  const textModes = ["plain", "interpolated"];
  const expressionModes = [false, true];
  const out = [];
  for (const depth of depths) {
    for (const propCount of propCounts) {
      for (const eventCount of eventCounts) {
        for (const withCondition of conditions) {
          for (const loopMode of loopModes) {
            for (const textMode of textModes) {
              for (const exprComplexity of expressionModes) {
                out.push(generateSyntheticPair({
                  depth,
                  propCount,
                  eventCount,
                  withCondition,
                  loopMode,
                  textMode,
                  exprComplexity,
                }));
                if (limit && out.length >= limit) return out;
              }
            }
          }
        }
      }
    }
  }
  return out;
}

async function loadCuratedPairs(pairsPath) {
  const abs = path.resolve(process.cwd(), pairsPath);
  const raw = await fs.readFile(abs, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`Expected array in ${abs}`);
  const base = path.dirname(abs);
  const out = [];
  for (const item of parsed) {
    if (!item.id) throw new Error("Each pair must include `id`.");
    const reactCode = await readText(base, item.reactFile, item.reactCode);
    const dslCode = await readText(base, item.dslFile, item.dslCode);
    out.push({
      id: item.id,
      source: "curated",
      reactCode,
      dslCode,
      dimensions: null,
    });
  }
  return out;
}

function metricFromCounts(reactTokens, dslTokens, windows) {
  const savingsTokens = reactTokens - dslTokens;
  const savingsPct = reactTokens > 0 ? (savingsTokens / reactTokens) * 100 : null;
  return {
    reactTokens,
    dslTokens,
    savingsTokens,
    savingsPct,
    reactContext: contextUsage(reactTokens, windows),
    dslContext: contextUsage(dslTokens, windows),
  };
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}

async function loadJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(path.resolve(process.cwd(), filePath), "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function mapLimit(items, concurrency, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const count = Math.max(1, Math.min(concurrency, items.length || 1));
  const runners = Array.from({ length: count }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

async function fetchProviderInputTokens({
  apiKey,
  baseUrl,
  model,
  snippet,
}) {
  const endpoint = `${String(baseUrl).replace(/\/$/, "")}/responses`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        // Some models (e.g., o1) do not accept temperature; omit when not allowed.
        ...(model && model.startsWith("o1") ? {} : { temperature: 0 }),
        max_output_tokens: 16,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: "Read the code snippet and reply with OK only." }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: snippet }],
          },
        ],
      }),
    });
  } catch (err) {
    throw new Error(`Failed to reach provider endpoint ${endpoint}: ${err && err.message ? err.message : String(err)}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Provider API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const json = await response.json();
  const usage = json?.usage || {};
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? null;
  if (typeof inputTokens !== "number") {
    throw new Error("Provider response is missing usage.input_tokens.");
  }
  return inputTokens;
}

async function applyProviderTokenizer({
  pairInputs,
  cases,
  windows,
  model,
  baseUrl,
  maxCases,
  concurrency,
  cachePath,
}) {
  const apiKey = process.env.OPENAI_API_KEY || null;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for provider tokenizer mode.");
  }

  const cache = await loadJsonFile(cachePath, { version: 1, values: {} });
  if (!cache.values || typeof cache.values !== "object") cache.values = {};

  const selectedCount = maxCases ? Math.min(maxCases, cases.length) : cases.length;
  const targets = pairInputs.slice(0, selectedCount);
  const tasks = [];
  for (let i = 0; i < targets.length; i++) {
    const one = targets[i];
    tasks.push({
      caseIndex: i,
      kind: "react",
      snippet: one.reactCode,
      key: `${model}:${sha256(one.reactCode)}`,
    });
    tasks.push({
      caseIndex: i,
      kind: "dsl",
      snippet: one.dslCode,
      key: `${model}:${sha256(one.dslCode)}`,
    });
  }

  let done = 0;
  await mapLimit(tasks, concurrency, async (task) => {
    if (typeof cache.values[task.key] !== "number") {
      cache.values[task.key] = await fetchProviderInputTokens({
        apiKey,
        baseUrl,
        model,
        snippet: task.snippet,
      });
    }
    done++;
    if (done % 20 === 0 || done === tasks.length) {
      process.stdout.write(`Provider token probes: ${done}/${tasks.length}\n`);
    }
  });

  for (let i = 0; i < targets.length; i++) {
    const source = targets[i];
    const reactKey = `${model}:${sha256(source.reactCode)}`;
    const dslKey = `${model}:${sha256(source.dslCode)}`;
    const reactTokens = cache.values[reactKey];
    const dslTokens = cache.values[dslKey];
    cases[i].tokenMetrics[PROVIDER_TOKENIZER_ID] = metricFromCounts(reactTokens, dslTokens, windows);
  }

  await writeFileSafe(cachePath, `${JSON.stringify(cache, null, 2)}\n`);

  return {
    tokenizer: {
      id: PROVIDER_TOKENIZER_ID,
      label: `Provider Input Tokens (${model})`,
    },
    coveredCases: selectedCount,
    totalCases: cases.length,
    cacheEntries: Object.keys(cache.values).length,
  };
}

function median(values) {
  const valid = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  if (valid.length % 2 === 1) return valid[mid];
  return (valid[mid - 1] + valid[mid]) / 2;
}

function summarizeTokenEntries(entries, tokenizerLabel) {
  if (!entries || entries.length === 0) {
    return {
      tokenizer: tokenizerLabel,
      cases: 0,
      positive: 0,
      zero: 0,
      negative: 0,
      positivePct: null,
      avgSavingsTokens: null,
      avgSavingsPct: null,
      medianSavingsPct: null,
      verdict: "insufficient_data",
    };
  }
  const positive = entries.filter((e) => typeof e.savingsTokens === "number" && e.savingsTokens > 0).length;
  const zero = entries.filter((e) => e.savingsTokens === 0).length;
  const negative = entries.filter((e) => typeof e.savingsTokens === "number" && e.savingsTokens < 0).length;
  const verdict = (
    positive === entries.length ? "confirmed_all" :
    positive >= entries.length * 0.95 ? "confirmed_most" :
    positive > negative ? "mixed_positive" :
    "not_confirmed"
  );
  return {
    tokenizer: tokenizerLabel,
    cases: entries.length,
    positive,
    zero,
    negative,
    positivePct: pct(positive, entries.length),
    avgSavingsTokens: avg(entries.map((e) => e.savingsTokens)),
    avgSavingsPct: avg(entries.map((e) => e.savingsPct)),
    medianSavingsPct: median(entries.map((e) => e.savingsPct)),
    verdict,
  };
}

function summarizeContext(cases, tokenizerId, windows) {
  return windows.map((window) => {
    const reactUsage = [];
    const dslUsage = [];
    for (const oneCase of cases) {
      const m = oneCase.tokenMetrics[tokenizerId];
      if (!m) continue;
      const react = m.reactContext.find((r) => r.window === window);
      const dsl = m.dslContext.find((r) => r.window === window);
      if (react && dsl) {
        reactUsage.push(react.usagePct);
        dslUsage.push(dsl.usagePct);
      }
    }
    const avgReactUsagePct = avg(reactUsage);
    const avgDslUsagePct = avg(dslUsage);
    return {
      window,
      avgReactUsagePct,
      avgDslUsagePct,
      avgReductionPctPoints: (
        typeof avgReactUsagePct === "number" && typeof avgDslUsagePct === "number"
          ? avgReactUsagePct - avgDslUsagePct
          : null
      ),
    };
  });
}

function summarizeCases(cases, windows, tokenizerDefs, primaryTokenizerId) {
  const summaryByTokenizer = {};
  const sourceTypes = [...new Set(cases.map((c) => c.source))];
  const bySource = {};

  for (const tokenizer of tokenizerDefs) {
    const entries = cases.map((c) => c.tokenMetrics[tokenizer.id]).filter(Boolean);
    summaryByTokenizer[tokenizer.id] = summarizeTokenEntries(entries, tokenizer.label);

    bySource[tokenizer.id] = {};
    for (const source of sourceTypes) {
      const sub = cases
        .filter((c) => c.source === source)
        .map((c) => c.tokenMetrics[tokenizer.id])
        .filter(Boolean);
      bySource[tokenizer.id][source] = summarizeTokenEntries(sub, tokenizer.label);
    }
  }

  const parseFails = cases.filter((c) => !c.dslQuality.parseOk);
  const formatStableCount = cases.filter((c) => c.dslQuality.parseOk && c.dslQuality.formatStable).length;
  const fallbackPrimary = tokenizerDefs[0]?.id || "lexical";
  const chosenPrimary = primaryTokenizerId && summaryByTokenizer[primaryTokenizerId]
    ? primaryTokenizerId
    : fallbackPrimary;
  const primary = summaryByTokenizer[chosenPrimary];
  const hypothesis = {
    primaryTokenizerId: chosenPrimary,
    verdict: primary.verdict,
    confirmed: primary.positivePct >= 95,
  };
  const contextWindows = summarizeContext(cases, chosenPrimary, windows);

  return {
    totalCases: cases.length,
    parseOkCount: cases.length - parseFails.length,
    parseFailCount: parseFails.length,
    formatStableCount,
    hypothesis,
    tokenizers: summaryByTokenizer,
    bySource,
    contextWindows,
  };
}

function topCases(cases, tokenizerId, count, direction) {
  const sorted = [...cases]
    .filter((c) => c.tokenMetrics[tokenizerId])
    .sort((a, b) => {
    const av = a.tokenMetrics[tokenizerId].savingsPct ?? 0;
    const bv = b.tokenMetrics[tokenizerId].savingsPct ?? 0;
    return direction === "desc" ? bv - av : av - bv;
  });
  return sorted.slice(0, count);
}

function markdownReport({ config, summary, cases, tokenizerDefs, providerGate }) {
  const lines = [];
  lines.push("# React vs DSL Token Benchmark");
  lines.push("");
  lines.push(`- Generated: \`${config.generatedAt}\``);
  lines.push(`- Curated cases: \`${config.curatedCount}\``);
  lines.push(`- Synthetic cases: \`${config.syntheticCount}\``);
  lines.push(`- Total cases: \`${summary.totalCases}\``);
  lines.push(`- Context windows: \`${config.windows.join(", ")}\``);
  lines.push(`- Tokenizer mode: \`${config.tokenizerMode}\``);
  if (config.providerCoverage) {
    lines.push(`- Provider coverage: \`${config.providerCoverage.coveredCases}/${config.providerCoverage.totalCases}\` cases`);
    lines.push(`- Provider model: \`${config.providerCoverage.model}\``);
  }
  if (providerGate?.enabled) {
    lines.push(`- Provider gate min positive %: \`${fmt(providerGate.thresholdPct)}\``);
    lines.push(`- Provider gate status: \`${providerGate.passed ? "pass" : "fail"}\``);
  }
  lines.push("");
  lines.push("## Hypothesis");
  lines.push("");
  lines.push("Hypothesis: using Units DSL instead of direct React code reduces tokens/context usage.");
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(`Primary metric: \`${summary.hypothesis.primaryTokenizerId}\``);
  lines.push(`Hypothesis confirmed: **${summary.hypothesis.confirmed ? "YES" : "NO"}**`);
  lines.push("");
  for (const row of Object.values(summary.tokenizers)) {
    lines.push(`- ${row.tokenizer}: **${row.verdict}** (${fmt(row.positivePct)}% cases with DSL token savings)`);
  }
  lines.push("");
  lines.push("## Aggregate Metrics");
  lines.push("");
  lines.push("| Tokenizer | Cases | DSL Smaller | Same | DSL Larger | Avg Savings % | Median Savings % |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const row of Object.values(summary.tokenizers)) {
    lines.push(`| ${row.tokenizer} | ${row.cases} | ${row.positive} | ${row.zero} | ${row.negative} | ${fmt(row.avgSavingsPct)} | ${fmt(row.medianSavingsPct)} |`);
  }
  lines.push("");
  lines.push("## DSL Quality Checks");
  lines.push("");
  lines.push(`- Parse OK: ${summary.parseOkCount}/${summary.totalCases}`);
  lines.push(`- Parse Fail: ${summary.parseFailCount}`);
  lines.push(`- Format stable: ${summary.formatStableCount}/${summary.parseOkCount}`);
  lines.push("");
  lines.push("## Source Breakdown");
  lines.push("");
  lines.push("| Tokenizer | Source | Cases | DSL Smaller | Same | DSL Larger | Avg Savings % |");
  lines.push("|---|---|---:|---:|---:|---:|---:|");
  for (const tokenizer of tokenizerDefs) {
    const sourceRows = summary.bySource[tokenizer.id] || {};
    for (const [source, row] of Object.entries(sourceRows)) {
      lines.push(`| ${row.tokenizer} | ${source} | ${row.cases} | ${row.positive} | ${row.zero} | ${row.negative} | ${fmt(row.avgSavingsPct)} |`);
    }
  }
  lines.push("");
  lines.push("## Context Window Impact (Primary Metric)");
  lines.push("");
  lines.push("| Window | Avg React Usage % | Avg DSL Usage % | Avg Reduction (pp) |");
  lines.push("|---:|---:|---:|---:|");
  for (const row of summary.contextWindows) {
    lines.push(`| ${row.window} | ${fmt(row.avgReactUsagePct, 4)} | ${fmt(row.avgDslUsagePct, 4)} | ${fmt(row.avgReductionPctPoints, 4)} |`);
  }
  lines.push("");

  for (const tokenizer of tokenizerDefs) {
    const best = topCases(cases, tokenizer.id, 10, "desc");
    const worst = topCases(cases, tokenizer.id, 10, "asc");
    lines.push(`## Top Savings (${tokenizer.label})`);
    lines.push("");
    lines.push("| Case | Source | Savings % | React Tok | DSL Tok |");
    lines.push("|---|---|---:|---:|---:|");
    for (const c of best) {
      const m = c.tokenMetrics[tokenizer.id];
      lines.push(`| ${c.id} | ${c.source} | ${fmt(m.savingsPct)} | ${m.reactTokens} | ${m.dslTokens} |`);
    }
    lines.push("");
    lines.push(`## Lowest Savings (${tokenizer.label})`);
    lines.push("");
    lines.push("| Case | Source | Savings % | React Tok | DSL Tok |");
    lines.push("|---|---|---:|---:|---:|");
    for (const c of worst) {
      const m = c.tokenMetrics[tokenizer.id];
      lines.push(`| ${c.id} | ${c.source} | ${fmt(m.savingsPct)} | ${m.reactTokens} | ${m.dslTokens} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function writeFileSafe(target, content) {
  const abs = path.resolve(process.cwd(), target);
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

  if (!Array.isArray(args.windows) || args.windows.length === 0) {
    throw new Error("Pass at least one window size via --windows.");
  }
  if (!["approx", "provider", "both"].includes(args.tokenizerMode)) {
    throw new Error('Invalid --tokenizer-mode. Use "approx", "provider", or "both".');
  }

  const curated = await loadCuratedPairs(args.pairs);
  const synthetic = args.includeSynthetic ? generateSyntheticPairs(args.syntheticLimit) : [];
  const allInputs = [...curated, ...synthetic];
  const useApprox = args.tokenizerMode === "approx" || args.tokenizerMode === "both";
  const useProvider = args.tokenizerMode === "provider" || args.tokenizerMode === "both";
  const baseTokenizers = useApprox ? APPROX_TOKENIZERS : [];
  const tokenizerDefs = [...baseTokenizers];
  const cases = allInputs.map((pair) => comparePair({
    id: pair.id,
    source: pair.source,
    reactCode: pair.reactCode,
    dslCode: pair.dslCode,
    windows: args.windows,
    tokenizers: baseTokenizers,
  }));

  let providerCoverage = null;
  if (useProvider) {
    const providerInfo = await applyProviderTokenizer({
      pairInputs: allInputs,
      cases,
      windows: args.windows,
      model: args.providerModel,
      baseUrl: args.providerBaseUrl,
      maxCases: args.providerMaxCases,
      concurrency: args.providerConcurrency,
      cachePath: args.providerCache,
    });
    tokenizerDefs.push(providerInfo.tokenizer);
    providerCoverage = {
      model: args.providerModel,
      coveredCases: providerInfo.coveredCases,
      totalCases: providerInfo.totalCases,
      cacheEntries: providerInfo.cacheEntries,
      cachePath: args.providerCache,
    };
  }

  const primaryTokenizerId = useProvider ? PROVIDER_TOKENIZER_ID : "lexical";
  const summary = summarizeCases(cases, args.windows, tokenizerDefs, primaryTokenizerId);
  const providerSummary = summary.tokenizers[PROVIDER_TOKENIZER_ID];
  const providerGateEnabled = useProvider && typeof args.providerMinPositivePct === "number";
  const providerGate = {
    enabled: providerGateEnabled,
    thresholdPct: providerGateEnabled ? args.providerMinPositivePct : null,
    actualPct: providerSummary?.positivePct ?? null,
    passed: !providerGateEnabled || (
      typeof providerSummary?.positivePct === "number" && providerSummary.positivePct >= args.providerMinPositivePct
    ),
  };
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    config: {
      pairsPath: args.pairs,
      windows: args.windows,
      includeSynthetic: args.includeSynthetic,
      syntheticLimit: args.syntheticLimit,
      tokenizerMode: args.tokenizerMode,
      providerModel: args.providerModel,
      providerBaseUrl: args.providerBaseUrl,
      providerMaxCases: args.providerMaxCases,
      providerConcurrency: args.providerConcurrency,
      providerMinPositivePct: args.providerMinPositivePct,
      providerCache: args.providerCache,
      providerCoverage,
      tokenizers: tokenizerDefs,
    },
    curatedCount: curated.length,
    syntheticCount: synthetic.length,
    summary,
    providerGate,
    cases,
  };

  const report = markdownReport({
    config: {
      generatedAt,
      curatedCount: curated.length,
      syntheticCount: synthetic.length,
      windows: args.windows,
      tokenizerMode: args.tokenizerMode,
      providerCoverage,
    },
    summary,
    cases,
    tokenizerDefs,
    providerGate,
  });

  const outPath = await writeFileSafe(args.out, `${JSON.stringify(payload, null, 2)}\n`);
  const reportPath = await writeFileSafe(args.report, report);
  process.stdout.write(`Wrote ${outPath}\nWrote ${reportPath}\n`);
  if (providerGateEnabled && !providerGate.passed) {
    process.stderr.write(
      `Provider gate failed: positive=${fmt(providerGate.actualPct)}% < min=${fmt(providerGate.thresholdPct)}%.\n`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
