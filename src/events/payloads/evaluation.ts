import type { ScriptsVerdict } from './dependencyTypes.js';

// eval.* (3)
export interface EvalScorePayload {
  readonly metricId: string;
  readonly value: number;
  readonly threshold?: number;
  readonly target: 'iteration' | 'turn' | 'run' | 'toolCall';
  /**
   * What the score is about: the run id (`event.meta.runId`) for `'run'` /
   * `'turn'`, the iteration index for `'iteration'`, the provider's call id
   * for `'toolCall'`. A NAME, not a capability: run ids are minted in
   * sequence and anyone can write one, so a host filing a score from user
   * input (a feedback button) checks the run is that user's before it emits.
   * `otelObservability` parents a score to a run only when the score's own
   * meta places it in that run's session; otherwise it rides a span of its
   * own that names the ref.
   */
  readonly targetRef: string;
  readonly evaluator?: 'llm' | 'fn' | 'heuristic';
  readonly evidence?: Readonly<Record<string, unknown>>;
  /**
   * The evaluator's own reading of the score, in a small vocabulary it
   * documents — `'pass'` / `'fail'`, `'relevant'` / `'not_relevant'`.
   * Optional and never derived: a `threshold` does not say which
   * side of it passes, so no label is ever computed from one.
   * `otelObservability` exports it BY DEFAULT as
   * `gen_ai.evaluation.score.label` (the spec's "SHOULD have low
   * cardinality"), so it must be a word from that vocabulary — never a
   * judge's sentence, which belongs in {@link EvalScorePayload.explanation}.
   */
  readonly label?: string;
  /**
   * The evaluator's free-form reason for the score. It is CONTENT —
   * a judge's reason can quote the answer it graded — so
   * `otelObservability` exports it (`gen_ai.evaluation.explanation`) only
   * under `captureContent`.
   */
  readonly explanation?: string;
}

export interface EvalThresholdCrossedPayload {
  readonly metricId: string;
  readonly direction: 'above' | 'below';
  readonly value: number;
  readonly threshold: number;
  readonly actionTaken?: string;
}

/**
 * Emitted (v2.13) when the agent's final answer fails the agent's
 * configured `outputSchema` (the parser passed to
 * `Agent.create({...}).outputSchema(parser)`).
 *
 * Scope: ONLY agent-level final-answer validation. Tool-input validation
 * (`LLMToolSchema.inputSchema`) is a different concern handled by
 * provider-side type checks; this event does NOT fire for tool-arg
 * validation failures.
 *
 * Lives in the `agent.*` domain (parallel to `agent.turn_end`) because
 * final-answer validation is a turn-level concern, not a generic
 * evaluation metric.
 *
 * Pairs with `agentfootprint.error.retried` (when a reliability rule
 * routes the failure to retry with feedback) or
 * `agentfootprint.reliability.fail_fast` (when retries are exhausted).
 *
 * The event is the OBSERVABILITY signal — it fires on EVERY validation
 * failure, regardless of whether retries are configured. Use the
 * `attempt` + `cumulativeRetries` fields to drive operator dashboards
 * for retry-rate trending (a leading indicator for model drift).
 *
 * Fires BEFORE PostDecide rules evaluate, so observability sees the
 * failure even if a buggy rule routes to fail-fast or swallows it.
 */
/**
 * Emitted (7.26) once per failed final answer that the run is about to
 * ASK AGAIN about, on an agent built with
 * `.outputSchema(parser, { retries })`.
 *
 * Its sibling `agent.output_schema_validation_failed` reports a failure the
 * reliability gate is handling INSIDE one `call-llm` stage. This one reports
 * a failure the LOOP is handling: the corrective message named here joins the
 * conversation, the ReAct loop re-enters, and the next attempt arrives with
 * its own `stream.llm_start` / `stream.llm_end` bracket and its own
 * `cost.tick`. Subscribe to it to see how often a model needs a second ask —
 * a leading indicator of drift, and of a schema that is harder to hit than
 * its author thinks.
 *
 * Fires from the retry branch, after the corrective turn is committed, so a
 * consumer that reads `snapshot.sharedState.outputAttempts` finds the
 * matching row (joined by `correctiveMessageHash`) already there.
 */
/**
 * The run's answer does NOT satisfy its own `outputSchema` (8.18.0).
 *
 * Fires once, from the Route decider, on the run that hands back an answer the
 * contract rejects — including the default `retries: 0` case, where the first
 * answer is the only one. It is the event that was missing: `run()` returned
 * the failing string, `runTyped()` threw at a boundary the caller may not have
 * used, and nothing in between said a contract had been missed.
 *
 * Alert on it. A rise in `stage: 'json-parse'` is a model that stopped
 * honouring the instruction; a rise in `'schema-validate'` is drift against
 * the shape; any `brokenBy` at all is one of your own output rules.
 */
export interface AgentOutputContractUnmetPayload {
  /** Which half of validation failed. */
  readonly stage: 'json-parse' | 'schema-validate';
  /** The validator's own message, verbatim. DATA, not narrative. */
  readonly error: string;
  /** Failing field path when the parser exposes one (Zod-style issues). */
  readonly path?: string;
  /** Answers judged in this run, the first included. `1` under `retries: 0`. */
  readonly attempts: number;
  /** Corrective re-asks the run paid for. `0` under `retries: 0`. */
  readonly retriesSpent: number;
  /** True when `.outputFallback()` is configured — a tier `runTyped()` reaches
   *  and `run()` does not. */
  readonly fallbackConfigured: boolean;
  /** The ReAct iteration that produced the answer. */
  readonly iteration: number;
  /** Present when an `act({ output })` middleware rewrote an answer that had
   *  PASSED into one that fails — the name of that middleware. The run stops
   *  re-asking when this is set: the model's answer was already right. */
  readonly brokenBy?: string;
}

export interface AgentOutputSchemaRetryPayload {
  /** 1-based attempt that just failed. `1` is the first answer. */
  readonly attempt: number;
  /** Corrective asks left AFTER this one. `0` means this is the last. */
  readonly retriesRemaining: number;
  /** The ReAct iteration the failed answer came from. A retry consumes an
   *  iteration, so the next attempt reports `iteration + 1`. */
  readonly iteration: number;
  /** Which half of validation failed — `'json-parse'` (the model emitted
   *  prose) vs `'schema-validate'` (JSON, wrong shape). They trend
   *  differently under model drift. */
  readonly stage: 'json-parse' | 'schema-validate';
  /** The validator's own message, verbatim. DATA, not narrative: it is
   *  quoted into the corrective message after an authored frame, and it is
   *  quoted here the same way. */
  readonly error: string;
  /** Failing field path when the parser exposes one (Zod-style issues). */
  readonly path?: string;
  /** `fnv1a` of the corrective message that went back to the model — the
   *  join to the message in `history` and to the `outputAttempts` row. */
  readonly correctiveMessageHash: string;
}

/**
 * One verdict from the evidence gate (`.namesAndNumbersFromEvidence()`,
 * 9.35.0) — fired once per would-be-final answer the gate judged, whatever
 * the posture and whatever the outcome.
 *
 * It rides the emit channel rather than a CommitBundle because it is a fact
 * about ONE attempt, not conversation state; the only thing that reaches the
 * commit log is the terminal verdict (`unsupportedValues`), which the boundary
 * needs.
 *
 * **What this event does NOT claim:** the check catches values that appear in
 * no tool result. It cannot see a false statement assembled from real values,
 * so `action: 'grounded'` means "every name and number was read from
 * somewhere", never "the answer is true".
 */
export interface AgentEvidenceCheckedPayload {
  /** The ReAct iteration that produced the judged answer. */
  readonly iteration: number;
  /** The posture in force — `'assist'` records only, `'guard'` may revise
   *  once, `'rails'` may withhold the answer. */
  readonly posture: 'assist' | 'guard' | 'rails';
  /** How many distinct values the answer had to ground. `0` means the answer
   *  asserted nothing the extractor treats as data. INCLUDES exempt values —
   *  see {@link lookedUp}. */
  readonly candidates: number;
  /**
   * How many of `candidates` the gate actually looked up in the tool results:
   * the values found plus the values not found, before `unsupported` is
   * sliced. The rest were EXEMPT — the person's message, the conversation or
   * the app's own instructions (recalled memory included) already held them —
   * and were never looked up. Present on every row from the release that
   * added it; absent on a recording made before it, which therefore cannot
   * say how many values were looked up.
   */
  readonly lookedUp?: number;
  /** The values that appear in no tool result, truncated to a readable list.
   *  Empty when `action` is `'grounded'`. Under `code: 'match'` each says
   *  where it sat: `'code'` when every occurrence was inside a fenced block
   *  that matched no submission, `'prose'` otherwise. */
  readonly unsupported: readonly {
    readonly value: string;
    readonly shape: string;
    readonly region?: 'prose' | 'code';
  }[];
  /**
   *   • `'grounded'`       — every value was found; the answer stands.
   *   • `'revision-asked'` — the values went back to the model for one more
   *                          turn (emitted by the EvidenceRecheck branch).
   *   • `'flagged'`        — the answer ships carrying them, on the record.
   *   • `'refused'`        — `'rails'`: the answer was withheld and the
   *                          boundary raises `UnsupportedValuesError`.
   */
  readonly action: 'grounded' | 'flagged' | 'revision-asked' | 'refused';
  /** True when this judgement ran on an answer a revision already corrected —
   *  which is how a reader tells "the revision fixed it" (`grounded`, after
   *  revision) from "it did not" (`flagged`/`refused`, after revision). */
  readonly afterRevision: boolean;
  /** Set when the evidence index hit its ceiling and could not hold every
   *  tool result. The gate then records its verdict WITHOUT acting on it —
   *  a partial corpus can call a grounded value fabricated. */
  readonly evidenceTruncated?: boolean;
  /**
   * WHICH RESULTS OF THIS TURN THE ANSWER'S VALUES WERE READ FROM — on the
   * verdicts about an answer that ships (`'grounded'`, `'flagged'`,
   * `'refused'`), never on `'revision-asked'` (a draft). One entry per
   * `role: 'tool'` result of this turn that carried at least one of the
   * answer's names and numbers: `values` = how many, `only` = how many of
   * those no other result of this turn carried. A result of this turn that
   * is NOT listed carried none of them — a fact about tokens, not meaning:
   * read it as "the answer cites nothing from it", never "unused" (an answer
   * that states no value can still rest on a result). `[]` is a fact too:
   * no result of this turn carried any of them (an answer drawn from an
   * earlier turn, or one that states no value — `lookedUp` tells which).
   *
   * ABSENT when the list cannot be whole: the evidence index hit its ceiling,
   * or one value was carried by more results than the index keeps. Absent on
   * recordings made before the field existed. Identities and counts only,
   * never a value (`evidence/answerCarriers.ts`).
   */
  readonly carriedBy?: readonly {
    readonly toolCallId: string;
    readonly values: number;
    readonly only: number;
  }[];
  /**
   * On `action: 'revision-asked'` only, and only when the turn held placed
   * artifact tickets a served `wants` tool can spend: the refs the
   * correction NAMED as the route to a grounded number. Absent otherwise —
   * including for every agent without a `wants`-declaring tool.
   */
  readonly stagedRefs?: readonly { readonly ref: string; readonly kind: string }[];
  /** The spender tools the correction named, beside {@link stagedRefs}. */
  readonly spenderTools?: readonly string[];
  /**
   * Under the figures dial (`namesAndNumbersFromEvidence({ figures: true })`),
   * on `'grounded'`, `'flagged'` and `'refused'`: the numbers no tool result
   * carried that ARE a declared derivation of the numbers the results carry —
   * each with its `derivation` (`rounded`, `unit-scale`, `column-sum`,
   * `column-ratio`, `column-difference`, `complement`) and `from` (the
   * operands, in the results' own keys). Not read and not invented: the model
   * computed them. Present (possibly `[]`) exactly when the dial is on, so its
   * presence says the derivation check ran; the `unsupported` numbers beside
   * it matched no value AND no derivation. Sliced like `unsupported`.
   */
  readonly computed?: readonly {
    readonly value: string;
    readonly shape: string;
    readonly derivation: string;
    readonly from: string;
  }[];
  /**
   * Under `.namesAndNumbersFromEvidence({ code: 'match' })`, on a prose
   * answer: one verdict per fenced block the answer showed — a block equal,
   * byte for byte after removing only the Markdown wrapper, to a program a
   * call of THIS turn submitted to a declared code-running tool carries that
   * call's id, tool and label (`completed`, `outcome-unknown`, …) and was not
   * read for values; any other block is `unmatched` with a reason and was
   * read as prose. `earlierTurnRows` counts earlier turns' script rows (never
   * compared); `regionsDropped` the blocks past the cap. Never the code.
   */
  readonly scripts?: ScriptsVerdict;
}

/**
 * The staged-refs nudge fired (`.namesAndNumbersFromEvidence({ nudge: true })`)
 * — one per iteration whose request gained the late line naming staged
 * artifact refs and the `wants` tool that spends them.
 *
 * The line itself is request-only (never history), so this event is the ONE
 * record that it existed: which refs, which spenders, which iteration. A run
 * where the nudge never armed emits none of these.
 */
export interface AgentGroundingNudgedPayload {
  /** The ReAct iteration whose request carried the line. */
  readonly iteration: number;
  /** The staged refs the line named — `ref` verbatim, `kind` as minted
   *  (`Tool.resultKind` / `tool-result/<toolName>`). Capped; see
   *  {@link refsOmitted}. */
  readonly refs: readonly { readonly ref: string; readonly kind: string }[];
  /** Matched refs beyond the cap, stated rather than silently dropped.
   *  Absent when every match was named. */
  readonly refsOmitted?: number;
  /** The spender tools named, by their registered names — the tools whose
   *  declared `wants` matched a staged ref's kind, exact-string, never by
   *  tool name. */
  readonly tools: readonly string[];
}
