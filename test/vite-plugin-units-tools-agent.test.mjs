import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import unitsTools from "../packages/vite-plugin-units-tools/index.js";

function parseVirtualModuleJson(source) {
  const text = String(source || "").trim();
  const prefix = "export default ";
  assert.ok(text.startsWith(prefix), "virtual module should export default JSON");
  const body = text.slice(prefix.length).replace(/;\s*$/, "");
  return JSON.parse(body);
}

test("vite-plugin-units-tools supports .ui?agent virtual query", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-vite-agent-"));
  const uiFile = path.join(tempDir, "Card.ui");

  await fs.writeFile(uiFile, `
// Comment that should be dropped by formatter
Card   (title:'Dashboard')   {
  text  'Hello'
}
`, "utf-8");

  const plugin = unitsTools({
    agentTarget: "planner",
  });

  const moduleCode = plugin.load(`${uiFile}?agent`);
  assert.ok(moduleCode);

  const payload = parseVirtualModuleJson(moduleCode);
  assert.equal(payload.target, "planner");
  assert.ok(typeof payload.dsl === "string" && payload.dsl.includes("Card"));
  assert.ok(typeof payload.tokenEstimate === "number");
  assert.ok(typeof payload.sourceTokenEstimate === "number");
  assert.ok(typeof payload.tokenReduction === "number");
});

test("resolveId handles relative .ui?agent&target query", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-vite-agent-resolve-"));
  const importer = path.join(tempDir, "entry.js");
  const uiFile = path.join(tempDir, "Button.ui");

  await fs.writeFile(importer, "", "utf-8");
  await fs.writeFile(uiFile, "Button { text 'Save' }\n", "utf-8");

  const plugin = unitsTools();
  const resolved = await plugin.resolveId("./Button.ui?agent&target=chat", importer);

  assert.equal(resolved, `${uiFile}?agent&target=chat`);
});
