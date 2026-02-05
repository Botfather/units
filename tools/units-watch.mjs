import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const [rootDir, outFile] = process.argv.slice(2);
if (!rootDir || !outFile) {
  console.error("Usage: node units-watch.mjs <rootDir> <outFile>");
  process.exit(1);
}

const rootAbs = path.resolve(process.cwd(), rootDir);
const outAbs = path.resolve(process.cwd(), outFile);

const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".vite", "vite-app"]);

function shouldIgnore(filePath) {
  const parts = filePath.split(path.sep);
  return parts.some((p) => ignoreDirs.has(p));
}

function isUi(filePath) {
  return filePath.endsWith(".ui");
}

function runTool(script, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [script, ...args], { stdio: "inherit" });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} failed with code ${code}`));
    });
  });
}

let timer = null;
let running = false;
let pending = false;

async function rebuild() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    const toolsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
    const manifestTool = path.resolve(toolsDir, "units-manifest.mjs");
    const emitTool = path.resolve(toolsDir, "units-emit.mjs");
    await runTool(manifestTool, [rootAbs, outAbs]);
    await runTool(emitTool, [rootAbs]);
  } catch (err) {
    console.error(err.message || err);
  } finally {
    running = false;
    if (pending) {
      pending = false;
      rebuild();
    }
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(rebuild, 200);
}

console.log(`Watching ${rootAbs} for .ui changes...`);
rebuild();

const watcher = fs.watch(rootAbs, { recursive: true }, (event, filename) => {
  if (!filename) return;
  const full = path.join(rootAbs, filename);
  if (shouldIgnore(full)) return;
  if (!isUi(full)) return;
  schedule();
});

process.on("SIGINT", () => {
  watcher.close();
  process.exit(0);
});
