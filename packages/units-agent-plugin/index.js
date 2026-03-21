let middlewareMod;
let compilerMod;

try {
  middlewareMod = await import("@botfather/units-agent-middleware");
  compilerMod = await import("@botfather/units-compiler");
} catch {
  // Monorepo fallback for direct node execution without workspace linking.
  middlewareMod = await import("../units-agent-middleware/index.js");
  compilerMod = await import("../units-compiler/index.js");
}

const { createUnitsAgentMiddleware } = middlewareMod;
const { compileUiToUnits } = compilerMod;

const TARGET_PRESETS = {
  chat: {
    includeId: false,
    includeActions: true,
    includeState: true,
    enableLoopHeuristic: true,
    minLoopGroupSize: 3,
  },
  planner: {
    includeId: true,
    includeActions: true,
    includeState: true,
    enableLoopHeuristic: true,
    minLoopGroupSize: 2,
  },
  vision: {
    includeId: false,
    includeActions: false,
    includeState: false,
    includeRoleProp: true,
    enableLoopHeuristic: true,
    minLoopGroupSize: 4,
  },
};

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeTarget(value) {
  const target = String(value || "chat").toLowerCase();
  if (target === "plan") return "planner";
  if (target === "executor") return "chat";
  if (target === "image") return "vision";
  if (target === "planner" || target === "vision" || target === "chat") return target;
  return "chat";
}

function estimateTokensFromDsl(dsl) {
  const text = String(dsl || "").trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sourceTypeFromOptions(options, config) {
  const explicit = String(options?.sourceType || config?.sourceType || "dom").toLowerCase();
  if (explicit === "accessibility") return "a11y";
  if (explicit === "ax") return "a11y";
  return explicit;
}

function mergeCompilerOptions(target, configOptions, callOptions) {
  const preset = TARGET_PRESETS[target] || TARGET_PRESETS.chat;
  return {
    sourceType: "ir",
    ...preset,
    ...(isObject(configOptions) ? configOptions : {}),
    ...(isObject(callOptions) ? callOptions : {}),
  };
}

function compressWithBudget(tree, compilerOptions, maxTokens) {
  let compileResult = compileUiToUnits(tree, compilerOptions);
  let tokenEstimate = estimateTokensFromDsl(compileResult.dsl);

  const budget = toFiniteNumber(maxTokens);
  if (budget == null || tokenEstimate <= budget) {
    return {
      compileResult,
      tokenEstimate,
      budgetApplied: false,
    };
  }

  const aggressivePass1 = {
    ...compilerOptions,
    includeId: false,
    includeState: false,
    enableLoopHeuristic: true,
    minLoopGroupSize: 2,
  };

  const candidate1 = compileUiToUnits(tree, aggressivePass1);
  const candidate1Tokens = estimateTokensFromDsl(candidate1.dsl);

  if (candidate1Tokens <= tokenEstimate) {
    compileResult = candidate1;
    tokenEstimate = candidate1Tokens;
  }

  if (tokenEstimate <= budget) {
    return {
      compileResult,
      tokenEstimate,
      budgetApplied: true,
    };
  }

  const aggressivePass2 = {
    ...aggressivePass1,
    includeActions: false,
  };

  const candidate2 = compileUiToUnits(tree, aggressivePass2);
  const candidate2Tokens = estimateTokensFromDsl(candidate2.dsl);
  if (candidate2Tokens <= tokenEstimate) {
    compileResult = candidate2;
    tokenEstimate = candidate2Tokens;
  }

  return {
    compileResult,
    tokenEstimate,
    budgetApplied: true,
  };
}

export function createUnitsAgentPlugin(config = {}) {
  const middleware = config.middleware || createUnitsAgentMiddleware({
    libraryDir: config.libraryDir,
    gates: config.gates,
    programs: config.programs,
    serializerOptions: config.serializerOptions,
  });

  async function compressUiForAgent(uiTree, options = {}) {
    const target = normalizeTarget(options.target || config.target);
    const sourceType = sourceTypeFromOptions(options, config);

    const rewrite = await middleware.rewrite({
      tree: uiTree,
      sourceType,
      taskContext: isObject(options.taskContext) ? options.taskContext : {},
      expectations: isObject(options.expectations) ? options.expectations : {},
    });

    const compileInputTree = rewrite.transformed
      ? rewrite.tree
      : rewrite.normalized_tree || uiTree;

    const compilerOptions = mergeCompilerOptions(
      target,
      config.compilerOptions,
      options.compilerOptions,
    );

    const {
      compileResult,
      tokenEstimate,
      budgetApplied,
    } = compressWithBudget(
      compileInputTree,
      compilerOptions,
      options.maxTokens,
    );

    return {
      dsl: compileResult.dsl,
      unitsAst: compileResult.ast,
      programId: rewrite.selected_program?.program_id || null,
      program: rewrite.selected_program || null,
      transformed: rewrite.transformed === true,
      sourceType: rewrite.source_type,
      target,
      tokenEstimate,
      maxTokens: toFiniteNumber(options.maxTokens),
      budgetApplied,
      rewrite,
      compile: compileResult,
    };
  }

  async function listPrograms(sourceType = "any") {
    return middleware.listPrograms(sourceType);
  }

  return {
    compressUiForAgent,
    listPrograms,
    middleware,
    config: {
      libraryDir: config.libraryDir || null,
      target: normalizeTarget(config.target || "chat"),
      compilerOptions: isObject(config.compilerOptions) ? config.compilerOptions : {},
    },
  };
}

export async function compressUiForAgent(uiTree, options = {}) {
  const pluginConfig = isObject(options.pluginConfig) ? options.pluginConfig : {};
  const plugin = createUnitsAgentPlugin(pluginConfig);

  const callOptions = {
    ...options,
  };
  delete callOptions.pluginConfig;

  return plugin.compressUiForAgent(uiTree, callOptions);
}
