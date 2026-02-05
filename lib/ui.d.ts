declare module "*.ui" {
  export const source: string;
  export const ast: {
    type: "document" | "tag" | "text" | "expr" | "directive";
    [key: string]: unknown;
  };
  const _default: typeof ast;
  export default _default;
}

declare module "*.ui?format" {
  const formatted: string;
  export default formatted;
}

declare module "*.ui?tokens" {
  const tokens: Array<{ type: string; value: string }>;
  export default tokens;
}

declare module "*.ui?highlight" {
  const html: string;
  export default html;
}
