import fs from "node:fs/promises";
import path from "node:path";
import { parseRDL } from "../lib/parser.js";

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

async function emitAst(file) {
  const src = await fs.readFile(file, "utf-8");
  const ast = parseRDL(src);
  const outFile = `${file}.ast.json`;
  await fs.writeFile(outFile, JSON.stringify(ast), "utf-8");
  return outFile;
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("Usage: node rdl-emit.mjs <file-or-dir>...");
  process.exit(1);
}

let count = 0;
for (const target of targets) {
  const abs = path.resolve(process.cwd(), target);
const files = await collectUiFiles(abs, true);
  for (const file of files) {
    await emitAst(file);
    count++;
  }
}

console.log(`Emitted AST for ${count} file(s).`);
