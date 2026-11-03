import type {
  ArgumentAsked,
  ArgumentCheckFailed,
  ArgumentClaim,
  ArgumentSource,
  Basis,
  Expect,
  Standing,
} from './dependencyTypes.js';

// ─── findings (the model's standings on the record — `.findings()`) ────
/**
 * The model declared a BASIS for one tool call — `_findings.basis` peeled
 * off the call's arguments before anything else read them (9.101.0).
 *
 * Identities, enums and counts ONLY, by the `MiddlewareDecisionPayload` law
 * one screen up: the row itself lives in the committed `findingsLedger`
 * key under whatever redaction the run configured, and an event stream is
 * a fan-out to sinks we do not control. `malformed` counts the entries
 * `splitFindings` dropped from this call's declaration — never coerced,
 * never inferred — so a sink can see that the model tried and missed
 * without seeing what it wrote.
 *
 * Fired by `recordFindings`, one per basis row, BEFORE `stream.tool_start`
 * for the same `toolCallId`. Never fired on an agent without `.findings()`.
 */
export interface FindingsDeclaredPayload {
  readonly toolName: string;
  /** The provider's id for the call — what a reader joins to `tool_start`. */
  readonly toolCallId: string;
  readonly iteration: number;
  readonly basis: Basis;
  readonly expect?: Expect;
  /**
   * The call declared a `proposition` (what it tests) — a FLAG, never the
   * text, by the same law as `malformed`: the line itself lives on the
   * `BasisRow` in the committed key. Absent when none was declared.
   */
  readonly hasProposition?: true;
  /** Malformed `_findings` entries dropped from this call's declaration. */
  readonly malformed?: number;
}

/**
 * The model declared a STANDING for one PREVIOUS tool result — `fact`,
 * `open`, `ruled-out` or `noise` — on its next tool call or as a top-level
 * `_findings.previous` on a JSON answer (9.101.0).
 *
 * `toolCallId` names the RESULT being stood on, not the call that carried
 * the declaration; `declaredOn` says which door the declaration came
 * through. `assertionCount` is the number of assertions the row carries
 * (always 0 for `noise`); the assertions themselves, `settles`, `line` and
 * every other word the model wrote stay in the committed key — the same
 * law as `FindingsDeclaredPayload`. `conflictKeys` lists the assertion keys
 * whose conflict row THIS write created; a key that already had one is not
 * repeated. `unknownId` marks a standing for an id the previous batch did
 * not contain — recorded, never resolved.
 *
 * `agrees` (9.104.0, `.findings({ judge })`) compares this standing with the
 * JUDGE's current judgment of the same result and is present exactly when
 * a `JudgmentRow` exists for it: the judge files before the model call
 * that declares, so this event is the one moment both readings exist. A
 * comparison made for the sink, never written to the record, where the two
 * sources stay two rows. Absent without a judge, after a failed judgment,
 * and for an `unknownId`.
 *
 * Fired by `recordFindings`, one per standing row, in declaration order.
 */
export interface FindingsStandingPayload {
  /** The id of the tool RESULT this standing is about. */
  readonly toolCallId: string;
  /** Absent when `unknownId` — the batch had no result to name. */
  readonly toolName?: string;
  /** The DECLARING iteration; the result's own stage is derivable from the
   *  commit log by `toolCallId`, never guessed here. */
  readonly iteration: number;
  readonly standing: Standing;
  readonly declaredOn: 'tool-call' | 'answer';
  readonly assertionCount: number;
  /** Assertion keys whose conflict row this write created. */
  readonly conflictKeys?: readonly string[];
  /** The named id was not in the previous batch. */
  readonly unknownId?: true;
  /** Whether this standing equals the judge's current one for the result; present only when one exists. */
  readonly agrees?: boolean;
}

/**
 * A SECOND SOURCE judged one tool result (9.104.0, `.findings({ judge })`):
 * the calibrated classifier's standing for the result against the call's
 * declared proposition — or the user's question when none was declared —
 * with its confidence and cost. The row (`JudgmentRow`) holds the whole
 * distribution and the provider's model string in the committed
 * `findingsLedger`; this payload carries identities, enums and NUMBERS only,
 * never the state the judge read.
 *
 * No `agrees` here: the judge files BEFORE the model call that could
 * declare a standing on this result, so at this event the model's reading
 * does not exist yet. The comparison rides `FindingsStandingPayload.agrees`
 * instead, the one moment both readings exist. Fired by `recordFindings`,
 * one per judgment row, once the result's `toolResults` entry exists and
 * before the next model call. Never fired without a configured judge.
 */
export interface FindingsJudgedPayload {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  readonly against: 'proposition' | 'question';
  readonly standing: Standing;
  readonly confidence: number;
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/**
 * The judge was asked about one tool result and produced no answer
 * (9.104.0): the provider's HTTP status when there was one, and the latency
 * spent. The error text lives on the `JudgmentErrorRow`; no standing is
 * guessed, and the run continues — the judge is advisory.
 */
export interface FindingsJudgeFailedPayload {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  readonly status?: number;
  readonly latencyMs: number;
}

/**
 * The model USED a value that came only from results it had itself declared
 * `open`, `noise` or `ruled-out` (9.110.0, `.findings()` beside
 * `.namesAndNumbersFromEvidence()`): in its answer (`declaredOn: 'answer'`)
 * or as an argument of a later tool call (`'tool-call'`, with the call's
 * `toolCallId`). Declared standings plus the evidence corpus's provenance —
 * nothing inferred, no judge. The row (`ContingentRow`) holds the value and
 * every carrier with its standing in the committed `findingsLedger`; this
 * payload carries the moment, how many results carried the value, the
 * DISTINCT standings among them and the value's length — identities, enums
 * and numbers only, never the token. Fired by `recordFindings`, one per
 * contingent row: at the answer, after the evidence gate's verdict; at
 * dispatch, after the call's basis row and before `stream.tool_start`.
 * Never fired unless BOTH doors are armed.
 */
export interface FindingsContingentPayload {
  readonly iteration: number;
  readonly declaredOn: 'tool-call' | 'answer';
  /** The dispatching call, when the value rode its arguments; absent for the answer. */
  readonly toolCallId?: string;
  /** How many results carried the value — every one judged non-fact. */
  readonly carriers: number;
  /** The distinct standings among the carriers, in carrier order. */
  readonly standings: readonly Standing[];
  /** The length of the value as the row holds it. */
  readonly valueChars: number;
}

/**
 * The inputs layer's verdict on ONE ruled argument of ONE tool call (honesty
 * layer 2) — fired once per `argument` row the `sf-inputs` subflow files,
 * before the call dispatches. This version files `source: 'default'` (the
 * library filled the tool's declared `assume` value, or the model sent that
 * same value) and `source: 'model'` (the model sent another value the record
 * does not trace). Names, enums and counts only: never the value, a quote or
 * the model's proposal — those stay on the committed row, in the tool's own
 * argument view — and no `valueChars` when that view hides the argument. A
 * host counts "1 assumed" from these events. The standing fold never reads
 * them (it reads the committed rows).
 */
export interface FindingsArgumentPayload {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  /** The conversation turn the row was filed in. */
  readonly turn: number;
  readonly argument: string;
  readonly rule?: 'ask' | 'assume';
  readonly period?: true;
  readonly source?: ArgumentSource;
  readonly asked?: ArgumentAsked;
  readonly claimed?: ArgumentClaim;
  readonly matched?: 'quote' | 'phrase' | 'spelling' | 'mention';
  readonly reading?: true;
  readonly earlier?: true;
  readonly setAside?: 'open' | 'noise' | 'ruled-out';
  readonly argumentsFrom?: 'listed' | 'unlisted';
  readonly coincides?: 'person' | 'result' | 'app';
  readonly free?: true;
  readonly failed?: ArgumentCheckFailed;
  readonly malformed?: number;
  /** The length of the value as the row holds it — absent when the tool's view hides it. */
  readonly valueChars?: number;
}

/**
 * The results layer's verdict on ONE call's period (honesty layer 3, step 7b)
 * — fired once per `period` row the `sf-results` subflow files at the loop
 * head, after the call ran. The tool's name, the call's id, the stamps and the
 * verdict word ONLY: never an instant (the declared period stays on the
 * committed coverage row). `undeclared` means the tool declares a period
 * argument and this result said nothing about what its read covered. A host
 * counts "1 read the store did not hold" from these events; the standing fold
 * never reads them (it reads the committed rows).
 */
export interface FindingsPeriodPayload {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly iteration: number;
  /** The conversation turn the row was filed in. */
  readonly turn: number;
  readonly verdict: 'covered' | 'partly-held' | 'not-held' | 'unknown' | 'undeclared';
  /**
   * The time layer's result checks that hold on the row (step T8, under
   * `.time()` only) — their names, never a range: `period-differs-from-asked`,
   * `period-shifted`, `period-beyond-retention`, `partly-beyond-retention`.
   * Absent when none holds, and on every unarmed run.
   */
  readonly timeChecks?: readonly (
    | 'period-differs-from-asked'
    | 'period-shifted'
    | 'period-beyond-retention'
    | 'partly-beyond-retention'
  )[];
}

/**
 * One observe-only prose finding, filed with the answer: a detected claim or
 * a unit the bounded grammar could not judge. This is a warning, never an
 * enforcement decision or proof that the remaining prose is true.
 *
 * Only locations, checker codes, phrase-pack identities and native result
 * references leave the ledger. No answer text, candidate entity labels,
 * tool values or stale-read dates are included. Codes are owned by the
 * checker, not duplicated in this low-level event contract.
 */
interface FindingsNegativeClaimLocation {
  readonly iteration: number;
  /** The conversation turn when stamped by the runtime. */
  readonly turn?: number;
  /** JSON pointer into the answer; at most 4,096 UTF-16 code units. */
  readonly field: string;
  readonly span: { readonly start: number; readonly end: number };
  /** At most 128 UTF-16 code units. */
  readonly packVersion: string;
  /** At most 128 UTF-16 code units. */
  readonly phraseId?: string;
  /** Some metadata was shortened or omitted; references are not exhaustive. */
  readonly truncated?: true;
}

export type FindingsNegativeClaimPayload = FindingsNegativeClaimLocation &
  (
    | {
        readonly kind: 'negative-claim';
        readonly claim: 'none' | 'complete';
        /** At most 32 checker codes, each at most 128 UTF-16 code units. */
        readonly notes: readonly string[];
        /** At most 32 native result ids, each at most 256 UTF-16 code units. */
        readonly results: readonly string[];
      }
    | {
        readonly kind: 'negative-claim-note';
        /** The checker's unread-unit code, at most 128 UTF-16 code units. */
        readonly code: string;
      }
  );
