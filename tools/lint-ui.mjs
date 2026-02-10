import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const lintScript = path.join(here, "units-lint.mjs");
const targets = process.argv.slice(2);
const args = [lintScript, ...(targets.length ? targets : ["examples", "uikit"])];

const child = spawn(process.execPath, args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
