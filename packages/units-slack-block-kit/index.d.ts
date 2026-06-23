export type SlackBlockKitWarning = {
  code: string;
  message: string;
  tag?: string;
};

export type UnitsToSlackBlockKitOptions = {
  scope?: Record<string, any>;
  slots?: Record<string, any>;
  set?: (...args: any[]) => any;
  evalExpr?: (raw: string, scope: any, locals?: any) => any;
  strict?: boolean;
  fallbackText?: string;
  parseUnits?: (source: string) => any;
};

export type UnitsToSlackBlockKitResult = {
  payload: Record<string, any>;
  blocks: any[];
  ast?: any;
  tree: any;
  warnings: SlackBlockKitWarning[];
};

export function compileUnitsToSlackBlockKit(
  input: string | any,
  options?: UnitsToSlackBlockKitOptions,
): UnitsToSlackBlockKitResult;

export function unitsToSlackBlockKit(
  input: string | any,
  options?: UnitsToSlackBlockKitOptions,
): Record<string, any>;

export function unitsAstToSlackBlockKit(
  ast: any,
  options?: UnitsToSlackBlockKitOptions,
): Record<string, any>;

export function unitsTreeToSlackBlockKit(
  tree: any,
  options?: UnitsToSlackBlockKitOptions,
): Record<string, any>;

export function parseUnitsToSlackBlockKit(
  source: string,
  options?: UnitsToSlackBlockKitOptions,
): UnitsToSlackBlockKitResult;

export function serializeSlackMrkdwn(value: any, options?: UnitsToSlackBlockKitOptions): string;

export default unitsToSlackBlockKit;
