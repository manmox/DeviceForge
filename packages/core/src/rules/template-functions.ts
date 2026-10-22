export interface TemplateFunctionInfo {
  name: string;
  minArgs: number;
  maxArgs: number;
  signature: string;
}

export const TEMPLATE_FUNCTIONS: readonly TemplateFunctionInfo[] = [
  { name: 'random', minArgs: 2, maxArgs: 2, signature: 'random(min, max)' },
  { name: 'randomFloat', minArgs: 2, maxArgs: 2, signature: 'randomFloat(min, max)' },
  { name: 'and', minArgs: 2, maxArgs: 32, signature: 'and(a, b, ...)' },
  { name: 'or', minArgs: 2, maxArgs: 32, signature: 'or(a, b, ...)' },
  { name: 'not', minArgs: 1, maxArgs: 1, signature: 'not(value)' },
];
