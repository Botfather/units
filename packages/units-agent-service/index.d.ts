export type UnitsAgentServiceConfig = {
  endpoint?: string;
  healthEndpoint?: string;
  host?: string;
  port?: number;
  maxBodyBytes?: number;
  sourceType?: string;
  libraryDir?: string;
  gates?: Record<string, any>;
  programs?: any[];
  target?: string;
  compilerOptions?: Record<string, any>;
  serializerOptions?: Record<string, any>;
  plugin?: any;
};

export function createUnitsAgentService(config?: UnitsAgentServiceConfig): {
  endpoint: string;
  healthEndpoint: string;
  plugin: any;
  compress: (payload?: any) => Promise<any>;
  handleHttpRequest: (req: any, res: any) => Promise<void>;
};

export function createUnitsAgentHttpHandler(config?: UnitsAgentServiceConfig): (
  req: any,
  res: any,
) => Promise<void>;

export function startUnitsAgentService(config?: UnitsAgentServiceConfig): Promise<{
  server: any;
  service: any;
  url: string;
  endpoint: string;
  healthEndpoint: string;
  close: () => Promise<void>;
}>;
