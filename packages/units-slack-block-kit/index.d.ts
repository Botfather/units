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

export type StructuredSlackValidationIssue = {
  path: string;
  message: string;
};

export type StructuredSlackValidationResult = {
  ok: boolean;
  errors: StructuredSlackValidationIssue[];
  warnings: StructuredSlackValidationIssue[];
};

export type StructuredSlackOption = {
  text: string;
  value: string;
  description?: string;
};

export type StructuredSlackNode = {
  type: string;
  text?: string;
  name?: string;
  blockId?: string;
  actionId?: string;
  style?: "primary" | "danger";
  value?: string;
  href?: string;
  url?: string;
  src?: string;
  imageUrl?: string;
  alt?: string;
  title?: string;
  label?: string;
  hint?: string;
  placeholder?: string;
  userId?: string;
  channelId?: string;
  userGroupId?: string;
  timestamp?: string;
  format?: string;
  fallback?: string;
  special?: "here" | "channel" | "everyone";
  optional?: boolean;
  multiline?: boolean;
  options?: StructuredSlackOption[];
  fields?: StructuredSlackNode[];
  accessory?: StructuredSlackNode;
  element?: StructuredSlackNode;
  elements?: StructuredSlackNode[];
  children?: Array<string | StructuredSlackNode>;
  payload?: Record<string, any>;
  props?: Record<string, any>;
};

export type StructuredSlackMessage = {
  type: "SlackMessage";
  channel?: string;
  text?: string;
  username?: string;
  threadTs?: string;
  blocks: StructuredSlackNode[];
  props?: Record<string, any>;
};

export const SLACK_UNITS_STRUCTURED_OUTPUT_SCHEMA: {
  name: string;
  strict: boolean;
  schema: Record<string, any>;
};

export const SLACK_UNITS_JSON_SCHEMA: Record<string, any>;

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

export function validateStructuredSlack(input: any): StructuredSlackValidationResult;

export function structuredSlackToUnitsTree(input: StructuredSlackMessage): any;

export function compileStructuredSlackToBlockKit(
  input: StructuredSlackMessage,
  options?: UnitsToSlackBlockKitOptions,
): UnitsToSlackBlockKitResult & { validation: StructuredSlackValidationResult };

export function structuredSlackToBlockKit(
  input: StructuredSlackMessage,
  options?: UnitsToSlackBlockKitOptions,
): Record<string, any>;

export function serializeSlackMrkdwn(value: any, options?: UnitsToSlackBlockKitOptions): string;

export default unitsToSlackBlockKit;
