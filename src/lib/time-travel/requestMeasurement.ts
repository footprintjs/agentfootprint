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

/**
 * One message object as {@link measureRequest} measured it at a request's
 * `messages[i]` — the counts its walk added and its JSON size, so a later call
 * that hands the same message adds the counts instead of walking it again.
 * Kept only for a walk that raised nothing (a value the walk refuses is walked
 * again, and refused again, every call).
 */
export interface MessageMeasure {
  /** Values the walk visited inside this message, the message included. */
  readonly visited: number;
  /** Characters the walk counted inside it (string values and keys). */
  readonly chars: number;
  /** The highest value-budget demand its walk made, relative to the count it
   *  started from — `visited` plus the largest array/object it sized up front. */
  readonly need: number;
  /** Its JSON, as one array element: UTF-16 code units and UTF-8 bytes. */
  readonly json: RequestJsonSize;
}

/** Where {@link measureRequest} keeps a message's measurement across the calls
 *  of one run — the receipt memo (`receiptDigests.ts`) is the one owner. */
export interface MessageMeasureCache {
  measureOf(message: object): MessageMeasure | undefined;
  keep(message: object, measure: MessageMeasure): void;
}

/** Internal receipt helper. Read plain data through descriptors so telemetry
 * does not invoke getters or custom toJSON. Unsupported values fail open with
 * a reason code, never exception text. Transport adapters remain authoritative
 * for what they actually serialize; this helper does not validate requests.
 *
 * INCREMENTAL. The request's `messages` are measured one element at a time and
 * the sizes composed (`[` + elements joined by `,` + `]`, spliced into the rest
 * of the request) — JSON is compositional, so the sum IS the size of the whole.
 * With a `cache`, a message object already measured this run adds its kept
 * counts and size instead of being walked again: an agent's request at call k
 * is call k−1's plus what the loop appended, and measuring it whole every call
 * grew with the square of the iteration count. Every limit is checked against
 * the same running counts as a whole walk, so the result — `measured` or the
 * reason it is `unavailable` — is the one the whole walk gives; pinned by
 * test/lib/time-travel/receipt-incremental.test.ts. A cache hit assumes what
 * the receipt memo assumes: the message's nested values were not edited in
 * place (`receiptDigests.ts`). */
export function measureRequest(request: unknown, cache?: MessageMeasureCache): RequestMeasurement {
  const active = new Set<object>();
  let visited = 0;
  let chars = 0;
  // The highest value-budget demand any check has made — what a kept message
  // replays as `need` (every LIMIT check on values is `demand > MAX_VALUES`).
  let peak = 0;
  const demand = (amount: number) => {
    if (amount > peak) peak = amount;
    if (amount > MAX_VALUES) throw LIMIT;
  };
  const countChars = (length: number) => {
    chars += length;
    if (chars > MAX_CHARS) throw LIMIT;
  };
  const copy = (value: unknown, depth = 0): unknown => {
    demand(++visited);
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
      const items: unknown[] = [];
      eachItem(value, (item) => items.push(copy(item, depth + 1)));
      result = items;
    } else {
      const keys = Object.getOwnPropertyNames(value);
      demand(visited + keys.length);
      const object: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        if (depth === 0 && key === 'signal') continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) throw UNSUPPORTED;
        if (!descriptor.enumerable) continue;
        if (!('value' in descriptor)) throw UNSUPPORTED;
        countChars(key.length);
        object[key] =
          depth === 0 && key === 'messages' && Array.isArray(descriptor.value)
            ? copyMessages(descriptor.value)
            : copy(descriptor.value, depth + 1);
      }
      result = object;
    }
    active.delete(value);
    return result;
  };
  /** Visit an array's elements as JSON reads them — length and holes checked
   *  first, each index's descriptor checked just before its element is. */
  const eachItem = (value: readonly unknown[], visit: (item: unknown) => void): number => {
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0)
      throw UNSUPPORTED;
    demand(visited + length);
    // JSON reads inherited indexed values at holes; we decline them rather
    // than invoking accessors or silently measuring a different array.
    if (
      [Array.prototype, Object.prototype].some((parent) =>
        Object.getOwnPropertyNames(parent).some((key) => /^(0|[1-9]\d*)$/.test(key)),
      )
    )
      throw UNSUPPORTED;
    for (let i = 0; i < length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (descriptor && !('value' in descriptor)) throw UNSUPPORTED;
      visit(descriptor?.value);
    }
    return length;
  };
  /** The request's `messages` (depth 1): walked like any array, but sized per
   *  element and returned as their composed JSON size — see the header. */
  const copyMessages = (value: unknown[]): Composed => {
    // `copy`'s own preamble for an array at depth 1.
    demand(++visited);
    if (active.has(value)) throw CYCLIC;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Array.prototype) throw UNSUPPORTED;
    if (
      Object.hasOwn(value, 'toJSON') ||
      Object.hasOwn(Object.prototype, 'toJSON') ||
      Object.hasOwn(Array.prototype, 'toJSON')
    )
      throw UNSUPPORTED;
    active.add(value);
    let jsonChars = 0;
    let jsonBytes = 0;
    const length = eachItem(value, (item) => {
      const size = messageSize(item);
      jsonChars += size.jsonChars;
      jsonBytes += size.jsonBytes;
    });
    // `[`, `]` and the commas between elements — one byte each.
    const punctuation = 2 + Math.max(0, length - 1);
    active.delete(value);
    return new Composed({
      jsonChars: jsonChars + punctuation,
      jsonBytes: jsonBytes + punctuation,
    });
  };
  /** One element of `messages` (depth 2): replayed from the cache, or walked. */
  const messageSize = (item: unknown): RequestJsonSize => {
    const cacheable = cache !== undefined && item !== null && typeof item === 'object';
    const kept = cacheable ? cache.measureOf(item) : undefined;
    if (kept !== undefined) {
      demand(visited + kept.need);
      visited += kept.visited;
      countChars(kept.chars);
      return kept.json;
    }
    const startVisited = visited;
    const startChars = chars;
    const outerPeak = peak;
    peak = visited;
    const json = jsonSizeOf(JSON.stringify(copy(item, 2)) ?? 'null');
    const measure: MessageMeasure = {
      visited: visited - startVisited,
      chars: chars - startChars,
      need: peak - startVisited,
      json,
    };
    peak = Math.max(outerPeak, peak);
    if (cacheable) cache.keep(item, measure);
    return measure.json;
  };

  try {
    if (request === null || typeof request !== 'object' || Array.isArray(request))
      throw UNSUPPORTED;
    const snapshot = copy(request) as Record<string, unknown>;
    const size = (value: unknown): RequestJsonSize => {
      if (value instanceof Composed) return limited(value.size);
      return limited(jsonSizeOf(JSON.stringify(value)));
    };
    const slots: {
      systemPrompt?: RequestJsonSize;
      messages?: RequestJsonSize;
      tools?: RequestJsonSize;
    } = {};
    for (const key of ['systemPrompt', 'messages', 'tools'] as const) {
      if (snapshot[key] !== undefined) slots[key] = size(snapshot[key]);
    }
    return { ...boundary, status: 'measured', total: size(totalOf(snapshot)), slots };
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

/** The `messages` slot once measured: its JSON size, never its JSON. */
class Composed {
  constructor(readonly size: RequestJsonSize) {}
}

/** The whole request's JSON size, with a composed `messages` spliced in: the
 *  rest is serialized with `[]` in its place, and the two characters (and two
 *  bytes) of `[]` are swapped for the slot's own size. */
function totalOf(snapshot: Record<string, unknown>): Composed | Record<string, unknown> {
  const messages = snapshot.messages;
  if (!(messages instanceof Composed)) return snapshot;
  const rest = jsonSizeOf(JSON.stringify({ ...snapshot, messages: [] }));
  return new Composed({
    jsonChars: rest.jsonChars - 2 + messages.size.jsonChars,
    jsonBytes: rest.jsonBytes - 2 + messages.size.jsonBytes,
  });
}

function jsonSizeOf(json: string): RequestJsonSize {
  return { jsonChars: json.length, jsonBytes: new TextEncoder().encode(json).byteLength };
}

function limited(size: RequestJsonSize): RequestJsonSize {
  if (size.jsonChars > MAX_CHARS) throw LIMIT;
  return size;
}
