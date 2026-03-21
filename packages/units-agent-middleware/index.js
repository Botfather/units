let transformMod;
let treeIrMod;
let rewardMod;
let libraryMod;

try {
  transformMod = await import("@botfather/units/transform");
  treeIrMod = await import("@botfather/units/tree-ir");
  rewardMod = await import("@botfather/units/reward");
  libraryMod = await import("@botfather/units/library");
} catch {
  // Monorepo fallback for direct node execution without workspace linking.
  transformMod = await import("../units/transform.js");
  treeIrMod = await import("../units/tree-ir.js");
  rewardMod = await import("../units/reward.js");
  libraryMod = await import("../units/transform-library.js");
}

const {
  compileTransformProgram,
  runTransformProgram,
} = transformMod;

const {
  normalizeDomTree,
  normalizeA11yTree,
  normalizeIrNode,
  serializeAgentTree,
} = treeIrMod;

const {
  scoreProgram,
  verifyProgram,
} = rewardMod;

const {
  loadVerifiedLibrary,
} = libraryMod;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function normalizeSourceType(sourceType) {
  const value = String(sourceType || "dom").toLowerCase();
  if (value === "accessibility") return "a11y";
  if (value === "ax") return "a11y";
  return value;
}

function normalizeInputTree(tree, sourceType) {
  if (sourceType === "dom") return normalizeDomTree(tree);
  if (sourceType === "a11y") return normalizeA11yTree(tree);
  return normalizeIrNode(tree);
}

function canUseForSource(metadata, sourceType) {
  const programSource = metadata?.source_type || "any";
  if (programSource === "any") return true;
  return programSource === sourceType;
}

function toManualEntry(item) {
  if (typeof item === "string") {
    return {
      source: item,
      metadata: {
        program_id: null,
        source_type: "any",
        constraints_passed: true,
      },
    };
  }
  if (!item || typeof item !== "object") return null;
  if (typeof item.source !== "string") return null;
  return {
    source: item.source,
    metadata: item.metadata && typeof item.metadata === "object"
      ? item.metadata
      : {
        program_id: null,
        source_type: "any",
        constraints_passed: true,
      },
  };
}

function byScoreDesc(left, right) {
  const leftScore = Number(left?.score?.total ?? Number.NEGATIVE_INFINITY);
  const rightScore = Number(right?.score?.total ?? Number.NEGATIVE_INFINITY);
  return rightScore - leftScore;
}

export function createUnitsAgentMiddleware(config = {}) {
  const gates = config.gates && typeof config.gates === "object" ? config.gates : {};
  const serializerOptions = config.serializerOptions && typeof config.serializerOptions === "object"
    ? config.serializerOptions
    : {};
  const manualPrograms = asArray(config.programs)
    .map((item) => toManualEntry(item))
    .filter(Boolean);

  async function collectCandidates(sourceType) {
    const out = [...manualPrograms];
    if (!config.libraryDir) return out;

    const fromLibrary = await loadVerifiedLibrary(config.libraryDir, {
      sourceType,
      includeInactive: false,
    });

    for (const entry of fromLibrary) out.push(entry);
    return out;
  }

  async function rewrite({
    tree,
    sourceType = "dom",
    taskContext = {},
    expectations = {},
  }) {
    const normalizedSourceType = normalizeSourceType(sourceType);
    const inputTree = normalizeInputTree(tree, normalizedSourceType);
    const candidates = await collectCandidates(normalizedSourceType);

    let best = null;
    const candidateScores = [];

    for (const candidate of candidates) {
      const metadata = candidate.metadata || {};
      if (metadata.constraints_passed === false) continue;
      if (!canUseForSource(metadata, normalizedSourceType)) continue;

      let compiled;
      try {
        compiled = compileTransformProgram(candidate.source, {
          programId: metadata.program_id || undefined,
        });
      } catch {
        continue;
      }

      const run = runTransformProgram(compiled, inputTree, taskContext);
      const score = scoreProgram({
        inputTree,
        outputTree: run.tree,
        expectations,
      });
      const verification = verifyProgram(score, gates);

      const evaluated = {
        program: {
          ...metadata,
          program_id: metadata.program_id || compiled.program_id,
          source_type: metadata.source_type || compiled.source_type,
          fingerprint: metadata.fingerprint || compiled.fingerprint,
        },
        run,
        score,
        verification,
      };
      candidateScores.push(evaluated);

      if (!verification.passed) continue;
      if (!best || score.total > best.score.total) {
        best = evaluated;
      }
    }

    candidateScores.sort(byScoreDesc);

    if (!best) {
      return {
        transformed: false,
        source_type: normalizedSourceType,
        tree,
        normalized_tree: inputTree,
        agent_tree: serializeAgentTree(inputTree, serializerOptions),
        trace: [],
        selected_program: null,
        reason: "no_verified_program",
        candidate_scores: candidateScores.map((item) => ({
          program: item.program,
          score: item.score,
          verification: item.verification,
        })),
      };
    }

    return {
      transformed: true,
      source_type: normalizedSourceType,
      tree: best.run.tree,
      input_tree: inputTree,
      agent_tree: serializeAgentTree(best.run.tree, serializerOptions),
      trace: best.run.trace,
      selected_program: best.program,
      scores: best.score,
      verification: best.verification,
      candidate_scores: candidateScores.map((item) => ({
        program: item.program,
        score: item.score,
        verification: item.verification,
      })),
    };
  }

  async function listPrograms(sourceType = "any") {
    const normalizedSourceType = normalizeSourceType(sourceType);
    const candidates = await collectCandidates(normalizedSourceType);
    return candidates.map((entry) => ({
      metadata: entry.metadata || {},
      source: entry.source,
    }));
  }

  return {
    rewrite,
    listPrograms,
    config: {
      libraryDir: config.libraryDir || null,
      gates,
      serializerOptions,
    },
  };
}
