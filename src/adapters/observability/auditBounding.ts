/**
 * auditBounding — HOW the audit chain's bounded mode bounds a value: the
 * markers, the sanitizer, the leaves and the combinators every shape is built
 * from (`auditShapes.ts` says WHAT each event keeps; `auditKeptByContract.ts`
 * names what a record keeps although it may carry a run's value).
 *
 * Pattern: small pure rules composed into shapes; every rule records what it is
 *          (`ruleKind`), so a test can walk a shape beside the type it bounds
 *          and hand every rule what its kind forbids.
 * Role:    the bounding layer `auditExport({ payloadMode: 'bounded' })` runs
 *          every payload and every record's meta through (`audit.ts`). No I/O,
 *          no clock.
 * Emits:   N/A.
 *
 * THE RULE, the one `otel.ts` maps spans by: **structure is kept, content is
 * a marker**, bounding is CLOSED by default, and every kept value is CHECKED:
 *
 *   - Every registered event has a shape that names every field of its
 *     payload type (`shapeOf` is exhaustive by type: a field added to a
 *     payload does not compile until it is classified).
 *   - A field a shape does not name, a value that is not the declared shape,
 *     and every field of an event type the registry does not declare, is a
 *     marker.
 *   - A type says what a field holds; it cannot say what ARRIVES. So nothing is
 *     kept on a type's word: a kept leaf checks at runtime the kind its type
 *     promises — `num` a number, `bool` a boolean, `str` a string, `oneOf` one
 *     of the words it lists — and anything else is a marker. No container is
 *     kept whole: an object is a `shapeOf` (or a `recordOf`), a list a
 *     `listOf`, every child ruled, so a child the type does not declare is a
 *     marker however it got there (structural typing lets an object carry one).
 *     The type walker (`test/type-regressions/AuditBoundingDepth.test.ts`)
 *     holds every rule to the type beneath it; the runtime sweep
 *     (`test/observability-providers/audit-bounded-sweep.test.ts`) hands every
 *     rule what its kind forbids.
 *   - Names are data. A key is kept as an own key of the record, whatever it is
 *     (a name `Object.prototype` holds included: an assignment would drop
 *     `__proto__`, or re-prototype the record), and no rule table is ever asked
 *     for a name it merely inherits.
 *
 * Content becomes `'[N chars]'` (a string), `'[type: …]'` (anything else),
 * `'[keys: …]'` (a free-form record: its key names, never its values), or a
 * count (`'[N messages]'`, `'[N blocks]'`, `'[N summaries]'`). A kept string is
 * capped at 256 characters, a list at 32 items.
 */

import { isErrorValue, wireError } from '../../lib/wireJson.js';

// ─── JSON sanitization (verbatim mode, and the genesis record) ───────

/** Caps mirror otel.ts's bounding discipline (defense-in-depth — the
 *  registry payloads are mostly bounded upstream). */
const MAX_STRING_CHARS = 256;
const MAX_LIST_ITEMS = 32;
const MAX_DEPTH = 8;

/** A string capped like every string the chain keeps. */
function capped(text: string): string {
  return text.length > MAX_STRING_CHARS ? `${text.slice(0, MAX_STRING_CHARS - 1)}…` : text;
}

/**
 * A record whose every key is an OWN data property — `__proto__` included.
 * `out[key] = value` would drop a `__proto__` key whose value is not an object
 * and re-prototype the record when it is; either way the key is lost.
 */
function ownRecord(entries: readonly (readonly [string, unknown])[]): Record<string, unknown> {
  return Object.fromEntries(entries);
}

/**
 * Convert any value to a JSON-safe, size-bounded tree:
 * strings capped, arrays capped with an overflow marker, cycles
 * broken, depth capped, Date → ISO, bigint → string, non-finite →
 * null, functions/symbols/undefined dropped (objects) or null
 * (arrays). Every key an own key. Output always canonicalizes without
 * throwing.
 */
export function sanitizeJson(value: unknown, depth = 0, seen = new Set<object>()): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return capped(value);
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value;
    case 'bigint':
      return String(value);
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    default:
      break;
  }

  const obj = value as object;
  if (obj instanceof Date) return obj.toISOString();
  // The wire rule (`lib/wireJson.ts`): name, message, code, cause — never an
  // Error's custom properties (an axios error's request headers).
  if (isErrorValue(obj)) return sanitizeJson(wireError(obj), depth, seen);
  if (depth >= MAX_DEPTH) return '[truncated: depth]';
  if (seen.has(obj)) return '[circular]';
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const list = obj.slice(0, MAX_LIST_ITEMS).map((item) => {
        const sanitized = sanitizeJson(item, depth + 1, seen);
        return sanitized === undefined ? null : sanitized;
      });
      if (obj.length > MAX_LIST_ITEMS) list.push(`…+${obj.length - MAX_LIST_ITEMS} more`);
      return list;
    }
    const entries: (readonly [string, unknown])[] = [];
    for (const [key, entry] of Object.entries(obj)) {
      const sanitized = sanitizeJson(entry, depth + 1, seen);
      if (sanitized !== undefined) entries.push([key, sanitized]);
    }
    return ownRecord(entries);
  } finally {
    seen.delete(obj);
  }
}

// ─── What a rule is ──────────────────────────────────────────────────

/** How the bounded mode writes one value. */
export type BoundRule = (value: unknown) => unknown;

/** The kind of a value, as a rule checks it at runtime. */
export type ValueKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';

/** A value's kind — `undefined` for one JSON has no word for (a function, a symbol, a bigint). */
export function valueKindOf(value: unknown): ValueKind | undefined {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return undefined;
  }
}

/**
 * What a rule is, so a test can walk a shape beside the type it bounds and
 * hand each rule what its kind forbids. Every rule this module builds has one;
 * a function it did not build has none, and the walkers refuse it.
 */
export type RuleKind =
  /** Keeps nothing of the value: its length, its key names, its type or its count. */
  | { readonly kind: 'marker'; readonly marks: 'chars' | 'keys' | 'type' | 'count' }
  /** Keeps a value of this one kind (a string capped); anything else is a marker. */
  | { readonly kind: 'leaf'; readonly accepts: 'number' | 'boolean' | 'string' }
  /** Keeps a value that is one of these words; anything else is a marker. */
  | { readonly kind: 'oneOf'; readonly values: ReadonlySet<string | number | boolean> }
  /** An object: each named field by its rule, any other field a marker. */
  | { readonly kind: 'shape'; readonly fields: ReadonlyMap<string, BoundRule> }
  /** A list: each item by the rule. */
  | { readonly kind: 'list'; readonly item: BoundRule }
  /** An object with open keys: every key kept, every value by the rule. */
  | { readonly kind: 'record'; readonly value: BoundRule }
  /** One value or a list of them, each by the rule. */
  | { readonly kind: 'orList'; readonly item: BoundRule }
  /** `null` kept; anything else by the rule. */
  | { readonly kind: 'nullOr'; readonly inner: BoundRule }
  /** The first alternative that accepts the value's kind; none, a marker. */
  | { readonly kind: 'either'; readonly alternatives: readonly BoundRule[] }
  /** One rule or another, by a test of the value — the reason written down. */
  | {
      readonly kind: 'when';
      readonly why: string;
      readonly then: BoundRule;
      readonly otherwise: BoundRule;
    }
  /** A position the record keeps although it may carry a run's value — named (`auditKeptByContract.ts`). */
  | { readonly kind: 'byContract'; readonly exception: string; readonly inner: BoundRule };

const KINDS = new WeakMap<BoundRule, RuleKind>();
const described = <R extends BoundRule>(rule: R, kind: RuleKind): R => {
  KINDS.set(rule, kind);
  return rule;
};

/** What a rule is — `undefined` only for a function this module did not build. */
export function ruleKind(rule: BoundRule): RuleKind | undefined {
  return KINDS.get(rule);
}

/**
 * The value kinds a rule KEEPS something of at its own position — what
 * `either` dispatches on. A marker accepts none: it keeps nothing of any value.
 *
 * @internal
 */
export function acceptedKinds(rule: BoundRule): ReadonlySet<ValueKind> {
  const k = KINDS.get(rule);
  switch (k?.kind) {
    case 'leaf':
      return new Set([k.accepts]);
    case 'oneOf':
      return new Set([...k.values].map((value) => valueKindOf(value) as ValueKind));
    case 'shape':
    case 'record':
      return new Set(['object']);
    case 'list':
      return new Set(['array']);
    case 'orList':
      return new Set<ValueKind>(['array', ...acceptedKinds(k.item)]);
    case 'nullOr':
      return new Set<ValueKind>(['null', ...acceptedKinds(k.inner)]);
    case 'either':
      return new Set(k.alternatives.flatMap((alternative) => [...acceptedKinds(alternative)]));
    case 'when':
      return new Set([...acceptedKinds(k.then), ...acceptedKinds(k.otherwise)]);
    case 'byContract':
      return acceptedKinds(k.inner);
    default:
      return new Set();
  }
}

// ─── Markers — keep nothing of the value ─────────────────────────────

export function typeofOf(value: unknown): string {
  return value === null ? 'null' : typeof value;
}

/** `'[23 chars]'` — length evidence without content. */
export function charsMarker(value: unknown): string {
  return typeof value === 'string' ? `[${value.length} chars]` : `[type: ${typeofOf(value)}]`;
}

/** `'[keys: a, b, c]'` — shape evidence for free-form Records. */
export function keysMarker(value: unknown): string {
  if (value === null || typeof value !== 'object') return `[type: ${typeofOf(value)}]`;
  const keys = Object.keys(value as object).slice(0, MAX_LIST_ITEMS);
  return `[keys: ${keys.join(', ')}]`;
}

/** `'[type: object]'` — what kind of value, nothing of it (a tool's result). */
export const typeMarker: BoundRule = (value) => `[type: ${typeofOf(value)}]`;

/** A list's length, in the words of what it holds; anything else by `charsMarker`. */
const countMarker = (noun: string): BoundRule =>
  described((value) => (Array.isArray(value) ? `[${value.length} ${noun}]` : charsMarker(value)), {
    kind: 'marker',
    marks: 'count',
  });

described(charsMarker, { kind: 'marker', marks: 'chars' });
described(keysMarker, { kind: 'marker', marks: 'keys' });
described(typeMarker, { kind: 'marker', marks: 'type' });

/** `'[3 messages]'` — a conversation's history. */
export const messagesMarker = countMarker('messages');
/** `'[2 blocks]'` — the model's thinking blocks. */
export const blocksMarker = countMarker('blocks');
/** `'[4 summaries]'` — the previews of what a slot dropped. */
export const summariesMarker = countMarker('summaries');

// ─── Leaves — a value of the declared kind, checked ──────────────────

/** A count, a duration, a score, an index: kept when it IS a number (non-finite as `null`). */
export const num: BoundRule = described(
  (value) =>
    typeof value === 'number' ? (Number.isFinite(value) ? value : null) : charsMarker(value),
  { kind: 'leaf', accepts: 'number' },
);

/** A flag or a verdict: kept when it IS a boolean. */
export const bool: BoundRule = described(
  (value) => (typeof value === 'boolean' ? value : charsMarker(value)),
  { kind: 'leaf', accepts: 'boolean' },
);

/**
 * The record's own word — an id, a name, a code, a label the app declared: kept
 * when it IS a string, capped. Where the type is a closed union of words, use
 * `oneOf`, which keeps only those words.
 */
export const str: BoundRule = described(
  (value) => (typeof value === 'string' ? capped(value) : charsMarker(value)),
  { kind: 'leaf', accepts: 'string' },
);

/**
 * One of the listed words (or numbers, or booleans): kept when the value IS one
 * of them — so what it keeps is always a word this table wrote. Anything else
 * is a marker.
 */
export function oneOf(...values: readonly (string | number | boolean)[]): BoundRule {
  const words = new Set(values);
  return described((value) => (words.has(value as string) ? value : charsMarker(value)), {
    kind: 'oneOf',
    values: new Set(words),
  });
}

// ─── Combinators — each records what it is ───────────────────────────

/**
 * Every key of `T` — of EVERY member when `T` is a union. `keyof` of a union is
 * only the keys all members share, so a field one member alone carries would
 * escape the shape's exhaustiveness.
 */
export type AnyKeyOf<T> = T extends unknown ? keyof T : never;

/**
 * An object of a known shape, every field ruled (exhaustive by type, so a field
 * added to `T` does not compile until it is). A field the rules do not name is
 * a marker: whatever the value carries at runtime is bounded until someone
 * decides it is the record's own words. Anything but an object is a marker too.
 */
export function shapeOf<T>(rules: { readonly [K in AnyKeyOf<T>]-?: BoundRule }): BoundRule {
  const byField: ReadonlyMap<string, BoundRule> = new Map(
    Object.entries(rules as Readonly<Record<string, BoundRule>>),
  );
  return described(
    (value) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return charsMarker(value);
      }
      const entries: (readonly [string, unknown])[] = [];
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) continue; // absent, as JSON has it
        const bounded = (byField.get(key) ?? charsMarker)(entry);
        if (bounded !== undefined) entries.push([key, bounded]);
      }
      return ownRecord(entries);
    },
    { kind: 'shape', fields: new Map(byField) },
  );
}

/** A list: each entry by `rule`, capped at 32 like every list. Anything else is a marker. */
export function listOf(rule: BoundRule): BoundRule {
  return described(
    (value) => {
      if (!Array.isArray(value)) return charsMarker(value);
      const out: unknown[] = [];
      for (let i = 0; i < Math.min(value.length, MAX_LIST_ITEMS); i++) {
        out.push(rule(value[i]) ?? null);
      }
      if (value.length > MAX_LIST_ITEMS) out.push(`…+${value.length - MAX_LIST_ITEMS} more`);
      return out;
    },
    { kind: 'list', item: rule },
  );
}

/** A map with open keys: every key kept (a key is a name), every value by `rule`. Anything else is a marker. */
export function recordOf(rule: BoundRule): BoundRule {
  return described(
    (value) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return charsMarker(value);
      }
      const entries: (readonly [string, unknown])[] = [];
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) continue;
        const bounded = rule(entry);
        if (bounded !== undefined) entries.push([key, bounded]);
      }
      return ownRecord(entries);
    },
    { kind: 'record', value: rule },
  );
}

/** One value, or a list of them, each by `rule` — a guard's declared value is either. */
export function orList(rule: BoundRule): BoundRule {
  const list = listOf(rule);
  return described((value) => (Array.isArray(value) ? list(value) : rule(value)), {
    kind: 'orList',
    item: rule,
  });
}

/** `null` stays `null` (a declared "none"); anything else by `rule`. */
export function nullOr(rule: BoundRule): BoundRule {
  return described((value) => (value === null ? null : rule(value)), {
    kind: 'nullOr',
    inner: rule,
  });
}

/**
 * A value of one of several kinds — a library word or a window, a facet word or
 * a filter: the first alternative that accepts the value's kind bounds it. A
 * value no alternative accepts is a marker.
 */
export function either(...alternatives: readonly BoundRule[]): BoundRule {
  const accepting = alternatives.map((alternative) => ({
    rule: alternative,
    kinds: acceptedKinds(alternative),
  }));
  return described(
    (value) => {
      const kind = valueKindOf(value);
      const chosen =
        kind === undefined ? undefined : accepting.find((alt) => alt.kinds.has(kind))?.rule;
      return (chosen ?? charsMarker)(value);
    },
    { kind: 'either', alternatives: [...alternatives] },
  );
}

/**
 * One rule or another, by a test of the value itself, the reason written down —
 * the few places a field is structure only for some values (a name this
 * strategy has seen run, the engine's own decision evidence).
 */
export function when(
  why: string,
  test: (value: unknown) => boolean,
  then: BoundRule,
  otherwise: BoundRule,
): BoundRule {
  return described((value) => (test(value) ? then : otherwise)(value), {
    kind: 'when',
    why,
    then,
    otherwise,
  });
}

/**
 * A position a bounded record keeps although its value may come from the run —
 * one of the exceptions `auditKeptByContract.ts` names, in one place. The rule
 * inside still checks the value like every other: an exception keeps a value of
 * its declared kind, never whatever arrives.
 */
export function byContract(exception: string, rule: BoundRule): BoundRule {
  return described((value) => rule(value), { kind: 'byContract', exception, inner: rule });
}

/** An event type the registry does not declare (a consumer's own `emit`): every field a marker. */
export const unknownEventShape: BoundRule = shapeOf<Readonly<Record<string, unknown>>>({});

// ─── The tools this strategy has seen run ────────────────────────────

/** Names kept, and calls awaiting their end — each bounded, names and ids only. */
const MAX_TOOL_NAMES = 1024;
const MAX_OPEN_CALLS = 1024;

/**
 * Tool names this strategy has seen RUN — a `stream.tool_end` without `error`,
 * `notExecuted` or `notDispatched`, matched to its `tool_start` by
 * `toolCallId` — so a tool this agent holds, by construction. What a
 * `tryInsteadTool` name is recognized against (`otel.ts` keeps the same set).
 */
export function createToolRunTracker(): {
  observe(type: string, payload: unknown): void;
  ran(name: string): boolean;
} {
  const open = new Map<string, string>();
  const ran = new Set<string>();
  return {
    observe(type, payload) {
      if (payload === null || typeof payload !== 'object') return;
      const p = payload as {
        toolCallId?: unknown;
        toolName?: unknown;
        error?: unknown;
        notExecuted?: unknown;
        notDispatched?: unknown;
      };
      if (typeof p.toolCallId !== 'string' || p.notDispatched !== undefined) return;
      if (type === 'agentfootprint.stream.tool_start' && typeof p.toolName === 'string') {
        if (open.size >= MAX_OPEN_CALLS) {
          const [oldest] = open.keys();
          if (oldest !== undefined) open.delete(oldest);
        }
        open.set(p.toolCallId, p.toolName);
        return;
      }
      if (type !== 'agentfootprint.stream.tool_end') return;
      const name = open.get(p.toolCallId);
      open.delete(p.toolCallId);
      const failed = p.error !== undefined && p.error !== false;
      if (name === undefined || failed || p.notExecuted === true) return;
      if (ran.size < MAX_TOOL_NAMES || ran.has(name)) ran.add(name);
    },
    ran: (name) => ran.has(name),
  };
}
