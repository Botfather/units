import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { formatUnits } from "./units-print.js";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeFilePart(value) {
  return String(value || "program")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "") || "program";
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function canonicalProgramSource(programSource) {
  const source = String(programSource || "");
  try {
    return formatUnits(source);
  } catch {
    return source.trimEnd() + (source.endsWith("\n") ? "" : "\n");
  }
}

export function computeProgramFingerprint(programSource) {
  return hash(canonicalProgramSource(programSource));
}

export function createVerifiedProgramMetadata({
  programSource,
  sourceType = "any",
  scores = {},
  constraintsPassed = false,
  programId,
  createdAt,
  provenance,
}) {
  const canonicalSource = canonicalProgramSource(programSource);
  const fingerprint = computeProgramFingerprint(canonicalSource);
  const id = programId || `${sourceType}-${fingerprint.slice(0, 12)}`;

  return {
    program_id: id,
    fingerprint,
    source_type: sourceType,
    scores: {
      total: toNumber(scores.total, 0),
      R_completeness: toNumber(scores.R_completeness, 0),
      R_efficiency: toNumber(scores.R_efficiency, 0),
      metrics: scores.metrics && typeof scores.metrics === "object" ? scores.metrics : {},
    },
    constraints_passed: Boolean(constraintsPassed),
    created_at: createdAt || new Date().toISOString(),
    active: true,
    provenance: provenance && typeof provenance === "object" ? provenance : undefined,
  };
}

function scoreValue(entry) {
  return toNumber(entry?.metadata?.scores?.total, Number.NEGATIVE_INFINITY);
}

function matchSourceType(entry, sourceType) {
  if (!sourceType || sourceType === "any") return true;
  return entry?.metadata?.source_type === "any" || entry?.metadata?.source_type === sourceType;
}

function isEligible(entry, includeInactive) {
  if (!entry?.metadata) return false;
  if (!includeInactive && entry.metadata.active === false) return false;
  return true;
}

async function readJsonSafe(file) {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readFileSafe(file) {
  try {
    return await fs.readFile(file, "utf-8");
  } catch {
    return null;
  }
}

async function collectMetadataFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".meta.json"))
    .map((entry) => path.join(directory, entry.name));
}

function byScoreAndDateDesc(left, right) {
  const scoreDiff = scoreValue(right) - scoreValue(left);
  if (scoreDiff !== 0) return scoreDiff;
  const leftTime = Date.parse(left?.metadata?.created_at || "") || 0;
  const rightTime = Date.parse(right?.metadata?.created_at || "") || 0;
  return rightTime - leftTime;
}

export async function loadVerifiedLibrary(directory, options = {}) {
  const includeInactive = options.includeInactive === true;
  const sourceType = options.sourceType || "any";
  const abs = path.resolve(process.cwd(), directory || ".");

  let metadataFiles = [];
  try {
    metadataFiles = await collectMetadataFiles(abs);
  } catch {
    return [];
  }

  const results = [];
  for (const file of metadataFiles) {
    const metadata = await readJsonSafe(file);
    if (!metadata || !metadata.program_id) continue;

    const base = file.replace(/\.meta\.json$/, "");
    const sidecarProgramPath = `${base}.ui`;
    const idProgramPath = path.join(abs, `${sanitizeFilePart(metadata.program_id)}.ui`);
    const programPath = (await readFileSafe(sidecarProgramPath)) != null ? sidecarProgramPath : idProgramPath;
    const source = await readFileSafe(programPath);
    if (source == null) continue;

    const entry = {
      source,
      metadata,
      paths: {
        program: programPath,
        metadata: file,
      },
    };

    if (!isEligible(entry, includeInactive)) continue;
    if (!matchSourceType(entry, sourceType)) continue;
    results.push(entry);
  }

  results.sort(byScoreAndDateDesc);
  return results;
}

export function dedupeLibraryEntries(entries = []) {
  const bestByFingerprint = new Map();
  for (const entry of entries) {
    const fingerprint = entry?.metadata?.fingerprint;
    if (!fingerprint) continue;
    const previous = bestByFingerprint.get(fingerprint);
    if (!previous || byScoreAndDateDesc(entry, previous) < 0) {
      bestByFingerprint.set(fingerprint, entry);
    }
  }
  return [...bestByFingerprint.values()].sort(byScoreAndDateDesc);
}

export function selectBestVerifiedProgram(entries = [], options = {}) {
  const sourceType = options.sourceType || "any";
  const eligible = entries
    .filter((entry) => isEligible(entry, false))
    .filter((entry) => matchSourceType(entry, sourceType))
    .filter((entry) => entry?.metadata?.constraints_passed === true)
    .sort(byScoreAndDateDesc);

  return eligible[0] || null;
}

export async function writeVerifiedProgram({ directory, programSource, metadata }) {
  if (!metadata || !metadata.program_id) {
    throw new Error("writeVerifiedProgram requires metadata with program_id.");
  }

  const abs = path.resolve(process.cwd(), directory || ".");
  await fs.mkdir(abs, { recursive: true });

  const baseName = sanitizeFilePart(metadata.program_id);
  const programPath = path.join(abs, `${baseName}.ui`);
  const metadataPath = path.join(abs, `${baseName}.meta.json`);

  const canonicalSource = canonicalProgramSource(programSource);
  await fs.writeFile(programPath, canonicalSource, "utf-8");
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");

  return {
    programPath,
    metadataPath,
  };
}

export async function rollbackProgram({ directory, programId, rollbackReason }) {
  if (!programId) {
    throw new Error("rollbackProgram requires programId.");
  }

  const abs = path.resolve(process.cwd(), directory || ".");
  const files = await collectMetadataFiles(abs);

  for (const file of files) {
    const metadata = await readJsonSafe(file);
    if (!metadata || metadata.program_id !== programId) continue;

    const next = {
      ...metadata,
      active: false,
      rolled_back_at: new Date().toISOString(),
      rollback_reason: rollbackReason || "manual",
    };

    await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    return { metadataPath: file, metadata: next };
  }

  throw new Error(`Program \"${programId}\" not found in ${abs}`);
}
