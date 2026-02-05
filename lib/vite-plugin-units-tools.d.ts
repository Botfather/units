export interface UnitsToolsPluginOptions {
  include?: RegExp;
  exclude?: RegExp;
  classPrefix?: string;
}

declare function unitsTools(options?: UnitsToolsPluginOptions): import("vite").Plugin;

export default unitsTools;
