export interface HonestyState {
  /** Dispatch-owned evidence about this native turn's program execution. */
  codeExecutionReceipt?: import('../../scripts/executionEvidence.js').CodeExecutionReceipt;
  /** Evidence from the admitted checkpoint of the immediately previous answer. */
  previousCodeExecutionReceipt?: import('../../scripts/executionEvidence.js').CompletedCodeExecutionReceipt;
  /** The accepted prose's method claims checked against the owned turn. */
  answerExecutionClaims?: import('../../assessment/answer/receipt/observe.js').RecordedExecutionClaimAssessment;
  /** Admitted offers and attempts for this turn's declared-source check. */
  sourceConsultation?: import('../../honesty/sourceConsultation.js').SourceConsultationRecord;
  /** The failed turn was recovered without its private choice identity bank. */
  sourceConsultationInterrupted?: true;
  /** A grouped call's committed recall observation, lifted into the outer findings ledger. */
  retrievalRequest?: import('../../honesty/retrievalRequests.js').RetrievalRequestRow;
  /** Some result-limit facts could not be retained in this turn's bounded list. */
  libraryResultLimitsIncomplete?: true;
  /** Framework-imposed limits on this turn’s tool results, recorded where each limit takes effect. */
  libraryResultLimits?: readonly import('../../honesty/libraryResultLimits.js').LibraryResultLimit[];
  /** One native protocol correction per human request; never a conversation-derived allowance. */
  sourceDeclarationCorrectionSpent?: true;
  /** Already masked omission observations, pending their actual batch-barrier settlement. */
  argumentSourceOmissionRows?: readonly import('../../arguments/rows.js').ArgumentRow[];
  // ── The honesty layers (`sf-inputs`, …) ───────────────────────
  /**
   * Which honesty layers this run armed — the ONE run constant, written once
   * by seed (`honesty/armed.ts`), absent on a run that armed none. A reader
   * of the record tells "armed, filed nothing" from "never armed" by it.
   */
  honestyLayers?: import('../../honesty/armed.js').HonestyLayers;
  /** This Agent turn's bounded tool entry proofs, retained independently of history eviction. */
  enteredToolCalls?: readonly import('../../honesty/enteredToolCalls.js').EnteredToolCall[];
  /** Whether this turn retained all observed entries within the ledger limit. */
  enteredToolCallsComplete?: boolean;
  /** The current turn's content-free, occurrence-keyed settlement facts. */
  settledToolCalls?: readonly import('../../recordedCalls.js').RecordedToolSettlement[];
  /** Whether every settled call of this turn has a readable fact. */
  settledToolCallsComplete?: boolean;
  /**
   * The answer's standing, as data — written by the answer layer's stage at
   * the head of the Final branch (honesty layer 4, `assessment/stage.ts` ·
   * `assessAnswerStage`) and read by PrepareFinal, one stage later, to put it
   * on `turn_end.answerAssessment`. Final-branch WORKING state: the branch
   * mount's output mapping never carries it back, so the run's own state
   * never holds it — the standing is derived, never stored beside the rows it
   * is folded from (`agent.assessment()` folds them again, to the same value).
   */
  answerAssessment?: import('../../assessment/compose.js').AnswerAssessmentData;
  /**
   * The answer's standing as one line for the person — composed by the same
   * stage under `.answerLayer({ standingLine: true })` and appended to a
   * prose answer by PrepareFinal. Final-branch working state, like
   * `answerAssessment`.
   */
  answerStandingLine?: string;
  /**
   * The app's words the line used — registered tool name → its
   * `displayName`, for the tools the line's reasons rest on that declare one.
   * Written by the same stage only when there is one, and put on
   * `turn_end.standingLineNames` by PrepareFinal, so a reader of the record
   * rebuilds the very line. Final-branch working state, like
   * `answerStandingLine`.
   */
  answerStandingNames?: Readonly<Record<string, string>>;

  /** The opt-in reason filter omitted this turn's otherwise eligible standing line. */
  answerStandingLineOmittedByRaiseOn?: true;
  /**
   * What the inputs layer (honesty layer 2) hands ToolCalls for the batch it
   * resolved — per call, the declared defaults to FILL, or the sentence the
   * call reads instead of running. Written by the `sf-inputs` mount's output
   * mapper only when there is something to apply (a top-level array under
   * `arrayMerge: Replace`), each entry stamped with its batch's iteration, and
   * read by ToolCalls only under the arm. Working state: it holds the RAW
   * filled value, because the call must run with it — never a row, an event
   * or a lens view (the rows carry the value in the tool's own view).
   */
  argumentResolutions?: readonly import('../../arguments/resolve.js').ArgumentResolution[];
  /**
   * The inputs layer's BATCH ASK in progress (honesty layer 2) — the fields
   * of the one typed ask ToolCalls raised before anything in the batch ran,
   * how often each was asked, the answers bound so far, and the question now
   * out (`waiting`). Written by ToolCalls only, only while an ask for THIS
   * batch is unsettled, and cleared when it settles — so a run whose record
   * ends with this key present ended waiting on the library's ask (the
   * answer's standing reads it: `argument-asked`). Working state: it holds
   * the RAW answers, because the calls must run with them — never a row, an
   * event or a lens view.
   */
  argumentAsk?: import('../../arguments/ask.js').ArgumentAskState;
  /**
   * The person's answers to the inputs layer's ask that a call could NOT use
   * (honesty layer 2): the batch that asked resumes with the answer and has
   * no second pause to give, so a call of it that needs a person again — its
   * check-in, a middleware `ask`, a credential consent, the tool's own pause —
   * is refused, and its answered values are kept here. The next call of the
   * same tool that leaves the same argument out, this turn, runs with the
   * kept answer (filed `answered`, no second question), and the batch that
   * fills from it drops it (`arguments/kept.ts`). Written by ToolCalls only,
   * only when such a refusal happens; read by the inputs layer's mount.
   * Working state: it holds the RAW answers, because the call must run with
   * them — never a row, an event or a lens view.
   */
  argumentAnswersKept?: readonly import('../../arguments/kept.js').KeptAnswer[];
  /**
   * WHO WROTE `userMessage`, when it was not a person — `'composed'`: another
   * runner's output handed on by a composition (`Sequence`, `Loop`, or your
   * own code, through `AgentInput.messageFrom`). A run constant written once
   * by seed, and ONLY on an agent whose declared sources are armed
   * (`.inputsLayer({ argumentSources: true })` or `.findings({ argumentSources:
   * true })`), its one reader: a quote found
   * only in this run's own message is another model's words, never the
   * person's (`failed: 'composed-message'`). Absent on every other run.
   * (Its own key: the run input's `messageFrom` is read-only in scope.)
   */
  userMessageFrom?: 'composed';
}
