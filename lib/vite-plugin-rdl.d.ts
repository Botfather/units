export interface RdlPluginOptions {
  emitSource?: boolean;
  emitAst?: boolean;
  useAstCache?: boolean;
  include?: RegExp;
  exclude?: RegExp;
}

declare function rdlPlugin(options?: RdlPluginOptions): import("vite").Plugin;

export default rdlPlugin;
