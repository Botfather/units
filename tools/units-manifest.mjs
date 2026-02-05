import fs from "node:fs/promises";
import path from "node:path";

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

function toComponentName(file) {
  return path.basename(file, ".ui");
}

function toRel(from, file) {
  const rel = path.relative(from, file);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

const [rootDir, outFile] = process.argv.slice(2);
if (!rootDir || !outFile) {
  console.error("Usage: node units-manifest.mjs <rootDir> <outFile>");
  process.exit(1);
}

const rootAbs = path.resolve(process.cwd(), rootDir);
const outAbs = path.resolve(process.cwd(), outFile);
const outDir = path.dirname(outAbs);

const files = await collectUiFiles(rootAbs, true);
files.sort();

let imports = "";
let entries = "";

files.forEach((file, idx) => {
  const name = toComponentName(file);
  const rel = toRel(outDir, file).replace(/\\/g, "/");
  const varName = `Ast_${idx}`;
  imports += `import ${varName} from \"${rel}\";\n`;
  entries += `  \"${name}\": ${varName},\n`;
});

const content = `${imports}\nexport const uiManifest = {\n${entries}};\n`;
await fs.writeFile(outAbs, content, "utf-8");

console.log(`Wrote manifest with ${files.length} entries -> ${outAbs}`);
