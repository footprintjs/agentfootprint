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

/**
 * Why the library asked: the call left the value out (`missing`); the value
 * was present and its declared source did not trace it (`unverified` — under
 * declared sources, on an `ask` rule); the person's answer did not fit the
 * property's own schema and the field was asked again (`invalid-answer`).
 */
export type ArgumentAsked = 'missing' | 'unverified' | 'invalid-answer';

/** What the model claimed about a value's source (`_findings.from`; `'none'`: it declared nothing). */
export type ArgumentClaim = 'user' | 'result' | 'turn' | 'app' | 'assumed' | 'none';

/** Which declared-source check failed — the claim is filed as written, never repaired. */
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
 * Filed: `source: 'default'` (the library filled the declared default, or the
 * model sent that same value itself — `proposed` says which), `source:
 * 'model'` (the model sent another value, and the record does not trace it),
 * `asked` with no source (the call left an `ask` argument out and the person
 * was asked — `missing` — or asked again after an answer that did not fit —
 * `invalid-answer`), and `source: 'answered'` (the person's answer filled the
 * value; `free` when it came through a free-text field).
 *
 * Under declared sources (`.findings({ argumentSources: true })`) a present
 * value's row also carries the model's claim and the library's check of it
 * (`sourcedRowOf`): `claimed` (`'none'` when it declared nothing), `source`
 * `said` / `result` / `app` / `answered` when the check traced it (`matched`,
 * `reading`, `earlier`, `result`, `setAside`, `argumentsFrom`, `appSource`),
 * `failed` when it did not, `coincides` for the library's own lookup (a hint,
 * never a source), and `asked: 'unverified'` with the model's value as
 * `proposed` when an `ask` rule asks about it. A FREE argument a `from` entry
 * named is filed with no `rule`. A reader skips a member it does not know.
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
  /**
   * The model's `quote`, clipped (`QUOTE_CHARS`) — `'REDACTED'` on an agent
   * where ANY tool in reach can hide arguments (it registers a tool that
   * carries an argument view, or wires a ToolProvider — whatever it lists): a
   * quote is free text, and may hold any value a tool hides, in any spelling.
   */
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

/** The identity of one ruled argument of one call — what every row builder is handed. */
export interface ArgumentIdentity {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argument: string;
  readonly rule: 'ask' | 'assume';
  readonly period?: true;
}

/** The identity fields, in the one order every `argument` row is written in. */
function identityOf(
  who: ArgumentIdentity,
  stamp: { readonly turn: number; readonly iteration: number },
) {
  return {
    kind: 'argument' as const,
    turn: stamp.turn,
    toolCallId: who.toolCallId,
    toolName: who.toolName,
    iteration: stamp.iteration,
    argument: who.argument,
    rule: who.rule,
    ...(who.period === true && { period: true as const }),
  };
}

/**
 * The row for an argument the person is ASKED for: no `source` (nobody has
 * given the value yet) and no `value` (there is none). `invalid-answer` when
 * an answer did not fit the property's own schema and the field is asked
 * again — the answer itself is not kept.
 */
export function askedRowOf(
  who: ArgumentIdentity,
  stamp: { readonly turn: number; readonly iteration: number },
  asked: ArgumentAsked = 'missing',
): ArgumentRow {
  return { ...identityOf(who, stamp), asked };
}

/**
 * The row for a value the person's ANSWER filled (`source: 'answered'`): the
 * value the call runs with, in the tool's own argument view; `proposed` only
 * when the call had carried a value the answer replaced (absent = the call
 * left it out); `free` when the answer came through a free-text field — a
 * name the person typed, which is provenance and never support.
 */
export function answeredRowOf(
  who: ArgumentIdentity & {
    readonly shownValue: unknown;
    readonly shownProposed?: unknown;
    readonly free?: true;
  },
  stamp: { readonly turn: number; readonly iteration: number },
): ArgumentRow {
  return {
    ...identityOf(who, stamp),
    source: 'answered',
    value: shownValue(who.shownValue),
    ...(who.shownProposed !== undefined && { proposed: shownValue(who.shownProposed) }),
    ...(who.free === true && { free: true as const }),
  };
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

// ─── The declared sources' rows ─────────────────────────────────────────

/**
 * A quote's bound on a row — the bound a basis row's one-line texts carry
 * (`findings/types.ts` · `PROPOSITION_CHARS`, which this leaf cannot import),
 * the cut STATED in the text (`…[clipped N chars]`).
 */
export const QUOTE_CHARS = 240;

/** A quote as a row holds it: at most `QUOTE_CHARS`, the cut stated. */
export function shownQuote(quote: string): string {
  if (quote.length <= QUOTE_CHARS) return quote;
  return `${quote.slice(0, QUOTE_CHARS)} …[clipped ${quote.length - QUOTE_CHARS} chars]`;
}

/**
 * The declared-sources check's verdict on one argument of one call, as the
 * row builder is handed it — enums, flags, ids and labels. The value, the
 * model's proposal and the quote arrive ALREADY in the tool's own argument
 * view (`shownValue`, `shownProposed`: `'REDACTED'` where the view hides the
 * argument; `shownQuoteText`: `'REDACTED'` while any tool in reach can hide
 * arguments — a quote is free text and may hold any hidden value), so a raw
 * value never reaches a row.
 */
export interface SourcedVerdict {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argument: string;
  /** Absent on a free argument a `from` entry named. */
  readonly rule?: 'ask' | 'assume';
  readonly period?: true;
  /** Absent exactly when the person is asked (`asked: 'unverified'`). */
  readonly source?: ArgumentSource;
  readonly asked?: 'unverified';
  /** The value the call runs with, in the shown view — absent on an asked row. */
  readonly shownValue?: unknown;
  /** The model's own value, in the shown view — on a `default` row (V1) and an asked row. */
  readonly shownProposed?: unknown;
  readonly claimed: ArgumentClaim;
  readonly matched?: 'quote' | 'phrase' | 'spelling';
  /** The model's quote — `'REDACTED'` while any tool in reach can hide arguments (`resolve.ts` · `quotesMayShow`). */
  readonly shownQuoteText?: string;
  readonly reading?: true;
  readonly earlier?: true;
  readonly result?: string;
  readonly setAside?: 'open' | 'noise' | 'ruled-out';
  readonly argumentsFrom?: 'listed' | 'unlisted';
  readonly appSource?: string;
  readonly coincides?: 'person' | 'result' | 'app';
  readonly malformed?: number;
  readonly failed?: ArgumentCheckFailed;
}

/**
 * The row for one argument the declared-sources check judged (honesty layer
 * 2, `.findings({ argumentSources: true })`): the identity, the verdict's
 * source (or `asked: 'unverified'` — the person is asked, and nothing runs on
 * the model's value), the value in the tool's own view, and every field of the
 * claim and the check as the verdict carries it. Written in the one field order
 * `ArgumentRow` declares.
 */
export function sourcedRowOf(
  verdict: SourcedVerdict,
  stamp: { readonly turn: number; readonly iteration: number },
): ArgumentRow {
  return {
    kind: 'argument',
    turn: stamp.turn,
    toolCallId: verdict.toolCallId,
    toolName: verdict.toolName,
    iteration: stamp.iteration,
    argument: verdict.argument,
    ...(verdict.rule !== undefined && { rule: verdict.rule }),
    ...(verdict.period === true && { period: true as const }),
    ...(verdict.source !== undefined && { source: verdict.source }),
    ...(verdict.asked !== undefined && { asked: verdict.asked }),
    ...(verdict.shownValue !== undefined && { value: shownValue(verdict.shownValue) }),
    ...(verdict.shownProposed !== undefined && { proposed: shownValue(verdict.shownProposed) }),
    claimed: verdict.claimed,
    ...(verdict.matched !== undefined && { matched: verdict.matched }),
    ...(verdict.shownQuoteText !== undefined && { quote: shownQuote(verdict.shownQuoteText) }),
    ...(verdict.reading === true && { reading: true as const }),
    ...(verdict.earlier === true && { earlier: true as const }),
    ...(verdict.result !== undefined && { result: verdict.result }),
    ...(verdict.setAside !== undefined && { setAside: verdict.setAside }),
    ...(verdict.argumentsFrom !== undefined && { argumentsFrom: verdict.argumentsFrom }),
    ...(verdict.appSource !== undefined && { appSource: clipValue(verdict.appSource) }),
    ...(verdict.coincides !== undefined && { coincides: verdict.coincides }),
    ...(verdict.malformed !== undefined &&
      verdict.malformed > 0 && { malformed: verdict.malformed }),
    ...(verdict.failed !== undefined && { failed: verdict.failed }),
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
