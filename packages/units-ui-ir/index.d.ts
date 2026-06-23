export type UiNode = {
  id: string;
  role: string;
  name: string;
  text: string;
  props: Record<string, any>;
  state: Record<string, any>;
  actions: string[];
  children: UiNode[];
  meta: Record<string, any>;
};

export type CompactSerializeOptions = {
  includeProps?: boolean;
  includeMeta?: boolean;
  includeIds?: boolean;
  includeTextIds?: boolean;
  includeState?: boolean;
  includeRedundantNameText?: boolean;
  includeImplicitActions?: boolean;
};

export function inferRoleFromTag(tagName: any, explicitRole?: any): string;

export function normalizeUiNode(node: any, defaults?: Partial<UiNode>): UiNode;
export function normalizeDomUiTree(input: any): UiNode;
export function normalizeA11yUiTree(input: any): UiNode;
export function normalizeSlackBlockKitTree(input: any, options?: { id?: string }): UiNode;
export function parseSlackMrkdwn(text: any, options?: { path?: any[] }): UiNode[];
export function normalizeUiTree(input: any, sourceType?: string): UiNode;

export function serializeCompactUiTree(uiTree: any, options?: CompactSerializeOptions): any;

export { normalizeUiNode as normalizeIrNode };
export { normalizeDomUiTree as normalizeDomTree };
export { normalizeA11yUiTree as normalizeA11yTree };
export { normalizeSlackBlockKitTree as normalizeSlackTree };
export { serializeCompactUiTree as serializeAgentTree };
