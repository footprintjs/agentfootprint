import { nativeIsProxy } from '../lib/nativeProxyCheck.js';
import type { ToolEndPayload } from '../events/payloads.js';

const OMIT = Symbol();
const OPAQUE = new Error('Result is not own data');
const MAX_DEPTH = 64;

/** Only the native clone-capture path needs a projection of a tool result. */
export function prepareNativeEmit(type: string, served: unknown, clones?: boolean): unknown {
  return type === 'agentfootprint.stream.tool_end' && clones === true
    ? prepareToolEndCapture(served)
    : served;
}

/** Preserve the tool-end bracket after serving, even when the result was not data. */
export function prepareToolEndCapture(served: unknown): unknown {
  if (served === null || typeof served !== 'object' || !Object.hasOwn(served, 'result'))
    return served;
  const payload = served as ToolEndPayload;
  const result = captureResult(payload.result);
  const modelResult = Object.is(payload.modelResult, payload.result)
    ? result
    : captureResult(payload.modelResult);
  if (Object.is(result, payload.result) && Object.is(modelResult, payload.modelResult))
    return payload;
  return {
    ...payload,
    result,
    ...(Object.hasOwn(payload, 'modelResult') && { modelResult }),
  };
}

function captureResult(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  try {
    return captureData(value, 0, new WeakMap<object, object>());
  } catch {
    // Preserve the existing typed and wire shape of native or opaque values.
    // If native capture cannot deliver them, its summary accounts for the loss.
    return value;
  }
}

/** Keep JSON's omission of callable fields without calling foreign serializers. */
function captureData(value: unknown, depth: number, inspected: WeakMap<object, object>): unknown {
  if (typeof value === 'function' || typeof value === 'symbol') return OMIT;
  if (value === null || typeof value !== 'object') return value;
  const ready = inspected.get(value);
  if (ready === OPAQUE || depth >= MAX_DEPTH) throw OPAQUE;
  if (ready !== undefined) return ready;
  if (nativeIsProxy?.(value)) throw OPAQUE;
  const proto: unknown = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    throw OPAQUE;
  const serializer = Object.getOwnPropertyDescriptor(value, 'toJSON');
  if (
    serializer !== undefined &&
    (!('value' in serializer) || typeof serializer.value === 'function')
  )
    throw OPAQUE;

  const keys = array ? Object.getOwnPropertyNames(value) : Object.keys(value);
  let changes: Map<string, unknown> | undefined;
  inspected.set(value, OPAQUE);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const before = fieldValue(value, key);
    const next = captureData(before, depth + 1, inspected);
    if (!Object.is(before, next)) (changes ??= new Map()).set(key, next);
  }
  if (changes === undefined) {
    inspected.set(value, value);
    return value;
  }
  const out = array
    ? new Array(fieldValue(value, 'length') as number)
    : (Object.create(proto as object | null) as object);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const data = changes?.has(key) ? changes.get(key) : fieldValue(value, key);
    if (data === OMIT) continue;
    Object.defineProperty(out, key, {
      value: data,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  inspected.set(value, out);
  return out;
}

function fieldValue(value: object, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (field === undefined || !('value' in field) || (!field.enumerable && key !== 'length'))
    throw OPAQUE;
  return field.value;
}
