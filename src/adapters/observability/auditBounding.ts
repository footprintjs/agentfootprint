/**
 * auditBounding — HOW the audit chain's bounded mode bounds a value: the
 * markers, the sanitizer, and the combinators every event's shape is built
 * from (`auditShapes.ts` says WHAT each event keeps).
 *
 * Pattern: small pure rules composed into shapes; each composed rule records
 *          what it is (`ruleKind`), so a test can walk a shape beside the type
 *          it bounds.
 * Role:    the bounding layer `auditExport({ payloadMode: 'bounded' })` runs
 *          every payload through (`audit.ts`). No I/O, no clock.
 * Emits:   N/A.
 *
 * THE RULE, the one `otel.ts` maps spans by: **structure is kept, content is
 * a marker**, and bounding is CLOSED by default:
 *
 *   - Every registered event has a shape that names every field of its
 *     payload type, at every depth where text can sit (`shapeOf` is exhaustive
 *     by type: a field added to a payload does not compile until it is
 *     classified).
 *   - A field a shape does not name, a value that is not the declared shape,
 *     and every field of an event type the registry does not declare, is a
 *     marker.
 *   - `kept` only ever sits on a leaf, or on a container that holds no text:
 *     a container that can hold text is spelled out field by field
 *     (`test/type-regressions/AuditBoundingDepth.test.ts` walks every shape
 *     beside its type and refuses a `kept` over text).
 *
 * Content becomes `'[N chars]'` (a string), `'[type: …]'` (anything else),
 * `'[keys: …]'` (a free-form record: its key names, never its values), or a
 * count (`'[N messages]'`, `'[N blocks]'`, `'[N summaries]'`). Structure is
 * kept, sanitized (`sanitizeJson`): strings capped at 256 characters, lists at
 * 32 items, cycles broken.
 */

import { isErrorValue, wireError } from '../../lib/wireJson.js';

// ─── JSON sanitization (both modes) ──────────────────────────────────

/** Caps mirror otel.ts's bounding discipline (defense-in-depth — the
 *  registry payloads are mostly bounded upstream). */
const MAX_STRING_CHARS = 256;
const MAX_LIST_ITEMS = 32;
const MAX_DEPTH = 8;

/**
 * Convert any value to a JSON-safe, size-bounded tree:
 * strings capped, arrays capped with an overflow marker, cycles
 * broken, depth capped, Date → ISO, bigint → string, non-finite →
 * null, functions/symbols/undefined dropped (objects) or null
 * (arrays). Output always canonicalizes without throwing.
 */
export function sanitizeJson(value: unknown, depth = 0, seen = new Set<object>()): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS - 1)}…` : value;
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
      const capped = obj.slice(0, MAX_LIST_ITEMS).map((item) => {
        const sanitized = sanitizeJson(item, depth + 1, seen);
        return sanitized === undefined ? null : sanitized;
      });
      if (obj.length > MAX_LIST_ITEMS) capped.push(`…+${obj.length - MAX_LIST_ITEMS} more`);
      return capped;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(obj)) {
      const sanitized = sanitizeJson(entry, depth + 1, seen);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

// ─── Markers ─────────────────────────────────────────────────────────

/** How the bounded mode writes one value. */
export type BoundRule = (value: unknown) => unknown;

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
const countMarker =
  (noun: string): BoundRule =>
  (value) =>
    Array.isArray(value) ? `[${value.length} ${noun}]` : charsMarker(value);

/** `'[3 messages]'` — a conversation's history. */
export const messagesMarker = countMarker('messages');
/** `'[2 blocks]'` — the model's thinking blocks. */
export const blocksMarker = countMarker('blocks');
/** `'[4 summaries]'` — the previews of what a slot dropped. */
export const summariesMarker = countMarker('summaries');

// ─── Combinators — each records what it is ───────────────────────────

/**
 * What a composed rule is, so a test can walk a shape beside the type it
 * bounds: a shape names each field, a list its item, a record its values, an
 * `orList` a value-or-list, a `nullOr` what a non-null value gets; a `custom`
 * rule decides by value and says why. `kept` and the markers have none.
 */
export type RuleKind =
  | { readonly kind: 'shape'; readonly fields: Readonly<Record<string, BoundRule>> }
  | { readonly kind: 'list'; readonly item: BoundRule }
  | { readonly kind: 'record'; readonly value: BoundRule }
  | { readonly kind: 'orList'; readonly item: BoundRule }
  | { readonly kind: 'nullOr'; readonly inner: BoundRule }
  | { readonly kind: 'custom'; readonly why: string };

const KINDS = new WeakMap<BoundRule, RuleKind>();
const described = <R extends BoundRule>(rule: R, kind: RuleKind): R => {
  KINDS.set(rule, kind);
  return rule;
};

/** @internal — what a composed rule is; `undefined` for `kept` and the markers. */
export function ruleKind(rule: BoundRule): RuleKind | undefined {
  return KINDS.get(rule);
}

/**
 * Every key of `T` — of EVERY member when `T` is a union. `keyof` of a union is
 * only the keys all members share, so a field one member alone carries would
 * escape the shape's exhaustiveness.
 */
export type AnyKeyOf<T> = T extends unknown ? keyof T : never;

/** The record's own words (ids, names, counts, kinds, codes): kept, sanitized. */
export const kept: BoundRule = (value) => sanitizeJson(value);

/**
 * An object of a known shape, every field ruled (exhaustive by type, so a field
 * added to `T` does not compile until it is). A field the rules do not name is
 * a marker: whatever the shape gains at runtime is bounded until someone decides
 * it is the record's own words. Anything but an object is a marker too.
 */
export function shapeOf<T>(rules: { readonly [K in AnyKeyOf<T>]-?: BoundRule }): BoundRule {
  const byField = rules as Readonly<Record<string, BoundRule>>;
  return described(
    (value) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return charsMarker(value);
      }
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) continue; // absent, as JSON has it
        const rule = Object.hasOwn(byField, key) ? byField[key] : undefined;
        const bounded = (rule ?? charsMarker)(entry);
        if (bounded !== undefined) out[key] = bounded;
      }
      return out;
    },
    { kind: 'shape', fields: byField },
  );
}

/** A list: each entry by `rule`, capped like every list (`sanitizeJson`). Anything else is a marker. */
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

/** A map with open keys: every key kept (a key is a name), every value by `rule`. */
export function recordOf(rule: BoundRule): BoundRule {
  const values = shapeOf<Readonly<Record<string, unknown>>>({});
  return described(
    (value) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return values(value);
      }
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) continue;
        const bounded = rule(entry);
        if (bounded !== undefined) out[key] = bounded;
      }
      return out;
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
 * A rule that decides by the value itself, with the reason written down — the
 * few places a field is structure only for some values (a library word, a
 * name this strategy has seen run, the engine's own decision evidence).
 */
export function custom(why: string, rule: BoundRule): BoundRule {
  return described((value) => rule(value), { kind: 'custom', why });
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
