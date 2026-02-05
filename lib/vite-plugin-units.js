import fs from "node:fs";
import path from "node:path";
import { parseUnits } from "./units-parser.js";

function endsWithUi(id) {
  return id.endsWith(".ui");
}

export default function unitsPlugin(options = {}) {
  const emitSource = options.emitSource !== false;
  const emitAst = options.emitAst !== false;
  const useAstCache = options.useAstCache !== false;
  const include = options.include;
  const exclude = options.exclude;

  function isAllowed(id) {
    if (!endsWithUi(id)) return false;
    if (include && !include.test(id)) return false;
    if (exclude && exclude.test(id)) return false;
    return true;
  }

  return {
    name: "units",
    enforce: "pre",
    resolveId(source, importer) {
      if (endsWithUi(source)) {
        return importer ? path.resolve(path.dirname(importer), source) : path.resolve(source);
      }
      return null;
    },
    load(id) {
      if (!isAllowed(id)) return null;
      const code = fs.readFileSync(id, "utf-8");
      let ast = null;
      if (useAstCache) {
        const astPath = `${id}.ast.json`;
        try {
          const uiStat = fs.statSync(id);
          const astStat = fs.statSync(astPath);
          if (astStat.mtimeMs >= uiStat.mtimeMs) {
            ast = JSON.parse(fs.readFileSync(astPath, "utf-8"));
          }
        } catch (_) {
          // fallback to parsing
        }
      }
      if (!ast) ast = parseUnits(code);
      const astJson = JSON.stringify(ast);
      const exports = [];
      if (emitSource) exports.push(`export const source = ${JSON.stringify(code)};`);
      if (emitAst) exports.push(`export const ast = ${astJson};\nexport default ast;`);
      return `${exports.join("\n")}\n`;
    },
  };
}
