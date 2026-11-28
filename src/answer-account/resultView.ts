import { strip } from '../semantics/coverage/read.js';

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** Interpret which served channel the whole recording actually holds. */
export function modelResultView(result: unknown, modelResult: unknown) {
  return deepEqual(strip(result), modelResult) ? 'model-result-record-only' : 'model-result';
}
