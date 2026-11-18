import { generatedWords as WORDS } from './knownStrings/words.js';
import { generatedFields as FIELDS } from './knownStrings/fields.js';
/**
 * Under a policy selecting any name, keepKnownValues serves a fresh plain copy.
 * Numbers, booleans and null pass; strings pass only from closed LIBRARY_WORDS.
 * Other strings are masked, including unknown object keys. Known FIELD_NAMES
 * retain their names; unknown keys share one placeholder entry. Non-plain data
 * is masked. Native state, snapshots and commit logs use footprintjs's own rule.
 */

import type { ABSENCE_NOTE, ABSENCE_NOTE_COMPOSED } from '../semantics/coverage/absent.js';
import type {
  CompletenessGapItem,
  CoveredResult,
  NamesFacetItem,
  SourceGapItem,
  ToolAbsence,
} from '../semantics/coverage/types.js';
import type { FigureDerivation } from '../core/agent/evidence/types.js';
import type { AgentfootprintEventMap, AgentfootprintEventType } from '../events/registry.js';
import type { CursorMoveCause, SkillEdgeKind } from '../injection-engine/skillGraph.js';
import type { GuardOperator } from '../injection-engine/skillGuard.js';
import type { InjectionTrigger } from '../injection-engine/types.js';
import { SERVED_PLACEHOLDER } from './placeholder.js';

// ─── the closed sets, by type ───────────────────────────────────────

type Payloads = AgentfootprintEventMap[AgentfootprintEventType]['payload'];

/**
 * The library's own envelopes inside a loosely typed field (a tool's `result`):
 * `absent()`'s, `coverage()`'s and an `among` miss's items (apart from
 * `CoverageItem`, which they extend). Their names and words are the library's.
 */
type Envelopes = ToolAbsence | CoveredResult | NamesFacetItem | SourceGapItem | CompletenessGapItem;

/** A depth counter for the type walks below (payload types nest a few levels). */
type Next = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, never];

/** Every string literal reachable in `T` — the members of its verdict-word unions. */
type StringLiterals<T, D extends number = 0> = [D] extends [never]
  ? never
  : T extends string
  ? string extends T
    ? never
    : T
  : T extends readonly (infer E)[]
  ? StringLiterals<E, Next[D]>
  : T extends (...args: never[]) => unknown
  ? never
  : T extends object
  ? { [K in keyof T]-?: StringLiterals<T[K], Next[D]> }[keyof T]
  : never;

/** Every field name reachable in `T` — never an index signature's open key. */
type FieldNamesOf<T, D extends number = 0> = [D] extends [never]
  ? never
  : T extends readonly (infer E)[]
  ? FieldNamesOf<E, Next[D]>
  : T extends (...args: never[]) => unknown
  ? never
  : T extends object
  ?
      | (string extends keyof T ? never : keyof T & string)
      | { [K in keyof T]-?: FieldNamesOf<T[K], Next[D]> }[keyof T]
  : never;

/**
 * The library's words its payload types carry as plain `string` — each a
 * closed set in the code that writes it: a slot's ordering, a route's origin,
 * a skill map's node kind, an evidence value's shape, the stop words every
 * provider adapter normalizes to (`adapters/llm/*` · `normalizeStopReason`).
 */
type PlainStringWords =
  | 'history-order'
  | 'registry+injections'
  | 'registry+provider+injections'
  | 'tree'
  | 'entry'
  | 'route'
  | 'model'
  | 'skill'
  | 'predicate'
  | 'identifier'
  | 'number'
  | 'no-read'
  | 'stop'
  | 'tool_use'
  | 'max_tokens';

/** (a) The library's own words. */
export type LibraryWord =
  | AgentfootprintEventType
  | StringLiterals<Payloads>
  | StringLiterals<Envelopes>
  | typeof ABSENCE_NOTE
  | typeof ABSENCE_NOTE_COMPOSED
  | CursorMoveCause
  | SkillEdgeKind
  | GuardOperator
  | FigureDerivation
  | InjectionTrigger['kind']
  | PlainStringWords;

/** The field names of the library's payloads. */
export type FieldName = FieldNamesOf<Payloads> | FieldNamesOf<Envelopes>;

// The generated maps remain checked exactly against LibraryWord and FieldName.
// scripts/gen-known-strings.mjs owns their bounded shards behind this facade.
Object.freeze(WORDS);
Object.freeze(FIELDS);

/** (a) The library's own words — one exported frozen set. */
export const LIBRARY_WORDS: Readonly<Record<string, true>> = WORDS;

/** The field names the library's payload types declare. */
export const FIELD_NAMES: Readonly<Record<string, true>> = FIELDS;

const has = (record: Readonly<Record<string, true>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/** What one string is served as — itself when it is a library word, else the placeholder. */
export function servedString(value: string): string {
  return value === SERVED_PLACEHOLDER || has(WORDS, value) ? value : SERVED_PLACEHOLDER;
}

/** A walk deeper than this is not a record's data: served as the placeholder. */
const MAX_DEPTH = 64;

/**
 * THE RULE — `value` with every string that is not a library word served as
 * the placeholder, at every depth; numbers, booleans and null kept; a key
 * that is not a payload field name checked like any string.
 *
 * Always a FRESH copy of plain data — never the object it was given: each
 * value is read once (a getter is not asked twice), and only own enumerable
 * string keys and array positions are copied, so nothing the walk did not
 * check (a symbol key, a hidden property, a method on a list) rides along.
 */
export function keepKnownValues(value: unknown): unknown {
  return keep(value, 0);
}

function keep(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case 'number':
    case 'boolean':
      return value;
    case 'string':
      return servedString(value);
    case 'object':
      break;
    default:
      // A function, a symbol, a bigint: nothing a record should hold.
      return SERVED_PLACEHOLDER;
  }
  if (depth >= MAX_DEPTH) return SERVED_PLACEHOLDER;
  if (Array.isArray(value)) {
    const list = value as readonly unknown[];
    const length = list.length;
    const items: unknown[] = [];
    for (let i = 0; i < length; i++) items.push(keep(list[i], depth + 1));
    return items;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return SERVED_PLACEHOLDER;
  const record = value as Readonly<Record<string, unknown>>;
  const copy: Record<string, unknown> = {};
  let keptOutKeys = false;
  for (const key of Object.keys(record)) {
    // `__proto__` would set the copy's prototype, not a key: never data a record keeps.
    const servedKey =
      key === '__proto__' ? SERVED_PLACEHOLDER : has(FIELDS, key) ? key : servedString(key);
    if (servedKey === SERVED_PLACEHOLDER) {
      // A key that is data and not known: kept out with its value.
      keptOutKeys = true;
      continue;
    }
    copy[servedKey] = keep(record[key], depth + 1);
  }
  if (keptOutKeys) copy[SERVED_PLACEHOLDER] = SERVED_PLACEHOLDER;
  return copy;
}
