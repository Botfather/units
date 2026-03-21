import {
  compileTransformProgram,
  runTransformProgram,
} from "./transform.js";
import {
  normalizeDomTree,
  normalizeA11yTree,
  normalizeIrNode,
} from "./tree-ir.js";
import {
  scoreProgram,
  verifyProgram,
} from "./reward.js";
import {
  computeProgramFingerprint,
  createVerifiedProgramMetadata,
  dedupeLibraryEntries,
} from "./transform-library.js";

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function normalizeInputTree(sourceType, tree) {
  if (sourceType === "dom") return normalizeDomTree(tree);
  if (sourceType === "a11y") return normalizeA11yTree(tree);
  return normalizeIrNode(tree);
}

function withTrailingNewline(value) {
  const source = String(value || "");
  return source.endsWith("\n") ? source : `${source}\n`;
}

function injectRule(programSource, ruleSnippet) {
  const src = withTrailingNewline(programSource);
  const openIdx = src.indexOf("{\n");
  if (openIdx === -1) return `${src}${ruleSnippet}\n`;
  const insertAt = openIdx + 2;
  return `${src.slice(0, insertAt)}  ${ruleSnippet}\n${src.slice(insertAt)}`;
}

function defaultMutations(seedSource) {
  const candidates = [];

  if (!seedSource.includes("Filter (when=@node.state.hidden !== true)")) {
    candidates.push(injectRule(
      seedSource,
      "Rule (match=@node.role == 'container') { Filter (when=@node.state.hidden !== true) Pass }",
    ));
  }

  if (!seedSource.includes("Merge (strategy:'adjacentText'")) {
    candidates.push(injectRule(
      seedSource,
      "Rule (match=@node.role == 'container') { Merge (strategy:'adjacentText', when=@child.role == 'text') Pass }",
    ));
  }

  if (!seedSource.includes("Rule (match=@node.role == 'text')")) {
    candidates.push(injectRule(
      seedSource,
      "Rule (match=@node.role == 'text') { Filter (when=@node.text != '') Pass }",
    ));
  }

  return candidates;
}

export async function evaluateProgramOnDataset({
  programSource,
  dataset,
  gates = {},
  programId,
}) {
  const compiled = compileTransformProgram(programSource, { programId });
  const cases = asArray(dataset);

  const evaluations = [];
  let totalScore = 0;
  let completeness = 0;
  let efficiency = 0;
  let allPassed = true;

  for (const oneCase of cases) {
    const sourceType = oneCase?.sourceType || "ir";
    const inputTree = normalizeInputTree(sourceType, oneCase?.inputTree ?? oneCase?.tree);
    const run = runTransformProgram(compiled, inputTree, oneCase?.taskContext || {});
    const score = scoreProgram({
      inputTree,
      outputTree: run.tree,
      expectations: oneCase?.expectations || {},
    });
    const verification = verifyProgram(score, gates);

    evaluations.push({
      case_id: oneCase?.id || null,
      score,
      verification,
      trace: run.trace,
    });

    if (!verification.passed) allPassed = false;
    totalScore += score.total;
    completeness += score.R_completeness;
    efficiency += score.R_efficiency;
  }

  const count = Math.max(evaluations.length, 1);
  return {
    program: compiled,
    evaluations,
    all_passed: allPassed,
    score: {
      total: totalScore / count,
      R_completeness: completeness / count,
      R_efficiency: efficiency / count,
      metrics: {},
    },
  };
}

export async function runSynthesisLoop(options = {}) {
  const rounds = Number.isFinite(Number(options.rounds)) ? Math.max(1, Number(options.rounds)) : 1;
  const candidatesPerRound = Number.isFinite(Number(options.candidatesPerRound))
    ? Math.max(1, Number(options.candidatesPerRound))
    : 4;
  const minDelta = Number.isFinite(Number(options.minDelta)) ? Number(options.minDelta) : 0.03;

  const dataset = asArray(options.dataset);
  const gates = options.gates && typeof options.gates === "object" ? options.gates : {};
  const seedPrograms = asArray(options.seedPrograms)
    .map((item) => (typeof item === "string" ? { source: item } : item))
    .filter((item) => typeof item?.source === "string");

  const seenFingerprints = new Set();
  const libraryEntries = [];

  let best = null;

  for (const seed of seedPrograms) {
    const evaluation = await evaluateProgramOnDataset({
      programSource: seed.source,
      dataset,
      gates,
      programId: seed?.metadata?.program_id,
    });

    const metadata = seed.metadata || createVerifiedProgramMetadata({
      programSource: seed.source,
      sourceType: evaluation.program.source_type,
      scores: evaluation.score,
      constraintsPassed: evaluation.all_passed,
      provenance: {
        source: "seed",
      },
    });

    const entry = {
      source: evaluation.program.source,
      metadata,
      evaluation,
    };

    seenFingerprints.add(metadata.fingerprint || computeProgramFingerprint(entry.source));
    libraryEntries.push(entry);

    if (!best || evaluation.score.total > best.evaluation.score.total) {
      best = entry;
    }
  }

  const history = [];
  const promoted = [];

  const generateCandidates = options.generateCandidates || (async ({ currentBest }) => {
    return defaultMutations(currentBest?.source || "");
  });

  for (let round = 1; round <= rounds; round++) {
    const generated = await generateCandidates({
      round,
      currentBest: best,
      library: libraryEntries,
      candidatesPerRound,
    });

    const candidateSources = asArray(generated)
      .map((item) => (typeof item === "string" ? item : item?.source))
      .filter((item) => typeof item === "string")
      .slice(0, candidatesPerRound);

    let acceptedThisRound = 0;
    let bestCandidateScore = Number.NEGATIVE_INFINITY;

    for (const candidateSource of candidateSources) {
      const fingerprint = computeProgramFingerprint(candidateSource);
      if (seenFingerprints.has(fingerprint)) continue;
      seenFingerprints.add(fingerprint);

      const evaluation = await evaluateProgramOnDataset({
        programSource: candidateSource,
        dataset,
        gates,
      });

      bestCandidateScore = Math.max(bestCandidateScore, evaluation.score.total);

      const metadata = createVerifiedProgramMetadata({
        programSource: evaluation.program.source,
        sourceType: evaluation.program.source_type,
        scores: evaluation.score,
        constraintsPassed: evaluation.all_passed,
        provenance: {
          source: "synthesis",
          round,
        },
      });

      const entry = {
        source: evaluation.program.source,
        metadata,
        evaluation,
      };
      libraryEntries.push(entry);

      const baseline = best ? best.evaluation.score.total : Number.NEGATIVE_INFINITY;
      if (evaluation.all_passed && evaluation.score.total >= baseline + minDelta) {
        best = entry;
        promoted.push(entry);
        acceptedThisRound++;
      }
    }

    history.push({
      round,
      candidates_generated: candidateSources.length,
      accepted: acceptedThisRound,
      best_candidate_score: Number.isFinite(bestCandidateScore) ? bestCandidateScore : null,
      best_score_after_round: best?.evaluation?.score?.total ?? null,
    });
  }

  const deduped = dedupeLibraryEntries(libraryEntries);

  return {
    best,
    promoted,
    history,
    library: deduped,
    config: {
      rounds,
      candidatesPerRound,
      minDelta,
      gates,
    },
  };
}
