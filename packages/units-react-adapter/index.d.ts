import type { UiNode } from "@botfather/units-ui-ir";

export type NormalizeReactOptions = {
  includeComponentNames?: boolean;
};

export function isReactElementLike(value: any): boolean;

export function normalizeReactNode(
  input: any,
  path: number[],
  options?: NormalizeReactOptions,
): UiNode | null;

export function normalizeReactTree(input: any, options?: NormalizeReactOptions): UiNode;

export { normalizeReactTree as reactElementToUiNode };
