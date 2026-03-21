export type CompressUiOptions = {
  sourceType?: string;
  target?: "chat" | "planner" | "vision" | string;
  maxTokens?: number;
  taskContext?: Record<string, any>;
  expectations?: Record<string, any>;
  compilerOptions?: Record<string, any>;
  pluginConfig?: Record<string, any>;
};

export function createUnitsAgentPlugin(config?: any): {
  compressUiForAgent: (uiTree: any, options?: CompressUiOptions) => Promise<{
    dsl: string;
    unitsAst: any;
    programId: string | null;
    program: any;
    transformed: boolean;
    sourceType: string;
    target: string;
    tokenEstimate: number;
    maxTokens: number | null;
    budgetApplied: boolean;
    rewrite: any;
    compile: any;
  }>;
  listPrograms: (sourceType?: string) => Promise<any[]>;
  middleware: any;
  config: any;
};

export function compressUiForAgent(uiTree: any, options?: CompressUiOptions): Promise<{
  dsl: string;
  unitsAst: any;
  programId: string | null;
  program: any;
  transformed: boolean;
  sourceType: string;
  target: string;
  tokenEstimate: number;
  maxTokens: number | null;
  budgetApplied: boolean;
  rewrite: any;
  compile: any;
}>;
