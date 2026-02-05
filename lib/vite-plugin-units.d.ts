export interface UnitsPluginOptions {
  emitSource?: boolean;
  emitAst?: boolean;
  useAstCache?: boolean;
  include?: RegExp;
  exclude?: RegExp;
}

declare function unitsPlugin(options?: UnitsPluginOptions): import("vite").Plugin;

export default unitsPlugin;
