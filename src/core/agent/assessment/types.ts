/**
 * assessment/types — the answer's standing, as data.
 *
 * Pattern: plain types over one pure fold (`assess.ts` · `assessAnswer`).
 * Role:    core/ layer leaf. One public name leaves the `/observe` door —
 *          `AnswerAssessment`; its family (a reason, a witness, a check that
 *          ran) is reached by indexed access
 *          (`AnswerAssessment['reasons'][number]`), because every export is a
 *          page on the API site and the site's export-file budget has cost a
 *          release before (the answer account's precedent).
 *
 * WHICH WORD. In code, *standing* is the MODEL's word on one tool result
 * (`core/agent/findings/types.ts` · `Standing`). The whole answer's
 * known / not sure / ask is its ASSESSMENT — the value set of the
 * honest-answer design page (`assessment`: `known | unrefuted | unknown |
 * not-applicable`) — and `standing` on this type is the owner's rendering of
 * it (`known · consistent · not-sure · ask · not-assessed`), never a second
 * value set: it is derived from `assessment` and the reasons' class alone.
 */

/**
 * A leaf of the committed record a reason or a check rests on — an RFC 6901
 * pointer, the answer account's pointer shape (`lib/answer-account/types.ts` ·
 * `RecordPointer`), so a lens resolves both the same way:
 *
 * - `state` — a leaf of a committed key of the run's `sharedState`
 *   (`coverageDeclared`, `findingsLedger`, `unsupportedValues`,
 *   `stoppedEarly`, `answerValidation`, and `pausedToolCallId` or
 *   `argumentAsk` for a pause);
 * - `history` — a leaf of one `history` message (a tool result, by index).
 *
 * Always a LEAF (a string, a number), never a whole row, so "show me" can show
 * the pointer without showing the row. Every witness is in a saved recording:
 * the fold reads nothing a recording does not carry.
 */
export type AssessmentPointer =
  | { readonly kind: 'state'; readonly key: string; readonly path: string }
  | {
      readonly kind: 'history';
      readonly index: number;
      readonly path: string;
      readonly toolCallId?: string;
    };

/**
 * Why the answer does not stand as "known" or "consistent" — a CLOSED union,
 * each member read from one committed row (`reasons.ts` · `REASONS` names the
 * row, the layer and the class). Readers skip a member they do not know: the
 * union grows as later honesty steps add rows (the coverage `kind` precedent).
 *
 * - `asked` — the turn ended in a pause still waiting for a person: a typed
 *   input (`requestInput`), a question (`askHuman` / `pauseHere`), a consent
 *   gate (a tool's `checkIn`, a middleware's `ask`) or a credential consent —
 *   read from the committed state the pause leaves (`pausedToolCallId`);
 * - `declared-absent` — a tool declared that nothing matched: an `absent()`,
 *   or an empty rowset inside a declared `coverage()` boundary;
 * - `coverage-gap` — a tool declared ground it did not check or can never
 *   cover (`notChecked`, `cannotCover`) — on its coverage row, or, when the
 *   record holds no row for the call, in the result's own envelope;
 * - `empty-undeclared` — an empty rowset that said nothing about what it
 *   searched: silence recorded as silence;
 * - `sources-conflict` — two readings the model stood on disagree (a
 *   `ConflictRow` naming a call of this turn);
 * - `value-unsupported` — names or numbers in the answer appear in no tool
 *   result (`unsupportedValues`);
 * - `value-survived-revision` — the same, after the one revision the gate
 *   asked for;
 * - `stopped-early` — a limit cut the turn short (`stoppedEarly`);
 * - `answer-check-failed` — the app's answer checks (`.answerValidation()`)
 *   failed this answer;
 * - `check-unreachable` — an armed check could not reach a verdict (the
 *   answer checks reported `unverified`);
 * - `argument-assumed` — a call of this turn ran on a value a tool's rule
 *   assumed (an `argument` row with `source: 'default'` — the library filled
 *   the declared default, or the model sent that same default), or a
 *   before-tool middleware rewrote a ruled argument without declaring where
 *   the value came from (honesty layer 2);
 * - `argument-unverified` — a call of this turn ran on a value of a ruled
 *   argument the record does not trace to the person, a result or the app
 *   (an `argument` row with `source: 'model'`), or a declared source that
 *   failed its check (honesty layer 2);
 * - `argument-asked` — the turn ended waiting on the inputs layer's own ask:
 *   a batch left `ask`-ruled arguments out (or, under declared sources, sent
 *   values the checks did not trace), the library asked the person for them
 *   before anything ran, and no answer has come yet (the batch ask's working
 *   state, `argumentAsk`, still has a question out; the `asked` rows name
 *   which values). Nothing in that batch has run (honesty layer 2);
 * - `argument-read` — a call of this turn ran on a value the model READ into
 *   the person's words: the quote it declared is in their messages, the value
 *   is not in it (an `argument` row with `source: 'said'` and `reading`;
 *   honesty layer 2, declared sources);
 * - `value-contingent` — a call of this turn ran on a value taken from a
 *   result the model itself had set aside (`open`, `noise`, `ruled-out`): an
 *   `argument` row with `source: 'result'` and `setAside`, or a
 *   `ContingentRow` of this turn (honesty layer 2);
 * - `period-not-held` — a result declared the period its read covered, and
 *   the store holds NONE of what the read asked for (a `period` row with
 *   verdict `not-held` — the results layer, honesty layer 3): "the data ends
 *   at 02:00; the hour asked about is after it";
 * - `period-partly-held` — the store holds only part of it (`partly-held`);
 * - `period-unknown` — the tool said it cannot vouch for what its store holds
 *   (`held: 'unknown'` → `unknown`), even on a non-empty result: an answer
 *   built over a period the store may not hold rests on less than it says
 *   (adopted Q33 — a bench cell decides whether it stays);
 * - `period-undeclared` — the tool declares a period argument (a
 *   `ToolPeriod`) and this result said nothing about what its read covered:
 *   declared silence, recorded as silence (`undeclared`).
 * - `period-differs-from-asked` — what a call read is not the range it
 *   asked for: narrower (`missing`), wider (`extra` — "not sure" by default,
 *   TQ8), or shifted (both); or, for a window the model chose, not the
 *   person's window (a `period` row of this turn with `differs`; the time
 *   layer, step T8);
 * - `period-beyond-retention` — the window a call asked for was wholly older
 *   than the tool declares its source keeps (a `period` row of this turn
 *   with `beyondRetention`; the time layer, step T8);
 * - `derived-from-reading` — the answer states a time value no tool result
 *   carried that the library itself spelled from a reading of the person's
 *   words this turn — an implied year, an offset, the end-of-grain minute, a
 *   value of the served time line (a `time-derived` row of this turn; the
 *   time layer, step T7). Not invented and not the person's: folded like
 *   `argument-assumed`;
 * - `steps-unfinished` — the answer came before the active skill's declared
 *   steps finished: the one teaching nudge was already spent, or a limit
 *   forced the answer (a `steps-unfinished` witness row of this turn, filed
 *   while the answer layer is armed — honesty layer 4).
 */
export type AssessmentReason =
  | 'asked'
  | 'argument-asked'
  | 'argument-assumed'
  | 'argument-unverified'
  | 'argument-read'
  | 'value-contingent'
  | 'declared-absent'
  | 'coverage-gap'
  | 'empty-undeclared'
  | 'period-not-held'
  | 'period-partly-held'
  | 'period-unknown'
  | 'period-undeclared'
  | 'period-differs-from-asked'
  | 'period-beyond-retention'
  | 'sources-conflict'
  | 'value-unsupported'
  | 'value-survived-revision'
  | 'derived-from-reading'
  | 'stopped-early'
  | 'steps-unfinished'
  | 'answer-check-failed'
  | 'check-unreachable';

/**
 * A check whose verdict this turn's committed record holds — what actually ran,
 * printed as it is, never a fixed list. `of` is how many subjects the check
 * applied to on the record, `ran` how many it reached a verdict on.
 *
 * - `tool-coverage` — the calls of this turn that declared what they covered
 *   (a coverage row), of the calls of this turn;
 * - `result-shape` — the results of this turn whose shape could be read (the
 *   one emptiness reader did not say `unknown`), of the results in the turn's
 *   history;
 * - `names-and-numbers` — the evidence gate's verdict, when it is committed:
 *   a flagged verdict (`unsupportedValues`) on every armed gate, and — while
 *   the answer layer is armed (honesty layer 4) — its clean pass too (a
 *   `grounded` witness row of this turn). A clean pass is a membership pass:
 *   it counts as a check that ran, never as support;
 * - `answer-checks` — the app's answer checks (`answerValidation`);
 * - `argument-rules` — the ruled arguments of this turn's calls that the
 *   inputs layer filed a verdict on (honesty layer 2), of the same — every
 *   `argument` row IS a verdict; present only when the layer filed one;
 * - `argument-sources` — of the argument rows of this turn the declared-sources
 *   check judged (a row that carries `claimed`: `.findings({ argumentSources:
 *   true })`), the ones it reached a verdict on (every one but `uncheckable`);
 *   present only when the arm filed one. A pass here never supports "known".
 * - `result-period` — this turn's calls the results layer filed a period
 *   verdict on (honesty layer 3), of the same — every `period` row IS a
 *   verdict, `covered` included; present only when the layer filed one.
 */
export type AssessmentCheck =
  | 'argument-rules'
  | 'argument-sources'
  | 'result-period'
  | 'tool-coverage'
  | 'result-shape'
  | 'names-and-numbers'
  | 'answer-checks';

/** The honesty layer a reason or a check belongs to: 1 choose · 2 inputs · 3 results · 4 answer. */
export type HonestyLayer = 1 | 2 | 3 | 4;

/**
 * One answer's assessment, folded from its committed record.
 *
 * `assessment` (the value) — precedence: a reason fired → `unknown`; else a
 * supporting row → `known`; else a check ran → `unrefuted`; else
 * `not-applicable`. Never `known` from silence: only a TIE check supports it
 * (in this version, a passed enforce `.answerValidation()` report for these
 * bytes), and a membership pass never does.
 */
export interface AnswerAssessment {
  readonly assessment: 'known' | 'unrefuted' | 'unknown' | 'not-applicable';
  /**
   * The owner's words for it, as data: `known`; `consistent` (checks ran, none
   * fired — never "known", never "verified"); `ask` (a reason of the ask
   * class fired); `not-sure` (any other reason); `not-assessed` (nothing the
   * record holds could be checked). Ask > not sure > known > consistent > not
   * assessed.
   */
  readonly standing: 'known' | 'consistent' | 'not-sure' | 'ask' | 'not-assessed';
  /** Every reason that fired, in `REASONS` order, each with the rows it rests on. */
  readonly reasons: readonly {
    readonly reason: AssessmentReason;
    /** The honesty layer; absent for a reason that belongs to every layer (`asked`, `check-unreachable`). */
    readonly layer?: HonestyLayer;
    readonly witness: readonly AssessmentPointer[];
  }[];
  /** The row `known` stands on — present only when one does. */
  readonly support?: {
    readonly kind: 'answer-validation';
    /** The report's `candidateDigest`: the exact bytes the passed checks judged. */
    readonly reportDigest: string;
  };
  /** What actually ran this turn, printed verbatim — never a fixed list. */
  readonly checked: readonly {
    readonly layer: HonestyLayer;
    readonly check: AssessmentCheck;
    readonly ran: number;
    readonly of: number;
    /** The rows behind `ran`. */
    readonly witness: readonly AssessmentPointer[];
  }[];
  /**
   * Where the turn this fold read begins: `person` — after the last message a
   * person said (`lib/saidByPerson.ts` · `isSaidByPerson`), the one owner of
   * "a person said it"; `whole-history` — no such message is on the record,
   * so every result in `history` was read (it may over-report; it never hides).
   */
  readonly turnFrom: 'person' | 'whole-history';
}

/**
 * The committed record the fold reads — a recording (`recordRun`), a snapshot
 * (`agent.getLastSnapshot()`), or a paused run's checkpoint.
 */
export interface AssessmentRecord {
  /** The run's snapshot — `recording.snapshot`, `agent.getLastSnapshot()`. Its `sharedState` is read. */
  readonly snapshot?: unknown;
  /**
   * A paused run's checkpoint (`RunnerPauseOutcome.checkpoint`) — for a host
   * that kept only that: its `sharedState` is read when no snapshot is given.
   * Never needed to read the pause itself: the pause is in the committed state
   * (`pausedToolCallId`), which the snapshot, the checkpoint and a saved
   * recording all carry, so the fold says `ask` with or without it.
   */
  readonly checkpoint?: unknown;
}

/**
 * What the APP declares when the fold runs — not on the record. Any
 * `AnswerAccountDeclarations` (the answer account's object, exported on the
 * observe door) is accepted as it is; the fold reads only
 * `tools[name].rowsAt`, where an OBJECT-shaped result keeps its rows.
 */
export interface AssessmentDeclarations {
  readonly tools?: Readonly<Record<string, { readonly rowsAt?: string }>>;
}
