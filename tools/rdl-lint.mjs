import fs from "node:fs/promises";
import path from "node:path";
import { formatRDL } from "../lib/rdl-print.js";

async function collectUiFiles(entry, isRoot = false) {
  const base = path.basename(entry);
  if (base === "node_modules" || base === ".git" || base === "dist" || base === "build" || base === ".vite" || base === "vite-app") {
    return [];
  }
  let stat = await fs.lstat(entry);
  if (stat.isSymbolicLink()) {
    if (!isRoot) return [];
    stat = await fs.stat(entry);
  }
  if (stat.isFile()) return entry.endsWith(".ui") ? [entry] : [];
  const out = [];
  const items = await fs.readdir(entry);
  for (const item of items) {
    const full = path.join(entry, item);
    const sub = await collectUiFiles(full, false);
    out.push(...sub);
  }
  return out;
}

async function lintFile(file) {
  const src = await fs.readFile(file, "utf-8");
  const formatted = formatRDL(src);
  if (formatted !== src) {
    console.error(`Not formatted: ${file}`);
    return false;
  }
  return true;
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("Usage: node rdl-lint.mjs <file-or-dir>...");
  process.exit(1);
}

let ok = true;
for (const target of targets) {
  const abs = path.resolve(process.cwd(), target);
  const files = await collectUiFiles(abs, true);
  for (const file of files) {
    const pass = await lintFile(file);
    if (!pass) ok = false;
  }
}

process.exit(ok ? 0 : 1);
