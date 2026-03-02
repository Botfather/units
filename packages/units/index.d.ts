export function parseUnits(input: string): any;
export function formatUnits(source: string): string;
export function createUnitsEvaluator(): (raw: string, scope: any, locals?: any) => any;
export function renderUnits(ast: any, scope: any, options?: any): any;
export function createUnitsRenderer(host: any): { render: (ast: any, scope: any, options?: any) => any };
export function findChangedRange(prev: string, next: string): { start: number; endPrev: number; endNext: number };
export function findSmallestEnclosingNode(ast: any, start: number, end: number): any;
export function incrementalParse(prevAst: any, prevSource: string, nextSource: string): any;
