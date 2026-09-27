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
 *   `stoppedEarly`, `answerValidation`);
 * - `history` — a leaf of one `history` message (a tool result, by index);
 * - `checkpoint` — a leaf of the paused run's checkpoint (a pending ask).
 *
 * Always a LEAF (a string, a number), never a whole row, so "show me" can show
 * the pointer without showing the row.
 */
export type AssessmentPointer =
  | { readonly kind: 'state'; readonly key: string; readonly path: string }
  | {
      readonly kind: 'history';
      readonly index: number;
      readonly path: string;
      readonly toolCallId?: string;
    }
  | { readonly kind: 'checkpoint'; readonly path: string };

/**
 * Why the answer does not stand as "known" or "consistent" — a CLOSED union,
 * each member read from one committed row (`reasons.ts` · `REASONS` names the
 * row, the layer and the class). Readers skip a member they do not know: the
 * union grows as later honesty steps add rows (the coverage `kind` precedent).
 *
 * - `asked` — the turn ended in a typed ask still waiting for its answer (a
 *   tool's own `requestInput`), read from the paused run's checkpoint;
 * - `declared-absent` — a tool declared that nothing matched: an `absent()`,
 *   or an empty rowset inside a declared `coverage()` boundary;
 * - `coverage-gap` — a tool declared ground it did not check or can never
 *   cover (`notChecked`, `cannotCover`);
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
 *   answer checks reported `unverified`).
 */
export type AssessmentReason =
  | 'asked'
  | 'declared-absent'
  | 'coverage-gap'
  | 'empty-undeclared'
  | 'sources-conflict'
  | 'value-unsupported'
  | 'value-survived-revision'
  | 'stopped-early'
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
 * - `names-and-numbers` — the evidence gate's verdict, when it is committed
 *   (today only a flagged verdict is: `unsupportedValues`);
 * - `answer-checks` — the app's answer checks (`answerValidation`).
 */
export type AssessmentCheck =
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
 * (`agent.getLastSnapshot()`), and/or a paused run's checkpoint.
 */
export interface AssessmentRecord {
  /** The run's snapshot — `recording.snapshot`, `agent.getLastSnapshot()`. Its `sharedState` is read. */
  readonly snapshot?: unknown;
  /**
   * The paused run's checkpoint (`RunnerPauseOutcome.checkpoint`), when the
   * turn ended in a pause: a typed ask still waiting is read from its
   * `pauseData`, never from an event, and its `sharedState` stands in when no
   * snapshot is given.
   */
  readonly checkpoint?: unknown;
}

/**
 * What the APP declares when the fold runs — not on the record. The same
 * object the answer account takes (`AnswerAccountDeclarations`); the fold
 * reads only `tools[name].rowsAt`, where an OBJECT-shaped result keeps its rows.
 */
export interface AssessmentDeclarations {
  readonly tools?: Readonly<Record<string, { readonly rowsAt?: string }>>;
}
