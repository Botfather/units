export interface RdlToolsPluginOptions {
  include?: RegExp;
  exclude?: RegExp;
  classPrefix?: string;
}

declare function rdlTools(options?: RdlToolsPluginOptions): import("vite").Plugin;

export default rdlTools;
