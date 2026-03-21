export type UiInteractionFlags = {
  clickable: boolean;
  input: boolean;
  link: boolean;
  form: boolean;
};

export type UiNode = {
  type: "element" | "text";
  tag?: string;
  tagName?: string;
  role?: string;
  aria?: Record<string, string>;
  dataset?: Record<string, string>;
  classes?: string[];
  styleSummary?: {
    display?: string;
    visibility?: string;
    opacity?: string;
  };
  interactions?: UiInteractionFlags;
  textContent?: string;
  attributes?: Record<string, string>;
  children?: UiNode[];
};

export type SnapshotOptions = {
  rootSelector?: string;
  maxDepth?: number;
  pruneInvisible?: boolean;
  pruneOffscreen?: boolean;
  keepModalOffscreen?: boolean;
  pruneLayoutWrappers?: boolean;
  includeStyleSummary?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
  getComputedStyle?: (node: any) => any;
  getBoundingClientRect?: (node: any) => any;
  documentRef?: any;
  windowRef?: any;
};

export function snapshotUiFromRoot(root: any, options?: SnapshotOptions): UiNode | null;
export function snapshotUi(options?: SnapshotOptions): UiNode | null;

export function captureSnapshotWithPlaywright(options?: {
  url?: string;
  page?: any;
  browserType?: "chromium" | "firefox" | "webkit" | string;
  playwrightModule?: string;
  launchOptions?: any;
  contextOptions?: any;
  pageOptions?: any;
  gotoOptions?: any;
  waitUntil?: string;
  rootSelector?: string;
  snapshotOptions?: SnapshotOptions;
}): Promise<{
  snapshot: UiNode | null;
  metadata: {
    url: string;
    browserType: string;
    rootSelector: string;
  };
}>;
