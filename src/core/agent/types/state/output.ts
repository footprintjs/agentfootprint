import type { OutputAttempt } from '../../outputEnforcement.js';

export interface OutputState {
  // ── The output-schema ledger (`.outputSchema(s, { retries })`) ──────────
  /** One row per final-answer attempt, in order: what was answered, whether
   *  it satisfied the schema, and — when it did not — the validator's own
   *  words and the correction that went back. Read it from
   *  `snapshot.sharedState` to see why a run took three turns to answer.
   *  Written only by an agent that opted into `retries`; absent otherwise. */
  outputAttempts?: readonly OutputAttempt[];
  /**
   * How the delivered answer's SHAPE was secured (9.100.0) — written by the
   * Route decider on the turn it picks `final`, absent before:
   *   - `'native'` — the provider decoded the answer under the output
   *     schema's structured-output format (`output_config.format`), and the
   *     parser then judged it (`'native'`, or `'auto'` when supported);
   *   - `'tool-forced'` — the provider was forced BY NAME to answer through
   *     the output schema's synthetic tool, so the shape held on the wire
   *     (`.outputSchema(s, { strategy: 'tool-forced' })`);
   *   - `'checked'` — the answer was generated as text and the output schema
   *     parsed it afterwards (`'instruct'`, or `'auto'` when native is unavailable);
   *   - `'none'` — no output schema: free text, no shape claimed.
   * A guarantee is a fact about how the answer was obtained, distinct from
   * `answerValidation` (host checks over its content).
   */
  answerGuarantee?: 'native' | 'tool-forced' | 'checked' | 'none';
  /** Host-authored checks over the exact terminal answer; absent when disabled. */
  answerValidation?: import('../../../../answer-validation/index.js').AnswerValidationReport;
  /** Refusal carrier: prevents final capture, history, memory and token delivery. */
  answerValidationBlocked?: boolean;
  /**
   * This run's tool calls — name, call id, outcome; never arguments or
   * results — the ledger `answerValidation` hands a check as
   * `context.toolCalls`. Written beside every `stream.tool_end` bracket, and
   * ONLY on an agent with `answerValidation` (`ToolCallsHandlerDeps.toolCallLedger`),
   * so every other agent commits exactly the keys it always did. Run state:
   * seed starts a fresh, empty one on every run; a pause carries it to the
   * resumed leg.
   */
  toolCallLedger?: import('../../../../answer-validation/toolLedger.js').ToolCallLedger;
  /** Set only at the final capture after a validation report was accepted. */
  answerValidationCommitted?: boolean;
  /** In-flight hand-off from the Route decider (which judges the answer and
   *  picks the branch) to the retry stage (which writes the correction). Not
   *  a record — the record is `outputAttempts`. Always freshly written by the
   *  decider immediately before the retry branch runs, so it is never read
   *  stale. */
  outputSchemaFailure?: {
    readonly attempt: number;
    readonly stage: 'json-parse' | 'schema-validate';
    readonly error: string;
    readonly path?: string;
    /** `'native'` only: the stop that failed the attempt. */
    readonly stopReason?: import('../../outputEnforcement.js').NativeStopReason;
  };
  /**
   * The answer this run hands back does NOT satisfy the output contract (8.18.0).
   *
   * Written by the Route decider on the one occasion the schema was judged and
   * the answer failed with no re-ask left — including the `retries: 0` case,
   * where there was never a re-ask to spend. Absent on every run whose answer
   * passed, and on every agent with no `.outputSchema()`.
   *
   * Committed rather than returned for the reason `stoppedEarly` is: `run()`
   * returns a bare string and has nowhere to carry the fact, and the fact is
   * not an error the library gets to raise on its own — `runTyped()` raising is
   * the caller ASKING to be raised at. So it goes in the commit log, where it
   * is provable after the run. Read it with `agent.outputContractUnmet()`.
   */
  outputContractUnmet?: {
    /** Which half of validation failed. */
    readonly stage: 'json-parse' | 'schema-validate';
    /** The validator's own message, verbatim. DATA, not narrative. */
    readonly error: string;
    /** Failing field path when the parser exposes one (Zod-style issues). */
    readonly path?: string;
    /** Answers actually judged, first one included. `1` under `retries: 0`. */
    readonly attempts: number;
    /** Corrective re-asks the run paid for. `0` under `retries: 0`. */
    readonly retriesSpent: number;
    /** True when `.outputFallback()` is configured — in which case a tier
     *  exists that `run()` never reaches and `runTyped()` does. */
    readonly fallbackConfigured: boolean;
    /** Set when an `act({ output })` middleware's own rewrite broke an answer
     *  that HAD satisfied the schema — the name of that middleware. */
    readonly brokenBy?: string;
    /** Native output (explicit or auto): the provider's stop that failed the last
     *  attempt (`'refusal'`, `'max_tokens'`, `'model_context_window_exceeded'`).
     *  `runTyped()` throws on such an answer even where its text parses. */
    readonly stopReason?: import('../../outputEnforcement.js').NativeStopReason;
  };
}
