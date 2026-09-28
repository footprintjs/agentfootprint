/**
 * arguments/sources — where the MODEL says each argument value came from
 * (`_findings.from`), and the one reader of it.
 *
 * Pattern: Map. The vocabulary of a declared source and one pure reader that
 *          judges the model's `from` array against the call it rides on. The
 *          reader is called by the ONE reader of `_findings`
 *          (`findings/reserved.ts` · `readDeclaration`, under
 *          `.findings({ argumentSources: true })`), so the inputs layer and
 *          ToolCalls' peel read one `_findings` the same way.
 * Role:    core/ layer leaf of the inputs layer (honesty layer 2). Imports
 *          nothing from `findings/` — the folder's one-way law. Small and
 *          synchronous on purpose: the one reader is on every armed agent's
 *          graph; the CHECKS (`checks.ts`) load with the layer.
 * Emits:   N/A.
 *
 * ## What the model may say
 *
 * ```json
 * "_findings": { "basis": "direct",
 *   "from": [ { "argument": "window",  "source": "user",   "quote": "over the last week" },
 *             { "argument": "host",    "source": "result", "id": "toolu_01AbC" },
 *             { "argument": "limit",   "source": "assumed" } ] }
 * ```
 *
 * `user` (+ `quote`, the person's words copied exactly), `result` (+ `id`, a
 * tool_result id), `turn` (the person answered it, when asked, earlier),
 * `app` (the app's own text carries it), `assumed` (the model chose it). A
 * declaration is a CLAIM: the library checks it (`checks.ts` · `checkSource`)
 * and files its verdict beside it; an unchecked claim is never trusted.
 *
 * ## Never repaired
 *
 * An entry is dropped and COUNTED (never defaulted) when it is not an object;
 * its `source` is outside the five; a `user` entry has no string `quote` or a
 * `result` entry no string `id`; its `argument` is not a top-level argument
 * this call carries a value for (a key the call left out, a missing value, or
 * a nested / non-primitive value — not ruled in this version); or an earlier
 * entry already named the same argument (the first wins).
 */

import { isMissing } from './declare.js';

/** Where the model says a value came from. */
export type DeclaredSourceKind = 'user' | 'result' | 'turn' | 'app' | 'assumed';

/** The five, in the order the served schema enumerates them. */
export const DECLARED_SOURCE_KINDS: readonly DeclaredSourceKind[] = Object.freeze([
  'user',
  'result',
  'turn',
  'app',
  'assumed',
]);

/** One `_findings.from` entry, as the reader kept it. */
export interface DeclaredSource {
  /** A top-level argument of the call, carrying a primitive value. */
  readonly argument: string;
  readonly source: DeclaredSourceKind;
  /** `user`: the person's words the value came from, as the model copied them. */
  readonly quote?: string;
  /** `result`: the tool_result id the value came from. */
  readonly id?: string;
}

/** What `readSources` answers: the entries kept, and how many were dropped. */
export interface ReadSources {
  readonly from: readonly DeclaredSource[];
  /** Entries dropped as malformed — `1` for a `from` that is not an array. */
  readonly malformed: number;
}

type PlainObject = Readonly<Record<string, unknown>>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPrimitive = (value: unknown): boolean =>
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

/** One entry, judged against the call's own arguments — `undefined` when malformed. */
function readEntry(raw: unknown, args: PlainObject): DeclaredSource | undefined {
  if (!isPlainObject(raw)) return undefined;
  const { argument, source } = raw;
  if (typeof argument !== 'string') return undefined;
  if (
    typeof source !== 'string' ||
    !(DECLARED_SOURCE_KINDS as readonly string[]).includes(source)
  ) {
    return undefined;
  }
  if (isMissing(args, argument) || !isPrimitive(args[argument])) return undefined;
  const kind = source as DeclaredSourceKind;
  if (kind === 'user') {
    return typeof raw.quote === 'string' ? { argument, source: kind, quote: raw.quote } : undefined;
  }
  if (kind === 'result') {
    return typeof raw.id === 'string' ? { argument, source: kind, id: raw.id } : undefined;
  }
  return { argument, source: kind };
}

/**
 * The model's `from` array for ONE call, judged against the arguments that
 * call carries (`args` — the call's own arguments, `_findings` taken off).
 * Each entry that cannot be read is dropped and counted; nothing is defaulted
 * and nothing is inferred. A `from` that is not an array reads as nothing,
 * one malformed.
 *
 * @example
 * ```ts
 * readSources([{ argument: 'window', source: 'user', quote: 'the last week' }], { window: '7d' });
 * // { from: [{ argument: 'window', source: 'user', quote: 'the last week' }], malformed: 0 }
 * readSources([{ argument: 'window', source: 'user' }], { window: '7d' });   // no quote
 * // { from: [], malformed: 1 }
 * ```
 */
export function readSources(raw: unknown, args: PlainObject): ReadSources {
  if (!Array.isArray(raw)) return { from: [], malformed: 1 };
  const from: DeclaredSource[] = [];
  const named = new Set<string>();
  let malformed = 0;
  for (const item of raw) {
    const entry = readEntry(item, args);
    if (entry === undefined || named.has(entry.argument)) {
      malformed += 1;
      continue;
    }
    named.add(entry.argument);
    from.push(entry);
  }
  return { from, malformed };
}

/**
 * One call's declared sources, as the inputs layer is handed them (the mount
 * reads each call's raw `_findings` through the one reader). `malformed` is
 * set only when the call files NO basis row — that row carries the count
 * otherwise (`findings/ledger.ts` · `basisRowFrom`) — so the call's first
 * argument row carries it and the count is never lost.
 */
export interface CallSources {
  readonly toolCallId: string;
  readonly from: readonly DeclaredSource[];
  readonly malformed?: number;
}
