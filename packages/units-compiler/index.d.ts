export type UiNode = {
  id?: string;
  key?: string;
  type?: string;
  role?: string;
  name?: string;
  text?: string;
  props?: Record<string, any>;
  state?: Record<string, any>;
  actions?: string[];
  meta?: Record<string, any>;
  children?: UiNode[];
};

export type CompileUiOptions = {
  program?: any;
  sourceType?: "auto" | "dom" | "a11y" | "ir" | string;
  context?: Record<string, any>;
  includeId?: boolean;
  includeActions?: boolean;
  includeState?: boolean;
  includeRoleProp?: boolean;
  includeHidden?: boolean;
  enableLoopHeuristic?: boolean;
  minLoopGroupSize?: number;
  enableIfHeuristic?: boolean;
  emptyRootTag?: string;
};

export function compileUiToUnits(
  uiRoot: any,
  programOrOptions?: any,
  maybeOptions?: CompileUiOptions,
): {
  dsl: string;
  ast: any;
  source_type: string;
  input_tree: any;
  tree: any;
  program: any;
  trace: any[];
  stats: {
    input_nodes: number;
    output_nodes: number;
    loop_groups: number;
  };
};

export function compileUiToUnitsDsl(
  uiRoot: any,
  programOrOptions?: any,
  maybeOptions?: CompileUiOptions,
): string;
