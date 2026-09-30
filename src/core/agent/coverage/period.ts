/**
 * coverage/period — the ONE period shape a result declares, the ONE rule set
 * every door asks, and the ONE verdict.
 *
 * Pattern: one rule set, every door (the `items.ts` law for `short` and
 *          `kind`): the three mints — `absent()`, `coverage()`,
 *          `describedResult()` — REFUSE a malformed period at the line the
 *          author wrote, and the recognizers READ a period an envelope minted
 *          elsewhere (a Python helper, an older or newer process) without
 *          repairing it. Both ask {@link periodProblem}, so a mint and a read
 *          cannot disagree about what a well-formed period is.
 * Role:    core/ layer leaf of the result doors (honesty layer 3). Imports only
 *          `refusal.ts`, the dev-mode flag and the time layer's one instant
 *          parser (`core/time/instant.ts` · `instantOf`, lenient profile) and its
 *          person-facing renderer (`core/time/present.ts`). The results layer
 *          (`../results/subflow.ts`) files one verdict per call from
 *          {@link periodVerdict}; the limits block prints one line per
 *          declaring call from {@link periodLine}.
 * Emits:   N/A.
 *
 * ## The shape — anchored on the READ
 *
 * ```ts
 * period: {
 *   queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' }, // what the read asked for
 *   held: { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' },    // what the store holds — or 'unknown'
 *   readAt: '2026-09-26T10:00:03Z',                                         // when the read ran (optional)
 * }
 * // on the wire: "period": { "queried": {…}, "held": {…} | "unknown", "read_at"? }
 * ```
 *
 * Every value is an ISO 8601 instant WITH a zone (`Z` or `±HH:MM`) — the
 * library compares instants, and an instant without a zone is ambiguous, so it
 * is refused rather than guessed. `held: 'unknown'` is the store saying out
 * loud that it cannot vouch for what it holds. Nothing here ever parses a
 * duration: the library compares instants the tool declared and never reads
 * "2h" (the inputs layer's `ToolPeriod` says which ARGUMENT set the period;
 * this shape says what the READ covered).
 *
 * ## Why not the word `window`, and why not a coverage item
 *
 * `window` names the context window (`core/agent/window/`, `.window()`). A
 * coverage item's `kind` is a closed, record-only word: it cannot hold two
 * instants to compare.
 */

import { isDevMode } from 'footprintjs';

import { compareInstants, instantOf, type Instant } from '../../time/instant.js';
import type { BoundPresentation } from '../../time/present.js';
import {
  isPeriodDiffers,
  isShifted,
  type PeriodDiffers,
  type SourceClock,
} from '../../time/checkRecord.js';

import { refusal, spellingMeant } from './refusal.js';

// ─── The shape ───────────────────────────────────────────────────────────

/**
 * The period a result declares — what its READ covered — in the camelCase
 * spelling an author writes on `absent()`, `coverage()` and
 * `describedResult()`, and the record keeps (the `coverageDeclared` row, the
 * `tools.absent` / `tools.coverage_declared` events). The wire spells it
 * snake_case (`read_at`).
 *
 * @example
 * ```ts
 * absent({
 *   what: 'failed backup runs for host-103',
 *   checked: ['every job in the 02:00 export'],
 *   period: {
 *     queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' },
 *     held: { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' },
 *   },
 * });
 * ```
 */
export interface DeclaredPeriod {
  /** The instants of the READ that produced this result — not of "this call".
   *  ISO 8601 instants WITH a zone; `from` is not after `to`. */
  readonly queried: { readonly from: string; readonly to: string };
  /** What the store holds at the time of the read — the same shape — or
   *  `'unknown'`, said out loud when the tool cannot vouch for it. */
  readonly held: { readonly from: string; readonly to: string } | 'unknown';
  /** When the read ran — a cached answer is served minutes after the read it
   *  describes. An ISO 8601 instant with a zone. */
  readonly readAt?: string;
}

/**
 * {@link DeclaredPeriod} as the wire spells it — `read_at` is the one key that
 * differs. What a model reads inside `af_absent`, `af_coverage` and
 * `af_semantics`, and what a foreign minter writes (`canonical-notes.json`
 * publishes every key, {@link PERIOD_WIRE}).
 *
 * @inline
 */
export interface PeriodOnWire {
  readonly queried: { readonly from: string; readonly to: string };
  readonly held: { readonly from: string; readonly to: string } | 'unknown';
  readonly read_at?: string;
}

/**
 * The period's wire spelling as DATA — every reserved key and the one literal
 * (`'unknown'`) — so a tool written in another language mints it byte for
 * byte. `canonical-notes.json` publishes it, generated from this constant
 * (`scripts/gen-canonical-notes.mjs`): the JSON cannot disagree with the code.
 *
 * @example
 * ```ts
 * PERIOD_WIRE.readAt; // 'read_at' — the one key whose wire spelling differs
 * ```
 */
export const PERIOD_WIRE = Object.freeze({
  /** The key a period sits under on `af_absent`, `af_coverage` and `af_semantics`. */
  key: 'period',
  queried: 'queried',
  held: 'held',
  from: 'from',
  to: 'to',
  readAt: 'read_at',
  /** The literal `held` carries when the store cannot vouch for what it holds. */
  heldUnknown: 'unknown',
} as const);

/**
 * How far a result's READ covered what it asked for — one pure rule over the
 * instants the tool declared (bounds are inclusive):
 *
 * - `covered` — the store holds every instant the read asked for;
 * - `partly-held` — it holds some of them;
 * - `not-held` — it holds none of them;
 * - `unknown` — the tool said it cannot vouch for what the store holds.
 *
 * @inline
 */
export type PeriodVerdict = 'covered' | 'partly-held' | 'not-held' | 'unknown';

// ─── Instants ────────────────────────────────────────────────────────────

// The one instant parser lives in `core/time/instant.ts` (`instantOf`). A
// period a result DECLARES is read in its LENIENT profile — RFC 3339 as a
// foreign minter may write it (`t`/`z`, the leap second `:60`) — exactly the
// rule this file owned before the time layer took it; the verdict below is
// unchanged byte for byte.

// ─── The ONE rule set ────────────────────────────────────────────────────

/** Which door's words a problem is named in: the author's (camelCase) or the wire's. */
export type KeySpelling = 'camel' | 'wire';

/** One fault in a period, naming its field the way the reader spelled it. */
export interface PeriodProblem {
  /** Dot-pathed, from `period` down (`period.queried.from`, `period.readAt`). */
  readonly field: string;
  readonly message: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** The shown form of a value in a message — JSON, clipped: a message is never a copy of a document. */
function shown(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

const readAtKey = (s: KeySpelling): string => (s === 'camel' ? 'readAt' : 'read_at');

/** The first unknown key of `value`, as a problem — naming the spelling meant when it is a slip. */
function unknownKey(
  value: Record<string, unknown>,
  known: readonly string[],
  at: string,
): PeriodProblem | undefined {
  for (const key of Object.keys(value)) {
    if (known.includes(key)) continue;
    const meant = spellingMeant(key, known);
    return {
      field: `${at}.${key}`,
      message:
        `'${at}.${key}' is not a field this vocabulary has` +
        (meant === undefined ? '.' : ` — did you mean \`${meant}\`?`) +
        ` The fields of \`${at}\` are: ${known.join(', ')}.`,
    };
  }
  return undefined;
}

/** The problem with one instant field, or `undefined` when it names an instant. */
function instantProblem(value: unknown, at: string): PeriodProblem | undefined {
  if (instantOf(value, 'lenient') !== undefined) return undefined;
  return {
    field: at,
    message:
      `\`${at}\` must be an ISO 8601 instant with a zone — e.g. '2026-09-26T08:00:00Z' or ` +
      `'2026-09-26T10:00:00+02:00' — got ${shown(value)}. The library compares instants, and ` +
      'one with no zone could be any of 24 hours, so it is refused rather than guessed.',
  };
}

/** The problem with one `{ from, to }` span, or `undefined` when it is one. */
function spanProblem(value: unknown, at: string): PeriodProblem | undefined {
  if (!isPlainObject(value)) {
    return {
      field: at,
      message: `\`${at}\` must be { from, to } — two instants, got ${shown(value)}.`,
    };
  }
  const extra = unknownKey(value, ['from', 'to'], at);
  if (extra !== undefined) return extra;
  const bad = instantProblem(value.from, `${at}.from`) ?? instantProblem(value.to, `${at}.to`);
  if (bad !== undefined) return bad;
  // Both parse — checked just above.
  if (
    compareInstants(
      instantOf(value.from, 'lenient') as Instant,
      instantOf(value.to, 'lenient') as Instant,
    ) > 0
  ) {
    return {
      field: at,
      message:
        `\`${at}.from\` (${String(value.from)}) is after \`${at}.to\` (${String(value.to)}) — ` +
        'a span runs forward.',
    };
  }
  return undefined;
}

/**
 * THE rule set: the first fault in a period, or `undefined` when it is well
 * formed — asked by every mint (which refuses it) and every recognizer (which
 * drops it from the record and serves the envelope as the tool wrote it).
 *
 * In order: a plain object; no key it does not have (a spelling slip names the
 * key meant — `read_at` at a camelCase door names `readAt`); `queried` a
 * `{ from, to }` span of instants with `from` not after `to`; `held` the
 * literal `'unknown'` or a span by the same rule; `readAt` an instant.
 *
 * @example
 * ```ts
 * periodProblem({ queried: { from: 'yesterday', to: '2026-09-26T10:00:00Z' }, held: 'unknown' }, 'camel');
 * // → { field: 'period.queried.from', message: '`period.queried.from` must be an ISO 8601 instant with a zone — …' }
 * ```
 */
export function periodProblem(value: unknown, spelling: KeySpelling): PeriodProblem | undefined {
  const readAt = readAtKey(spelling);
  if (!isPlainObject(value)) {
    return {
      field: 'period',
      message: `\`period\` must be { queried, held, ${readAt}? } — got ${shown(value)}.`,
    };
  }
  const extra = unknownKey(value, ['queried', 'held', readAt], 'period');
  if (extra !== undefined) return extra;
  if (value.queried === undefined || value.queried === null) {
    return {
      field: 'period.queried',
      message:
        '`period.queried` must say what the read asked for — { from, to }, two instants of the ' +
        'READ that produced this result.',
    };
  }
  const queried = spanProblem(value.queried, 'period.queried');
  if (queried !== undefined) return queried;
  if (value.held !== 'unknown') {
    if (value.held === undefined || value.held === null) {
      return {
        field: 'period.held',
        message:
          "`period.held` must say what the store holds — { from, to }, or 'unknown' said out " +
          'loud when the tool cannot vouch for it.',
      };
    }
    const held = spanProblem(value.held, 'period.held');
    if (held !== undefined) {
      return typeof value.held === 'string'
        ? {
            field: 'period.held',
            message:
              `\`period.held\` is ${shown(value.held)} — it must be { from, to } or the literal ` +
              "'unknown'.",
          }
        : held;
    }
  }
  const at = value[readAt];
  if (at !== undefined && at !== null) {
    const bad = instantProblem(at, `period.${readAt}`);
    if (bad !== undefined) return bad;
  }
  return undefined;
}

// ─── The doors ───────────────────────────────────────────────────────────

/**
 * Mint the wire form from an author's (camelCase) declaration — THROWS a
 * refusal (`refused: …`) on the first fault, at the line the author wrote (the
 * `absent()` law). `undefined` or `null` → `undefined`: not declared. A fresh
 * object, keys in wire order; nothing of the author's is held.
 */
export function mintPeriod(declared: unknown): PeriodOnWire | undefined {
  if (declared === undefined || declared === null) return undefined;
  const problem = periodProblem(declared, 'camel');
  if (problem !== undefined) throw refusal(problem.message);
  const period = declared as unknown as DeclaredPeriod;
  return {
    queried: { from: period.queried.from, to: period.queried.to },
    held: period.held === 'unknown' ? 'unknown' : { from: period.held.from, to: period.held.to },
    ...(period.readAt != null && { read_at: period.readAt }),
  };
}

/** What a recognizer read off an envelope's `period`. */
export interface PeriodReading {
  /** The record's (camelCase) form — present when the envelope declared a well-formed one. */
  readonly period?: DeclaredPeriod;
  /** Why a declared period was NOT read — present when it was malformed. */
  readonly problem?: PeriodProblem;
}

/**
 * Read a wire period off a recognized envelope — never repaired. `{}` when
 * the envelope declares none (`undefined` or `null`, a JSON producer's
 * `None`); `{ period }` in the record's camelCase form when it is well formed;
 * `{ problem }` when it is not, so the caller can drop it from the record and
 * say so — the model still reads what the tool wrote.
 */
export function readPeriod(wire: unknown): PeriodReading {
  if (wire === undefined || wire === null) return {};
  const problem = periodProblem(wire, 'wire');
  if (problem !== undefined) return { problem };
  const onWire = wire as PeriodOnWire;
  return {
    period: {
      queried: { from: onWire.queried.from, to: onWire.queried.to },
      held: onWire.held === 'unknown' ? 'unknown' : { from: onWire.held.from, to: onWire.held.to },
      ...(onWire.read_at != null && { readAt: onWire.read_at }),
    },
  };
}

/** A declared period as detached plain data — the record's copy. */
export function copyPeriod(period: DeclaredPeriod): DeclaredPeriod {
  return {
    queried: { from: period.queried.from, to: period.queried.to },
    held: period.held === 'unknown' ? 'unknown' : { from: period.held.from, to: period.held.to },
    ...(period.readAt !== undefined && { readAt: period.readAt }),
  };
}

/** (declaration, tool) pairs already warned about — one warning per tool per PROCESS for each (dev mode only). */
const warnedTools = new Set<string>();
const MAX_WARNED = 500;

/**
 * Say, once per tool per process and in dev mode only, that a recognized
 * envelope's `period` — or an absence's `provenance` — could not be read and
 * was left off the record. The envelope itself is still recognized and served
 * as the tool wrote it — read, never repaired (the `items.ts` ·
 * `readItemExtras` precedent).
 */
export function warnDroppedDeclaration(
  toolName: string | undefined,
  declaration: 'period' | 'provenance',
  problem: { readonly message: string },
): void {
  const key = `${declaration} ${toolName ?? ''}`;
  if (warnedTools.has(key) || !isDevMode()) return;
  if (warnedTools.size < MAX_WARNED) warnedTools.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `agentfootprint coverage: tool '${toolName ?? '(unknown)'}' returned a ${declaration} the ` +
      `record cannot carry, so the ${declaration} was left off the record (the result itself is ` +
      `kept and served as written): ${problem.message} This warning fires once per tool per ` +
      `process.`,
  );
}

/**
 * Forget every dropped-declaration warning issued so far.
 * @internal test seam — the ledger is process-wide and warn-once.
 */
export function _resetPeriodWarnings(): void {
  warnedTools.clear();
}

// ─── The verdict ─────────────────────────────────────────────────────────

/**
 * How far a declared period's READ covered what it asked for — ONE pure rule
 * over the instants the tool declared; bounds are inclusive:
 *
 * ```text
 * held === 'unknown'                                  → 'unknown'
 * held.from ≤ queried.from and queried.to ≤ held.to   → 'covered'
 * queried.to < held.from or queried.from > held.to    → 'not-held'
 * otherwise                                           → 'partly-held'
 * ```
 *
 * No clock is read and no duration is parsed: the tool declared both spans.
 * Throws a `TypeError` naming the fault when handed a period that is not well
 * formed — a caller error; every period the library files was checked first.
 *
 * @example
 * ```ts
 * periodVerdict({
 *   queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' },
 *   held: { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' },
 * }); // 'not-held' — the data ends at 02:00; the hour asked about is after it
 * ```
 */
export function periodVerdict(period: DeclaredPeriod): PeriodVerdict {
  const problem = periodProblem(period, 'camel');
  if (problem !== undefined) throw new TypeError(`periodVerdict: ${problem.message}`);
  if (period.held === 'unknown') return 'unknown';
  const qFrom = instantOf(period.queried.from, 'lenient') as Instant;
  const qTo = instantOf(period.queried.to, 'lenient') as Instant;
  const hFrom = instantOf(period.held.from, 'lenient') as Instant;
  const hTo = instantOf(period.held.to, 'lenient') as Instant;
  if (compareInstants(hFrom, qFrom) <= 0 && compareInstants(qTo, hTo) <= 0) return 'covered';
  if (compareInstants(qTo, hFrom) < 0 || compareInstants(qFrom, hTo) > 0) return 'not-held';
  return 'partly-held';
}

/**
 * The verdict a CALL gets when its result declared more than one period (a
 * `coverage()` around an `absent()`, each with its own): the LEAST held of
 * them, so a reader is never told more than the weakest declaration covers —
 * `not-held`, then `partly-held`, then `unknown`, then `covered`.
 */
export function leastHeld(verdicts: readonly PeriodVerdict[]): PeriodVerdict | undefined {
  for (const verdict of ['not-held', 'partly-held', 'unknown', 'covered'] as const) {
    if (verdicts.includes(verdict)) return verdict;
  }
  return undefined;
}

// ─── The model's word ────────────────────────────────────────────────────

/**
 * The verdicts the MODEL is served — every verdict but `covered`, which is
 * served as nothing at all.
 *
 * @inline
 */
export type ServedPeriodVerdict = Exclude<PeriodVerdict, 'covered'>;

/** The key the served verdict word sits under, inside the served `period`. */
export const SERVED_VERDICT_KEY = 'verdict';

/**
 * The ONE note clause per served verdict (honesty step 7b, bench round 1).
 * Static library text: no instant, no tool value, nothing interpolated — the
 * `ABSENCE_NOTE` law. Each states the CONSEQUENCE of its word in the terms the
 * notes already teach ("ground this result does NOT cover"), because the bench
 * showed a model repeating `period.queried` as the ground a result covered
 * without ever comparing it with `period.held`.
 */
export const PERIOD_VERDICT_CLAUSES: Readonly<Record<ServedPeriodVerdict, string>> = Object.freeze({
  'not-held':
    '`period.verdict` is `not-held`: the store holds none of the time this read asked about ' +
    '(`period.queried`), so all of that time is ground this result does NOT cover — this ' +
    'result settles nothing about it, and the time the store does hold is `period.held`.',
  'partly-held':
    '`period.verdict` is `partly-held`: the store holds only part of the time this read asked ' +
    'about (`period.queried`), so the part outside `period.held` is ground this result does ' +
    'NOT cover — what this result says holds for `period.held` only.',
  unknown:
    '`period.verdict` is `unknown`: the tool cannot say what time its store holds, so this ' +
    'result cannot vouch that it covers the time this read asked about (`period.queried`).',
});

/** A wire period as served: the tool's own keys, then the verdict word. */
export interface ServedPeriod {
  /** The wire period, copied, with {@link SERVED_VERDICT_KEY} last. */
  readonly period: Readonly<Record<string, unknown>>;
  readonly verdict: ServedPeriodVerdict;
  /** {@link PERIOD_VERDICT_CLAUSES}`[verdict]`. */
  readonly clause: string;
}

/**
 * What the model is served for one declared wire period — `undefined` when
 * there is nothing to add: no period, a period the rule set refuses (served
 * as the tool wrote it — read, never repaired), or a `covered` one.
 *
 * The verdict is {@link periodVerdict} over the instants the tool declared —
 * the one rule the record's `period` row is filed by, so the word the model
 * reads and the row the fold reads cannot disagree. Computed at the SERVE
 * door, never minted: the tool's own output keeps the bytes it declared, so a
 * helper in another language mints nothing new.
 *
 * @example
 * ```ts
 * servedPeriod({
 *   queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' },
 *   held: { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' },
 * })?.period; // { queried: {…}, held: {…}, verdict: 'not-held' }
 * ```
 */
export function servedPeriod(wire: unknown): ServedPeriod | undefined {
  const { period } = readPeriod(wire);
  if (period === undefined) return undefined;
  const verdict = periodVerdict(period);
  if (verdict === 'covered') return undefined;
  const onWire = mintPeriod(period) as PeriodOnWire;
  return {
    period: { ...onWire, [SERVED_VERDICT_KEY]: verdict },
    verdict,
    clause: PERIOD_VERDICT_CLAUSES[verdict],
  };
}

/**
 * The inverse, for a reader of what the model was SERVED: a wire period with
 * its served verdict word removed — when that word is exactly the one
 * {@link servedPeriod} computes from the rest. Anything else (no word, a word
 * that disagrees with the instants, a period the rule set refuses) comes back
 * as the same reference, so the rule set still names it: a verdict is derived
 * by the library, never declared by a tool.
 */
export function unservedPeriod(wire: unknown): unknown {
  if (!isPlainObject(wire) || !(SERVED_VERDICT_KEY in wire)) return wire;
  const { [SERVED_VERDICT_KEY]: word, ...declared } = wire;
  return servedPeriod(declared)?.verdict === word ? declared : wire;
}

/**
 * A served note with its period clause removed (the inverse of appending
 * {@link PERIOD_VERDICT_CLAUSES}`[verdict]`), or the note as found.
 */
export function noteWithoutClause(note: unknown, verdict: ServedPeriodVerdict): unknown {
  if (typeof note !== 'string') return note;
  const clause = PERIOD_VERDICT_CLAUSES[verdict];
  if (note === clause) return undefined;
  return note.endsWith(` ${clause}`) ? note.slice(0, -(clause.length + 1)) : note;
}

/** A served note: the note as found, then the period clause. */
export function noteWithClause(note: unknown, clause: string): string {
  return typeof note === 'string' && note !== '' ? `${note} ${clause}` : clause;
}

// ─── The person's line ───────────────────────────────────────────────────

/**
 * The `Period:` line the limits block prints for one declaring call — the
 * period AS THE TOOL DECLARED IT, instants verbatim (no reformatting, no zone
 * conversion, no verdict word: the answer's standing owns the verdict's
 * sentence). Static words around the tool's own values. With a
 * `presentation` (the run's clock zone, only under `.time()`), the instants
 * are rendered in that zone instead — see {@link periodLineInZone}.
 *
 * @example
 * ```ts
 * periodLine('backup_runs', {
 *   queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' },
 *   held: { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' },
 * });
 * // 'backup_runs queried 2026-09-26T09:00:00Z to 2026-09-26T10:00:00Z; the store holds
 * //  2026-08-27T02:00:00Z to 2026-09-26T02:00:00Z'
 * ```
 */
export function periodLine(
  toolName: string,
  period: DeclaredPeriod,
  presentation?: BoundPresentation,
): string {
  if (presentation !== undefined) return periodLineInZone(toolName, period, presentation);
  const queried = `${toolName} queried ${period.queried.from} to ${period.queried.to}`;
  const held =
    period.held === 'unknown'
      ? 'what the store holds is unknown'
      : `the store holds ${period.held.from} to ${period.held.to}`;
  const readAt = period.readAt !== undefined ? ` (read at ${period.readAt})` : '';
  return `${queried}; ${held}${readAt}`;
}

/**
 * The same line under `.time()` (time design § 10.2): every instant rendered
 * in the presentation zone by the time layer's one renderer
 * (`core/time/present.ts`), the zone named, each end AS DECLARED (a declared
 * period is inclusive, so no end moves). The raw instants stay in the typed
 * record (`coverageDeclared`, `answerCoverage`); a label is never parsed back.
 *
 * @example
 * ```ts
 * periodLine('backup_runs', {
 *   queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' },
 *   held: 'unknown',
 * }, bindPresentation({ zone: 'America/Los_Angeles' })); // core/time/present.ts
 * // 'backup_runs queried 2026-09-26 02:00–03:00 America/Los_Angeles (UTC-07:00);
 * //  what the store holds is unknown'
 * ```
 */
function periodLineInZone(
  toolName: string,
  period: DeclaredPeriod,
  presentation: BoundPresentation,
): string {
  const queried = `${toolName} queried ${presentation.span(
    period.queried.from,
    period.queried.to,
  )}`;
  const held =
    period.held === 'unknown'
      ? 'what the store holds is unknown'
      : `the store holds ${presentation.span(period.held.from, period.held.to)}`;
  const readAt =
    period.readAt !== undefined ? `; read at ${presentation.instant(period.readAt)}` : '';
  return `${queried}; ${held}${readAt}`;
}

// ─── The verdict's row ───────────────────────────────────────────────────

/**
 * The results layer's verdict on ONE call's period — a row on the one honesty
 * ledger (`AgentState.findingsLedger`, `kind: 'period'`), filed by the results
 * subflow at the loop head (`../results/subflow.ts`), never by the model.
 *
 * - `verdict` — {@link periodVerdict} over the period the call's result
 *   declared (the least held, when it declared more than one), or
 *   `'undeclared'`: the tool declares a `ToolPeriod` and this result said
 *   nothing about what its read covered — declared silence, recorded as
 *   silence.
 * - `argument` — the argument the tool's `ToolPeriod` names: the join key to
 *   the inputs layer's `argument` row for the same call (`period: true`), which
 *   says WHO chose the period, while this row says WHAT the read covered.
 *
 * The row references the call's coverage row by `toolCallId` and never copies
 * the instants: the declaration stays in its own key (`coverageDeclared`).
 * Readers that switch over every row kind must skip one they do not know.
 */
export interface PeriodRow {
  readonly kind: 'period';
  /** `AgentState.turnNumber` when the row was filed — the conversation turn. */
  readonly turn: number;
  readonly toolCallId: string;
  readonly toolName: string;
  /** The iteration of the batch the call ran in. */
  readonly iteration: number;
  readonly verdict: PeriodVerdict | 'undeclared';
  /** The argument the tool's `ToolPeriod` names — present only when it declares one. */
  readonly argument?: string;
  // ── The time layer's result checks (step T8 — `core/time/check.ts` ·
  //    `periodTimeCheck`), filed only under `.time()` and only when they hold;
  //    an unarmed run's rows never carry them (byte-identical). ──
  /** `period-differs-from-asked { missing, extra }` — the read differs from the asked range (or, for a window the model chose, from the person's). */
  readonly differs?: PeriodDiffers;
  /** `period-shifted` — the call's look-back ran as sent, `byMs` after the turn's `now`. */
  readonly shifted?: { readonly byMs: number };
  /** `period-beyond-retention` — refused as, or read as, wholly older than the tool's source keeps. */
  readonly beyondRetention?: true;
  /** `partly-beyond-retention` — the read crosses the edge of what the source keeps; `verdict` decides. */
  readonly partlyBeyondRetention?: true;
}

/** Every verdict a period row may carry, in the order the fold reports them. */
export const PERIOD_ROW_VERDICTS: readonly PeriodRow['verdict'][] = Object.freeze([
  'covered',
  'partly-held',
  'not-held',
  'unknown',
  'undeclared',
]);

/**
 * The checkpoint door's test for a `period` row (`core/runCheckpoint.ts` ·
 * `ledgerRowIsWellFormed`) — the one owner of the row's shape, so the door
 * refuses exactly what this module never files.
 */
export function periodRowIsWellFormed(row: Readonly<Record<string, unknown>>): boolean {
  return (
    row.kind === 'period' &&
    typeof row.turn === 'number' &&
    typeof row.toolCallId === 'string' &&
    typeof row.toolName === 'string' &&
    typeof row.iteration === 'number' &&
    typeof row.verdict === 'string' &&
    (PERIOD_ROW_VERDICTS as readonly string[]).includes(row.verdict) &&
    (row.argument === undefined || (typeof row.argument === 'string' && row.argument !== '')) &&
    (row.differs === undefined || isPeriodDiffers(row.differs)) &&
    (row.shifted === undefined || isShifted(row.shifted)) &&
    (row.beyondRetention === undefined || row.beyondRetention === true) &&
    (row.partlyBeyondRetention === undefined || row.partlyBeyondRetention === true)
  );
}

// ─── The time layer's limits lines (step T8) ─────────────────────────────

/**
 * The one limits line for a call whose `period` row carries a time check
 * (time design § 10.2, step T8) — `undefined` when it carries none. Static
 * words around the two ranges, rendered in the presentation zone by the time
 * layer's one renderer, HANDED in bound (`core/time/present.ts` ·
 * `bindPresentation` → `range`, to the second, the zone named — coverage never
 * imports the renderer); the raw instants stay on the row.
 *
 * @example
 * ```ts
 * periodCheckLine(row, bindPresentation({ zone: 'America/Los_Angeles' })); // core/time/present.ts
 * // 'search_logs read more than was asked — asked: 2026-10-08 00:00:00–23:59:59 America/Los_Angeles
 * //  (UTC-07:00); read: 2026-10-08 00:00:00–2026-10-09 08:40:00 America/Los_Angeles (UTC-07:00)'
 * ```
 *
 * `audience` names who reads the line: the PERSON (the limits block, the
 * default — their window is "your window") or the MODEL (the served time line,
 * `agent/arguments/serve.ts` · `timeLimitsSentence` — the same window is "the
 * person's window"). Only that reference differs.
 */
export function periodCheckLine(
  row: PeriodRow,
  presentation: BoundPresentation,
  audience: 'person' | 'model' = 'person',
): string | undefined {
  const parts: string[] = [];
  const d = row.differs;
  if (d !== undefined) {
    const person = d.against === 'person';
    const theirs = audience === 'model' ? "the person's window" : 'your window';
    const reference = person ? theirs : 'was asked';
    const what =
      d.missing.length > 0 && d.extra.length > 0
        ? row.shifted !== undefined
          ? 'a shifted window'
          : 'a different window'
        : `${d.missing.length > 0 ? 'less' : 'more'} than ${reference}`;
    const reads = d.read.map((r) => presentation.range(r, 'second')).join('; ');
    parts.push(
      `${row.toolName} read ${what} — ${person ? theirs : 'asked'}: ` +
        `${presentation.range(d.asked, 'second')}; read: ${reads}`,
    );
  } else if (row.shifted !== undefined) {
    parts.push(`${row.toolName}'s look-back ran after the clock moved on`);
  }
  if (row.beyondRetention === true) {
    parts.push(
      `${row.toolName}: the time asked about is older than the oldest data the tool declares its source keeps`,
    );
  }
  return parts.length === 0 ? undefined : parts.join('. ');
}

/**
 * The `Clocks` lines (time design § 9.6, § 10.2, step T8): one per wall-clock
 * source — a dataset whose declared axis names a zone — and, when two sources
 * declare different zones, the label that they differ. Every comparison is
 * made on instants; the lines only name the clocks.
 */
export function clockLines(
  sources: readonly SourceClock[],
  differ: { readonly zones: readonly string[] } | undefined,
): string[] {
  const lines = sources.map(
    (s) => `${s.toolName}'s rows are wall times in ${s.zone} (declared) — compared as instants`,
  );
  if (differ !== undefined) {
    lines.push(`the sources' clocks differ (${differ.zones.join(', ')}) — compared as instants`);
  }
  return lines;
}
