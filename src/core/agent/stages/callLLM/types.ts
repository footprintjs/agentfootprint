import type {
  LLMCallHooks,
  LLMProvider,
  LLMRequest,
  LLMToolSchema,
  PricingTable,
} from '../../../../provider-contract/types.js';
import type { CacheStrategy } from '../../../../cache/types.js';
import type { ExternalGround } from '../../../../integrity/unsupported-argument/check.js';
import type { ReceiptDigests } from '../../receipt/receiptDigests.js';
import type { EvictedTurnsHandle } from '../../window/evictedTurns.js';
import type { ResolvedCostBudget } from '../../../cost.js';
import type { ReliabilityConfig } from '../../../../reliability/types.js';
import type { OutputSchemaParser } from '../../../../answer-validation/outputSchema.js';

import type { FindingsAnswerAsk, FindingsServeMode } from '../../findings/serve.js';

export interface CallLLMStageDeps {
  /** Preserve approved replay retirement for recovery before transport. */
  readonly onReplayPrepared?: LLMCallHooks['onReplayPrepared'];
  /** The LLM provider to invoke. */
  readonly provider: LLMProvider;
  /** Model identifier passed to provider.complete/stream. */
  readonly model: string;
  /** Optional sampling temperature. */
  readonly temperature?: number;
  /** Optional max output tokens. */
  readonly maxTokens?: number;
  /** A terminal policy owns delivery; keep provider drafts off the token channel. */
  readonly suppressDraftTokens?: boolean;
  /** Output middleware has not judged this draft; keep lifecycle/usage, not its text. */
  readonly withholdDraftContent?: true;
  /** Read recovery state only on an agent whose evidence gate can revise. */
  readonly hasEvidenceRecovery?: boolean;
  /**
   * The evidence gate's revision turns the tools off (an enforcing answer
   * validation, `AgentState.toolsOffAfterRevision`). Present only then: an
   * unarmed agent never reads the key.
   */
  readonly toolsOffAfterRevision?: true;
  /**
   * THE FINDINGS LEDGER IS ARMED (9.101.0, `.findings()`) — present only
   * then, only ever `true`. Three reads change and nothing else: the choice
   * seam hands `unsupportedArgumentsOf` each armed call's args WITHOUT the
   * reserved `_findings` argument (its assertion text would be judged as
   * identifiers); `postValidate` judges the answer with its `_findings` taken
   * off (it runs BEFORE the route decider — a strict schema would otherwise
   * reject a correct answer and loop `outputRetry`); and (9.114.2) the
   * `stream.token` chunks and the `stream.llm_end` content are what the
   * content shows with its `_findings` taken off — the scanner the peel uses
   * (`findings/answerText.ts`), so the text streamed is the answer returned.
   * `systemPieces`, `activeToolSchemas` and the receipt are untouched.
   */
  readonly findings?: true;
  /**
   * DECLARED SOURCES ARE ARMED (honesty layer 2) — present only then, only
   * ever `true`. Read in ONE place, and only without `findings`: declared
   * sources without the ledger (`.inputsLayer({ argumentSources: true })`)
   * plant `_findings` on RULED tools only, so the choice seam peels a call's
   * arguments exactly where the served schema carries the decoration
   * (`findings/reserved.ts` · `carriesFindingsDecoration`) — a quote in
   * `from` is the person's words, never an identifier the call asserts — and
   * its enum fence reads the schema without it. Under `findings` every call is
   * peeled as before.
   */
  readonly argumentSources?: true;
  /**
   * THE LEDGER IS SERVED (9.101.0, step 3) — present only under `.findings()`,
   * only ever `true`, threaded beside `findings` by `Agent.ts`. It gates
   * EVERY read of `scope.findingsLedger` in this stage: the piece
   * (`findings/serve.ts · findingsLedgerPiece`, joined AFTER the recovery
   * piece — order recovery → findings, FIXED, mirrored by
   * `servedView.ts · viewOf`) and the collapse (`collapseJudged`, applied to
   * the message list BEFORE the staged-refs nudge and BEFORE the receipt
   * mint, so the receipt hashes what was sent). An unarmed agent never
   * reads the key — a tracked read of an always-absent key is the phantom
   * context source `window/evictedTurns.ts` names.
   */
  readonly hasFindingsLedger?: true;
  /**
   * How judged results are served (9.101.0, step 3) — `AgentOptions.findings.serve`,
   * threaded under the same gate; absent ⇒ `'ledger-and-facts'`. The same
   * value seed puts on the record as the run constant `findingsServe`, which
   * is how the rebuild collapses the way the wire did.
   */
  readonly findingsServe?: FindingsServeMode;
  readonly findingsContextBytes?: number;
  /**
   * The answer-turn ask (9.103.0) — `AgentOptions.findings.answerAsk`,
   * threaded under the same gate and ONLY when it is `'quote-facts'`; absent
   * ⇒ `'none'`, the piece as it was. The same value seed puts on the record
   * as the run constant `findingsAnswerAsk`, which is how the rebuild
   * appends the ask the way the wire did.
   */
  readonly findingsAnswerAsk?: FindingsAnswerAsk;
  /**
   * TOOL CHOICE BY CLASSIFIER IS ARMED (9.105.0, `.toolChoice()`) — present
   * only then, only ever `true`. ONE thing changes: after the reply, this
   * stage files the `outcome` row under `scope.toolChoices` (the tools the
   * model called, `firstAgrees` against the pick the tools slot filed for
   * this iteration, and any `miss` against the narrowed served list) — the
   * same stage that assembled the request, so pick → served → called is one
   * triple per call. Written only when a pick was attempted for this
   * iteration. An unarmed agent never reads the key.
   */
  readonly toolChoice?: true;
  /**
   * THE DECLARED ONTOLOGY IS ARMED (9.106.0, `.ontology()`) — present only
   * then, only ever `true`. It gates the ONE read of the run constant
   * `scope.ontology` in this stage: the piece
   * (`ontology/serve.ts · ontologyPiece`, loaded through `import()` — the
   * `judgeLanded` precedent — and joined AFTER the recovery piece and BEFORE
   * the findings piece: injections → recovery → ontology → findings, FIXED,
   * mirrored by `servedView.ts · viewOf`) and the `ontology.served` event.
   * An unarmed agent never reads the key — a tracked read of an always-absent
   * key is the phantom context source `window/evictedTurns.ts` names.
   */
  readonly ontology?: true;
  /**
   * The time layer's served line is armed (`.time({ reader })` beside the
   * inputs layer, step T6b) — only then does the stage read `scope.timeLine`.
   * An unarmed agent never reads the key (the `ontology` precedent above).
   */
  readonly timeLine?: true;
  /** Optional pricing adapter for cost tracking. */
  readonly pricingTable?: PricingTable;
  /** Optional cumulative USD cap per run. */
  readonly costBudget?: ResolvedCostBudget;
  /** Hard ReAct iteration cap (used to compute iterationsRemaining for
   *  the cache strategy's prepareRequest hook). */
  readonly maxIterations: number;
  /** Cache strategy (provider-aware; v2.6+). Pass-through if no markers. */
  readonly cacheStrategy: CacheStrategy;
  /** Host-supplied strategies retain authority over model-aware defaults. */
  readonly cacheStrategyIsOverride?: true;
  /** Static tool schemas, late-bound (see seed.ts for the same
   *  pattern — toolSchemas is computed AFTER stage factories are
   *  built). The getter resolves the eventual value at run time. */
  readonly toolSchemas: readonly LLMToolSchema[];
  /**
   * The declared argument-ground edges (`Tool.argumentsFrom`), by tool name
   * (9.60.0). Present only when at least one registered tool declared one;
   * absent → neither the dangling-reference check nor the unsupported-argument
   * check runs, byte-identical.
   *
   * ONE DECLARATION, TWO SEAMS (9.63.0). `dangling-reference` asks, at request
   * assembly, whether the ground is still in reach while the tool is OFFERED;
   * `unsupported-argument` asks, after the response lands, whether the value
   * the model chose came from that ground when the tool was CALLED.
   */
  readonly toolGrounding?: ReadonlyMap<string, readonly string[]>;
  /**
   * The app's external-ground provider (9.72.0) — see
   * `AgentOptions.externalGrounds`. Consulted once per response with an armed
   * call; its entries join the choice-seam corpus and each excusal files
   * `agentfootprint.integrity.external_ground_used` with the entry's source
   * label. Absent → the corpus is exactly what it always was.
   */
  readonly externalGrounds?: () => readonly ExternalGround[];
  /**
   * The write seam's `empty-lookup` notice is armed (9.77.0) — present ONLY
   * when the operator turned `AgentOptions.noticeEmptyLookups` on AND at least
   * one tool declares `argumentsFrom`, the same two halves the ledger arms on.
   *
   * The CHECK itself lives at the tool-dispatch boundary, where a result
   * exists. This stage owns exactly one thing for it: the honest
   * `not-applicable` when a response made NO armed call. That has to be said
   * from a stage every iteration passes through — the tool-calls handler only
   * runs when the model asked for a tool, so a run that never calls one would
   * otherwise leave an armed row untouched, and `assertAlive` would read that
   * as the wiring rot it is not.
   */
  readonly noticeEmptyLookups?: boolean;
  /**
   * The names of tools declaring `Tool.resultColumns` (9.78.0), present ONLY
   * when the operator's `checkColumnTypes` dial is off `'off'` AND at least
   * one tool declares columns — the same two halves the ledger arms on.
   *
   * This stage owns exactly one thing for the column-type contract, and it is
   * the `noticeEmptyLookups` job above verbatim: the honest `not-applicable`
   * when a response asked for NO declaring tool. The judging happens where
   * the rows are.
   */
  readonly columnDeclaringTools?: ReadonlySet<string>;
  /**
   * The staged-refs nudge's harvest (`.namesAndNumbersFromEvidence({ nudge:
   * true })`) — `Tool.wants` by tool name, present ONLY when the dial is on
   * AND at least one registered tool declares `wants`; absent → this stage
   * reads nothing new and every request keeps its exact bytes.
   *
   * When present, an iteration whose conversation holds placed artifact
   * tickets a currently-served spender can consume gets ONE extra `role:
   * 'user'` line appended at request assembly — never written to history —
   * naming the refs and the spender: derived numbers come from the tool, not
   * from mental arithmetic. Appended HERE for the wrap-up's reason (this is
   * the one seam that decides what goes on the wire) and at the END for the
   * measured reason: the failure this closes was recency — the app's own
   * "use the compute tool" prose sat at the top of the context, the numbers
   * at the bottom, and the model summed them in its head.
   */
  readonly toolWants?: ReadonlyMap<string, readonly string[]>;
  /**
   * The per-run disposition ledger, by REFERENCE (9.60.0) — plumbing shared
   * through the build closure like ProviderToolCache, never scope state.
   * Every check in this stage notes one disposition per encounter here, so
   * silence is auditable at the run boundary.
   */
  readonly integrityLedger?: {
    current: import('../../../../integrity/disposition/ledger.js').DispositionLedger | undefined;
  };
  /** Optional rules-based reliability config (v2.11.5+). When set,
   *  the call is wrapped in a retry/fallback/fail-fast loop driven
   *  by `config.preCheck` and `config.postDecide` rules. Streaming
   *  is preserved; mid-stream failures use first-chunk arbitration —
   *  see `reliabilityExecution.ts` and the streaming + reliability
   *  design memo. */
  readonly reliability?: ReliabilityConfig;
  /** Optional output-schema parser (v2.13+). When set AND `reliability`
   *  is also set, the loop validates the LLM response against this
   *  parser on terminal turns (no toolCalls). Failures classify as
   *  `errorKind: 'schema-fail'` so PostDecide rules can route to
   *  retry-with-feedback (Instructor pattern). When `reliability` is
   *  NOT set, validation only happens at `agent.parseOutput()` boundary
   *  (existing v2.4 behavior). */
  readonly outputSchemaParser?: OutputSchemaParser<unknown>;
  /**
   * The synthetic tool the `'tool-forced'` output strategy puts on the wire
   * (7.26). Present ONLY under that strategy; under `'instruct'` — the
   * default — this is undefined and not one line below it runs.
   *
   * When present, the tool is appended to the request's tool list and the
   * request carries `toolChoice`, so the provider constrains generation to
   * this shape instead of the model being asked in prose to comply. It is
   * added HERE, at request assembly, and nowhere else: that is what keeps it
   * off `.tools()`, out of the tools slot and its `tools.offered` event, off
   * any MCP server's served list, and away from the dispatcher that runs
   * tools and files middleware rows. It is the strategy's mechanism, not the
   * agent's surface.
   */
  readonly schemaTool?: LLMToolSchema;
  /**
   * The format that `'native'` requires and `'auto'` selects when supported
   * (`nativeOutputFormat.ts`). When selected, the request
   * carries it as `outputFormat`, this stage refuses a provider manifest that
   * says it did not cross, and it records `llmLatestStopReason` for the Route
   * decider. Absent, not one line of that runs.
   */
  readonly outputFormat?: NonNullable<LLMRequest['outputFormat']>;
  /** Select native per effective request, otherwise retain instruction + parsing. */
  readonly nativeOutputAuto?: true;
  /** v2.14+ — request-side thinking budget. When set, every LLMRequest
   *  carries `thinking: { budget }` so the provider activates extended
   *  thinking. Undefined = no activation (default). */
  readonly thinkingBudget?: number;
  /**
   * True when the agent was built with `.configure()`. Only then does this
   * stage read `scope.resolvedModel` — the per-run model seed committed.
   * Gating on a build-time flag (rather than always reading and falling
   * back) keeps an unconfigured agent's recorded reads unchanged, which is
   * what "absent option = byte-identical" has to mean for a library whose
   * product is the recording.
   */
  readonly runConfigured?: boolean;
  /**
   * "The cursor picks the brain" (9.19.0). Consulted ONCE at the top of the
   * stage with the ADVANCED cursor — `scope.nextSkillCursor ??
   * scope.currentSkillId`, correct in BOTH chart shapes: inside
   * `sf-llm-call` the boundary's `currentSkillId` is a readonly input still
   * holding the previous iteration's cursor and the advanced one lives
   * under `nextSkillCursor`; in the flat chart the engine's outputMapper
   * has already written `currentSkillId` to the advanced value — and with
   * the run's escalation flag (`scope.skillEscalated`, threaded across the
   * `sf-llm-call` boundary by the grouped chart's mappers). The result
   * resolves field by field down the STATED precedence chain:
   *
   *   **escalation > per-skill brain > `.configure()` `resolvedModel` >
   *   build-time default** — `provider = brain?.provider ?? deps.provider`;
   *   `model = brain?.model ?? (runConfigured ? scope.resolvedModel :
   *   undefined) ?? deps.model`; `cacheStrategy = brain?.cacheStrategy ??
   *   deps.cacheStrategy`. A brain naming only a model inherits the agent's
   *   provider; a foreign provider without a model was refused at build.
   *
   * Undefined — no brain declared anywhere — and this stage reads no new
   * scope key, resolves exactly as before, and `llm_start` keeps its exact
   * bytes (the additive `brain` field appears only when a rung won).
   */
  readonly brainFor?: import('../../skillBrains.js').BrainFor;
  /**
   * `AgentOptions.recordSystemPrompt` (9.50.0) — opt-in, threaded
   * value-conditionally so an agent that never asked emits byte-identical
   * `llm_start` events. When true, the event carries `systemPromptText`: the
   * assembled prompt verbatim as sent. The privacy story lives on the option
   * and on the payload field; this dep only obeys it.
   */
  readonly recordSystemPrompt?: boolean;
  /**
   * The run's id, read through an accessor for the same reason seed's
   * `getCurrentRunId` is: a stage factory is built once per agent and the id
   * changes every run.
   *
   * It is the SALT on every hash the receipt carries — see
   * `receipt.ts` · `receiptHash`. Absent (or absent at call time) means an
   * unsalted digest, which is a weaker fingerprint, not a broken one: the
   * conformance law still holds because both sides salt with the same value.
   */
  readonly getRunId?: () => string | undefined;
  /**
   * Mint the receipt on every call (9.88.0). Default ON.
   *
   * `false` is the OFF SWITCH `AgentOptions.recordReceipt` sets. It exists
   * because a receipt is not free: one commit-log value per iteration, a
   * SHA-256 per system piece, per message, per tool schema. An offline eval
   * loop running ten thousand scored turns nobody will ever scrub is entitled
   * to decline all of it, and the switch is one boolean because the mint is one
   * call.
   *
   * Turning it off does NOT make the log unreadable: `servedAt` still rebuilds
   * every epoch from the committed pieces. What is lost is the second half of
   * the law — there is no fingerprint left to check the rebuild against, so
   * `receiptAt` returns `undefined` exactly as it does for a pre-9.88
   * recording.
   */
  readonly recordReceipt?: boolean;
  /**
   * The turns the window stage evicted at this iteration's head (9.93.0),
   * handed across in memory so the receipt can name them without a scope read
   * — `window/evictedTurns.ts` says why not a read. Attached by
   * `Agent.createExecutor` only when a window strategy is mounted; every
   * other agent hands this stage the deps object it always did.
   */
  readonly evictedTurns?: EvictedTurnsHandle;
  /**
   * The run's receipt memo (`core/agent/receipt/receiptDigests.ts`): every call of
   * a run mints through the same one, so each message is hashed once per run
   * instead of once per call. Created once per agent — it rebinds itself to
   * each new run id. Absent ⇒ every call hashes everything, as before; the
   * receipt's bytes are the same either way.
   */
  readonly receiptDigests?: ReceiptDigests;
}
