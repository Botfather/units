import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import unitsPlugin from "../packages/vite-plugin-units/index.js";

function readExportedAst(moduleCode) {
  const text = String(moduleCode || "");
  const match = text.match(/export const ast = (.+);\nexport default ast;/s);
  assert.ok(match, "expected ast export block");
  return JSON.parse(match[1]);
}

test("vite-plugin-units resolveId handles relative, absolute, bare, and non-ui sources", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-vite-plugin-resolve-"));
  const importer = path.join(tempDir, "entry.js");
  await fs.writeFile(importer, "", "utf-8");

  const plugin = unitsPlugin();

  const rel = await plugin.resolveId("./Card.ui", importer);
  assert.equal(rel, path.join(tempDir, "Card.ui"));

  const abs = await plugin.resolveId("/tmp/sample.ui", importer);
  assert.equal(abs, path.resolve("/tmp/sample.ui"));

  const bare = await plugin.resolveId.call(
    {
      async resolve(source, from, options) {
        assert.equal(source, "pkg/Button.ui");
        assert.equal(from, importer);
        assert.deepEqual(options, { skipSelf: true });
        return { id: "/virtual/pkg/Button.ui" };
      },
    },
    "pkg/Button.ui",
    importer,
  );
  assert.equal(bare, "/virtual/pkg/Button.ui");

  const unresolved = await plugin.resolveId.call(
    {
      async resolve() {
        return null;
      },
    },
    "pkg/Missing.ui",
    importer,
  );
  assert.equal(unresolved, null);

  const nonUi = await plugin.resolveId("entry.jsx", importer);
  assert.equal(nonUi, null);
});

test("vite-plugin-units load respects include/exclude and emit flags", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-vite-plugin-load-"));
  const allowed = path.join(tempDir, "allowed.ui");
  const blocked = path.join(tempDir, "blocked.ui");
  const other = path.join(tempDir, "other.txt");

  await fs.writeFile(allowed, "App { text 'ok' }\n", "utf-8");
  await fs.writeFile(blocked, "App { text 'blocked' }\n", "utf-8");
  await fs.writeFile(other, "noop\n", "utf-8");

  const filtered = unitsPlugin({
    include: /allowed\.ui$/,
    exclude: /blocked\.ui$/,
  });

  assert.equal(filtered.load(blocked), null);
  assert.equal(filtered.load(other), null);
  assert.ok(filtered.load(allowed));

  const sourceOnly = unitsPlugin({
    emitAst: false,
  });
  const sourceCode = sourceOnly.load(allowed);
  assert.match(sourceCode, /export const source = /);
  assert.doesNotMatch(sourceCode, /export const ast = /);

  const astOnly = unitsPlugin({
    emitSource: false,
  });
  const astCode = astOnly.load(allowed);
  assert.doesNotMatch(astCode, /export const source = /);
  assert.match(astCode, /export const ast = /);
  assert.match(astCode, /export default ast;/);

  const none = unitsPlugin({
    emitSource: false,
    emitAst: false,
  });
  assert.equal(none.load(allowed), "\n");
});

test("vite-plugin-units load uses ast cache when fresh and falls back cleanly when cache is invalid", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "units-vite-plugin-cache-"));
  const file = path.join(tempDir, "Card.ui");
  const astFile = `${file}.ast.json`;

  // Fresh cache hit path: source is intentionally invalid, but cached AST is valid.
  await fs.writeFile(file, "App {\n", "utf-8");
  await fs.writeFile(astFile, JSON.stringify({
    type: "document",
    body: [{ type: "tag", name: "Cached", props: [], children: [], start: 0, end: 6 }],
    start: 0,
    end: 6,
  }), "utf-8");

  const plugin = unitsPlugin();
  const fromCacheCode = plugin.load(file);
  const fromCacheAst = readExportedAst(fromCacheCode);
  assert.equal(fromCacheAst.body[0].name, "Cached");

  // Invalid JSON in fresh cache should be caught, then parser fallback should succeed.
  await fs.writeFile(file, "App { text 'Fallback' }\n", "utf-8");
  await fs.writeFile(astFile, "{ not-json", "utf-8");
  const fallbackCode = plugin.load(file);
  const fallbackAst = readExportedAst(fallbackCode);
  assert.equal(fallbackAst.type, "document");
  assert.equal(fallbackAst.body[0].name, "App");

  // Explicit no-cache mode should parse source directly.
  const noCachePlugin = unitsPlugin({ useAstCache: false });
  const noCacheCode = noCachePlugin.load(file);
  const noCacheAst = readExportedAst(noCacheCode);
  assert.equal(noCacheAst.body[0].name, "App");
});
