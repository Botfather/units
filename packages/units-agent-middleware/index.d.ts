export function createUnitsAgentMiddleware(config?: any): {
  rewrite: (args: {
    tree: any;
    sourceType?: string;
    taskContext?: any;
    expectations?: any;
  }) => Promise<any>;
  listPrograms: (sourceType?: string) => Promise<Array<{ metadata: any; source: string }>>;
  config: any;
};
