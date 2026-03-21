#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

let snapshotModule;
try {
  snapshotModule = await import("@botfather/units-dom-snapshot");
} catch {
  // Monorepo fallback for direct execution without workspace linking.
  snapshotModule = await import("../units-dom-snapshot/index.js");
}

const { captureSnapshotWithPlaywright } = snapshotModule;

function parseArgs(argv) {
  const out = {
    browserType: "chromium",
    rootSelector: "body",
    waitUntil: "domcontentloaded",
    playwrightModule: "playwright",
    snapshotOptions: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") out.url = String(argv[++i] || "");
    else if (arg === "--browser") out.browserType = String(argv[++i] || out.browserType);
    else if (arg === "--root-selector") out.rootSelector = String(argv[++i] || out.rootSelector);
    else if (arg === "--wait-until") out.waitUntil = String(argv[++i] || out.waitUntil);
    else if (arg === "--playwright-module") out.playwrightModule = String(argv[++i] || out.playwrightModule);
    else if (arg === "--max-depth") out.snapshotOptions.maxDepth = Number(argv[++i]);
    else if (arg === "--prune-invisible") out.snapshotOptions.pruneInvisible = String(argv[++i] || "true") !== "false";
    else if (arg === "--prune-offscreen") out.snapshotOptions.pruneOffscreen = String(argv[++i] || "true") !== "false";
    else if (arg === "--prune-layout-wrappers") out.snapshotOptions.pruneLayoutWrappers = String(argv[++i] || "true") !== "false";
    else if (arg === "--include-style-summary") out.snapshotOptions.includeStyleSummary = String(argv[++i] || "true") !== "false";
    else if (arg === "--out") out.out = String(argv[++i] || "");
    else if (arg === "--help" || arg === "-h") out.help = true;
  }

  return out;
}

function usage() {
  return `\nUsage:\n  units-snapshot --url <https://example.com> [options]\n\nOptions:\n  --browser <chromium|firefox|webkit>\n  --root-selector <css-selector>\n  --wait-until <load|domcontentloaded|networkidle|commit>\n  --playwright-module <module-name>\n  --max-depth <number>\n  --prune-invisible <true|false>\n  --prune-offscreen <true|false>\n  --prune-layout-wrappers <true|false>\n  --include-style-summary <true|false>\n  --out <snapshot.json>\n`;
}

async function writeJson(file, value) {
  const abs = path.resolve(process.cwd(), file);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  return abs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  if (!args.url) {
    process.stderr.write("Missing required --url\n");
    process.stderr.write(usage());
    process.exit(1);
  }

  const result = await captureSnapshotWithPlaywright({
    url: args.url,
    browserType: args.browserType,
    rootSelector: args.rootSelector,
    waitUntil: args.waitUntil,
    playwrightModule: args.playwrightModule,
    snapshotOptions: args.snapshotOptions,
  });

  if (args.out) {
    const outFile = await writeJson(args.out, result);
    process.stdout.write(`Wrote ${outFile}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
