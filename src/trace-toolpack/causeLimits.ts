import type { TraversalLimits } from 'foottrace/cause';
import type { TraceCauseOptions } from './causeTypes.js';

/** Tool ceilings are deliberately smaller than the reader's absolute ceilings. */
export const CAUSE_TOOL_CAPS = Object.freeze({
  maxNodes: 100,
  maxDepth: 20,
  maxEdges: 1000,
  maxCalls: 1000,
  timeoutMs: 5000,
  maxChars: 16000,
});

const DEFAULTS = {
  maxNodes: 25,
  maxDepth: 6,
  maxEdges: 100,
  maxCalls: 100,
  timeoutMs: 1000,
  maxChars: 8000,
};
const WORK_KEYS = ['maxNodes', 'maxDepth', 'maxEdges', 'maxCalls'] as const;

function data(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) throw new TypeError('cause tools: invalid limits');
  return descriptor.value;
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const chosen = value ?? fallback;
  if (
    typeof chosen !== 'number' ||
    !Number.isSafeInteger(chosen) ||
    chosen < minimum ||
    chosen > maximum
  ) {
    throw new TypeError('cause tools: invalid limits');
  }
  return chosen;
}

function direction(value: unknown, total: Required<TraversalLimits>): TraversalLimits | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  if (Object.keys(value).some((key) => !WORK_KEYS.includes(key as (typeof WORK_KEYS)[number])))
    throw new TypeError();
  const result: Record<string, number> = {};
  for (const key of WORK_KEYS) {
    const field = data(value, key);
    if (field !== undefined)
      result[key] = integer(field, total[key], key === 'maxDepth' ? 0 : 1, total[key]);
  }
  return result;
}

/** Resolve host policy only. Model arguments never enter this resource boundary. */
export function causeLimits(options: TraceCauseOptions = {}) {
  const resolved = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
    resolved[key] = integer(
      data(options, key),
      DEFAULTS[key],
      key === 'maxDepth' ? 0 : key === 'maxChars' ? 512 : 1,
      CAUSE_TOOL_CAPS[key],
    );
  }
  const backward = {
    maxNodes: Math.max(1, Math.floor(resolved.maxNodes * 0.8)),
    maxEdges: Math.max(1, Math.floor(resolved.maxEdges * 0.8)),
    maxCalls: Math.max(1, Math.floor(resolved.maxCalls * 0.8)),
    ...direction(data(options, 'backward'), resolved),
  };
  return {
    ...resolved,
    backward,
    impact: direction(data(options, 'impact'), resolved),
  };
}

export type CauseLimits = ReturnType<typeof causeLimits>;
