/**
 * arguments/rows — the inputs layer's verdicts, as rows on the one ledger.
 *
 * Pattern: Map. One row type, its builders and its well-formedness check —
 *          the one owner of the `argument` row kind. `findings/types.ts` ·
 *          `FindingsRow` imports the type; this folder never imports
 *          `findings/` (the one-way law).
 * Role:    core/ layer leaf of the inputs layer (honesty layer 2).
 * Emits:   N/A (the Record stage emits one `agentfootprint.findings.argument`
 *          per row through the ledger's emit half).
 *
 * ## What a row may hold
 *
 * Names, enums and counts — and, in three fields only (`value`, `proposed`,
 * `quote`), a value AS THE TOOL'S OWN ARGUMENT VIEW SHOWS IT
 * (`core/toolShownArgs.ts` · `shownArgsOf`): a key the view hides reads
 * `'REDACTED'`. The layer's checks run on the raw value in memory; the raw
 * value is never stored on a row.
 *
 * ## One row per ruled argument per call, stamped with the turn
 *
 * `turn` is `AgentState.turnNumber` when the row was filed — the conversation
 * turn, not the window position — because the ledger crosses turns on a
 * continued conversation and `iteration` restarts at 1 every run. The
 * standing fold reads this turn's rows only.
 */

import { clipValue } from '../../../integrity/argumentLeaves.js';

/** Where a ruled argument's value came from, as the library's checks placed it. */
export type ArgumentSource = 'said' | 'answered' | 'result' | 'app' | 'default' | 'model';

/** Why the library asked (step 4 of the inputs layer files these). */
export type ArgumentAsked = 'missing' | 'unverified' | 'invalid-answer';

/** What the model claimed about a value's source (`_findings.from`, step 5). */
export type ArgumentClaim = 'user' | 'result' | 'turn' | 'app' | 'assumed' | 'none';

/** Which declared-source check failed (step 5). */
export type ArgumentCheckFailed =
  | 'quote-not-found'
  | 'composed-message'
  | 'unknown-result'
  | 'placed-result'
  | 'not-in-result'
  | 'no-earlier-turn'
  | 'not-in-earlier-turns'
  | 'only-in-model-answer'
  | 'not-in-app-text'
  | 'uncheckable';

/**
 * The inputs layer's verdict on ONE ruled argument of ONE tool call — a row on
 * `AgentState.findingsLedger` (`kind: 'argument'`).
 *
 * This version files `source: 'default'` (the library filled the declared
 * default, or the model sent that same value itself — `proposed` says which)
 * and `source: 'model'` (the model sent another value, and the record does not
 * show where it came from). The other members of each union are the layer's
 * vocabulary for its later steps — the batch ask (`answered`, `asked`, `free`)
 * and the declared sources (`said`, `result`, `app`, `claimed`, `failed`, …);
 * a reader skips what it does not know.
 */
export interface ArgumentRow {
  readonly kind: 'argument';
  /** `AgentState.turnNumber` when the row was filed — the conversation turn. */
  readonly turn: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  /** The top-level argument name — schema vocabulary, like `toolName`. */
  readonly argument: string;
  /** The rule on the argument; absent on a free argument a `from` entry named. */
  readonly rule?: 'ask' | 'assume';
  /** Set on the argument `Tool.period` names. */
  readonly period?: true;
  /** Where the value came from; absent only on an asked row. */
  readonly source?: ArgumentSource;
  readonly asked?: ArgumentAsked;
  /**
   * The value the call runs with, in the tool's own argument view, clipped
   * (`integrity/argumentLeaves.ts` · `clipValue`); `'REDACTED'` when the view
   * hides the argument.
   */
  readonly value?: string;
  /**
   * The MODEL's own value, same view: on a `default` row, the default the model
   * sent itself (absent = the library filled it); on an `answered` row, the
   * value the person's answer replaced.
   */
  readonly proposed?: string;
  readonly claimed?: ArgumentClaim;
  readonly matched?: 'quote' | 'phrase' | 'spelling';
  readonly quote?: string;
  readonly reading?: true;
  readonly earlier?: true;
  readonly result?: string;
  readonly setAside?: 'open' | 'noise' | 'ruled-out';
  readonly argumentsFrom?: 'listed' | 'unlisted';
  readonly appSource?: string;
  readonly free?: true;
  readonly coincides?: 'person' | 'result' | 'app';
  readonly malformed?: number;
  readonly failed?: ArgumentCheckFailed;
}

/** The closed vocabularies, for the checkpoint door and the event. */
export const ARGUMENT_SOURCES: readonly ArgumentSource[] = Object.freeze([
  'said',
  'answered',
  'result',
  'app',
  'default',
  'model',
]);
export const ARGUMENT_ASKED: readonly ArgumentAsked[] = Object.freeze([
  'missing',
  'unverified',
  'invalid-answer',
]);
export const ARGUMENT_CLAIMS: readonly ArgumentClaim[] = Object.freeze([
  'user',
  'result',
  'turn',
  'app',
  'assumed',
  'none',
]);
export const ARGUMENT_CHECKS_FAILED: readonly ArgumentCheckFailed[] = Object.freeze([
  'quote-not-found',
  'composed-message',
  'unknown-result',
  'placed-result',
  'not-in-result',
  'no-earlier-turn',
  'not-in-earlier-turns',
  'only-in-model-answer',
  'not-in-app-text',
  'uncheckable',
]);

// ─── Builders ───────────────────────────────────────────────────────────

/** The placeholder a hidden argument reads — the redacted mirror's own. */
export const HIDDEN_VALUE = 'REDACTED';

/**
 * One value as a row may hold it: the shown view's value, printed as a string
 * (`String()` for a number or a boolean, JSON for anything else) and clipped.
 * A value the view replaced with the placeholder stays the placeholder.
 */
export function shownValue(value: unknown): string {
  if (typeof value === 'string') return clipValue(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let printed: string;
  try {
    printed = JSON.stringify(value) ?? String(value);
  } catch {
    printed = String(value);
  }
  return clipValue(printed);
}

/** What the Record stage knows about one ruled argument of one call. */
export interface ArgumentVerdict {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argument: string;
  readonly rule: 'ask' | 'assume';
  readonly period?: true;
  readonly source: 'default' | 'model';
  /** The value the call runs with, in the shown view (the fill, or the model's). */
  readonly shownValue: unknown;
  /** The model's own value in the shown view — set only when the model sent one. */
  readonly shownProposed?: unknown;
}

/**
 * The row for one verdict. `proposed` is written only on a `default` row the
 * model sent itself — on a `model` row the value IS the proposal, and a second
 * copy would say nothing.
 */
export function argumentRowOf(
  verdict: ArgumentVerdict,
  stamp: { readonly turn: number; readonly iteration: number },
): ArgumentRow {
  return {
    kind: 'argument',
    turn: stamp.turn,
    toolCallId: verdict.toolCallId,
    toolName: verdict.toolName,
    iteration: stamp.iteration,
    argument: verdict.argument,
    rule: verdict.rule,
    ...(verdict.period === true && { period: true as const }),
    source: verdict.source,
    value: shownValue(verdict.shownValue),
    ...(verdict.source === 'default' &&
      verdict.shownProposed !== undefined && { proposed: shownValue(verdict.shownProposed) }),
  };
}

// ─── Well-formed ────────────────────────────────────────────────────────

const isIn = (value: unknown, vocabulary: readonly string[]): boolean =>
  typeof value === 'string' && vocabulary.includes(value);
const optionalIn = (value: unknown, vocabulary: readonly string[]): boolean =>
  value === undefined || isIn(value, vocabulary);
const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === 'string';
const optionalTrue = (value: unknown): boolean => value === undefined || value === true;

/**
 * Whether a value read from a stored checkpoint is an `argument` row this
 * library could have written: the identity strings, a numeric `iteration` and
 * `turn`, a `source` or an `asked` in its vocabulary, and every enum field in
 * its own. The checkpoint door's `argument` arm (`core/runCheckpoint.ts`).
 */
export function argumentRowIsWellFormed(r: Readonly<Record<string, unknown>>): boolean {
  return (
    r.kind === 'argument' &&
    typeof r.toolCallId === 'string' &&
    typeof r.toolName === 'string' &&
    typeof r.argument === 'string' &&
    typeof r.iteration === 'number' &&
    typeof r.turn === 'number' &&
    (isIn(r.source, ARGUMENT_SOURCES) || isIn(r.asked, ARGUMENT_ASKED)) &&
    optionalIn(r.source, ARGUMENT_SOURCES) &&
    optionalIn(r.asked, ARGUMENT_ASKED) &&
    optionalIn(r.rule, ['ask', 'assume']) &&
    optionalIn(r.claimed, ARGUMENT_CLAIMS) &&
    optionalIn(r.matched, ['quote', 'phrase', 'spelling']) &&
    optionalIn(r.setAside, ['open', 'noise', 'ruled-out']) &&
    optionalIn(r.argumentsFrom, ['listed', 'unlisted']) &&
    optionalIn(r.coincides, ['person', 'result', 'app']) &&
    optionalIn(r.failed, ARGUMENT_CHECKS_FAILED) &&
    optionalString(r.value) &&
    optionalString(r.proposed) &&
    optionalString(r.quote) &&
    optionalString(r.result) &&
    optionalString(r.appSource) &&
    optionalTrue(r.period) &&
    optionalTrue(r.reading) &&
    optionalTrue(r.earlier) &&
    optionalTrue(r.free) &&
    (r.malformed === undefined || typeof r.malformed === 'number')
  );
}
