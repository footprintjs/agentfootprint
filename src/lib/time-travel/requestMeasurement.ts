/** Counts only: the initial prepared request at the library's provider port.
 * No token estimate, payload retention, retry total or vendor wire claim. */
export interface RequestJsonSize {
  /** UTF-16 code units in the JSON representation, including JSON punctuation. */
  readonly jsonChars: number;
  /** UTF-8 bytes in that same JSON representation. */
  readonly jsonBytes: number;
}

type MeasurementBoundary = {
  readonly boundary: 'initial-prepared-request';
  readonly format: 'json-utf8-v1';
};

/** Sizes describe JSON of the canonical request, excluding its root `signal`.
 * Slot values are serialized separately and do not sum to the request total.
 * Missing slots were absent/undefined; an empty array still has JSON size. */
export type RequestMeasurement = MeasurementBoundary &
  (
    | {
        readonly status: 'measured';
        readonly total: RequestJsonSize;
        readonly slots: {
          readonly systemPrompt?: RequestJsonSize;
          readonly messages?: RequestJsonSize;
          readonly tools?: RequestJsonSize;
        };
      }
    | {
        readonly status: 'unavailable';
        readonly reason: 'unsupported-value' | 'cyclic-value' | 'measurement-limit';
      }
  );

const boundary: MeasurementBoundary = {
  boundary: 'initial-prepared-request',
  format: 'json-utf8-v1',
};
const CYCLIC = Symbol('cyclic');
const UNSUPPORTED = Symbol('unsupported');
const LIMIT = Symbol('limit');
const MAX_VALUES = 100_000;
const MAX_CHARS = 4_000_000;
const MAX_DEPTH = 64;

/** Internal receipt helper. Read plain data through descriptors so telemetry
 * does not invoke getters or custom toJSON. Unsupported values fail open with
 * a reason code, never exception text. Transport adapters remain authoritative
 * for what they actually serialize; this helper does not validate requests. */
export function measureRequest(request: unknown): RequestMeasurement {
  const active = new Set<object>();
  let visited = 0;
  let chars = 0;
  const countChars = (length: number) => {
    chars += length;
    if (chars > MAX_CHARS) throw LIMIT;
  };
  const copy = (value: unknown, depth = 0): unknown => {
    if (++visited > MAX_VALUES) throw LIMIT;
    if (value === null || typeof value !== 'object') {
      if (['bigint', 'function', 'symbol'].includes(typeof value)) throw UNSUPPORTED;
      if (typeof value === 'string') countChars(value.length);
      return value;
    }
    if (active.has(value)) throw CYCLIC;
    if (depth >= MAX_DEPTH) throw LIMIT;
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) {
      throw UNSUPPORTED;
    }
    if (
      Object.hasOwn(value, 'toJSON') ||
      Object.hasOwn(Object.prototype, 'toJSON') ||
      (array && Object.hasOwn(Array.prototype, 'toJSON'))
    )
      throw UNSUPPORTED;
    active.add(value);
    let result: unknown;
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
      if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0)
        throw UNSUPPORTED;
      if (length > MAX_VALUES - visited) throw LIMIT;
      // JSON reads inherited indexed values at holes; we decline them rather
      // than invoking accessors or silently measuring a different array.
      if (
        [Array.prototype, Object.prototype].some((parent) =>
          Object.getOwnPropertyNames(parent).some((key) => /^(0|[1-9]\d*)$/.test(key)),
        )
      )
        throw UNSUPPORTED;
      const items: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (descriptor && !('value' in descriptor)) throw UNSUPPORTED;
        items.push(copy(descriptor?.value, depth + 1));
      }
      result = items;
    } else {
      const keys = Object.getOwnPropertyNames(value);
      if (keys.length > MAX_VALUES - visited) throw LIMIT;
      const object: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        if (depth === 0 && key === 'signal') continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) throw UNSUPPORTED;
        if (!descriptor.enumerable) continue;
        if (!('value' in descriptor)) throw UNSUPPORTED;
        countChars(key.length);
        object[key] = copy(descriptor.value, depth + 1);
      }
      result = object;
    }
    active.delete(value);
    return result;
  };

  try {
    if (request === null || typeof request !== 'object' || Array.isArray(request))
      throw UNSUPPORTED;
    const snapshot = copy(request) as Record<string, unknown>;
    const size = (value: unknown): RequestJsonSize => {
      const json = JSON.stringify(value);
      if (json.length > MAX_CHARS) throw LIMIT;
      return { jsonChars: json.length, jsonBytes: new TextEncoder().encode(json).byteLength };
    };
    const slots: {
      systemPrompt?: RequestJsonSize;
      messages?: RequestJsonSize;
      tools?: RequestJsonSize;
    } = {};
    for (const key of ['systemPrompt', 'messages', 'tools'] as const) {
      if (snapshot[key] !== undefined) slots[key] = size(snapshot[key]);
    }
    return { ...boundary, status: 'measured', total: size(snapshot), slots };
  } catch (error) {
    return {
      ...boundary,
      status: 'unavailable',
      reason:
        error === CYCLIC
          ? 'cyclic-value'
          : error === LIMIT
          ? 'measurement-limit'
          : 'unsupported-value',
    };
  }
}
