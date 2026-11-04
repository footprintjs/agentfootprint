/** One-job type contract owner; canonical exports remain with its facade. */

import type { FlowChart, StructureRecorder, NativeMappingBinding } from 'footprintjs';
import type { CachePolicy } from '../../cache/types.js';

import type { MemoryDefinition } from '../../memory/define.types.js';

import type { AnswerMountDeps, InputsMountDeps, ResultsMountDeps } from './honesty/mounts.js';
import type { RouteBranch } from './stages/route.js';
/**
 * Stage handlers + slot subflows the chart composer needs. Mostly
 * passed through verbatim from Agent.buildChart() — the chart shape
 * is identical to what was inline before.
 */
export interface AgentChartDeps {
  /** Memory READ/WRITE pipeline definitions (one per `.memory()`). */
  readonly memories: readonly MemoryDefinition[];

  /** Evidence bridge (#5): `causalEvidenceRecorder().collect`, threaded into
   *  CAUSAL memories' write mounts so snapshots persist real evidence
   *  (decisions/toolCalls/iterations/duration/tokens) instead of zeros.
   *  Set by the Agent when any mounted memory is CAUSAL. */
  readonly causalEvidenceSource?: (
    binding: NativeMappingBinding,
  ) => import('../../memory/causal/evidenceRecorder.js').RunEvidence;

  /** Cache policy for the system-prompt slot, threaded into
   *  CacheDecision's inputMapper so its decision rules can match. */
  readonly systemPromptCachePolicy: CachePolicy;

  /** Hard ReAct iteration cap, threaded into CacheDecision's
   *  inputMapper for max-iteration policies. */
  readonly maxIterations: number;

  // ─ Stage handlers ───────────────────────────────────────────────
  readonly seed: (scope: never) => void | Promise<void>;
  readonly callLLM: (scope: never) => Promise<void>;
  readonly routeDecider: (scope: never) => RouteBranch | Promise<RouteBranch>;
  readonly toolCallsHandler: import('footprintjs').PausableHandler<never>;
  /**
   * The schema re-ask branch (7.26). Present ONLY when the agent was built
   * with `.outputSchema(parser, { retries })` — and when present it is a
   * THIRD branch of the Route decider carrying the same `{ loopTo }` the
   * tool branch does, because a re-ask is one more ordinary turn.
   *
   * Conditional mount, for the reason every conditional mount here exists:
   * an agent that did not opt in gets no branch, no stage, no scope key and
   * no event — its chart and its commit log are the ones it always had.
   */
  readonly outputRetryStage?: (scope: never) => void;

  // ─ Slot subflows ───────────────────────────────────────────────
  readonly injectionEngineSubflow: FlowChart;
  /** Relevance entry router (`entryByRelevance`) — a once-per-turn function stage
   *  mounted before the InjectionEngine (off the ReAct loop). Present only when the
   *  skill graph was built with a relevance scorer. */
  readonly pickEntryStage?: (scope: never) => Promise<void>;
  /**
   * The turn-start routing CASCADE stage (SG-C) — subsumes PickEntry on
   * graphs that run it (`classify` configured, or `continuity:
   * 'conversation'`). Mounted in the SAME slot under the SAME id
   * (`STAGE_IDS.PICK_ENTRY`) so recorded structures stay stable; never
   * present together with `pickEntryStage` (Agent.buildChart picks exactly
   * one). Absent → the chart is byte-identical to 9.16.
   */
  readonly routeTurnStage?: (scope: never) => Promise<void>;
  /**
   * The window-strategy stage (`.window()` / `.compaction()`). Present ONLY
   * when the consumer configured a strategy — and when present it BECOMES the
   * ReAct loop target, mounted immediately before the current one.
   *
   * It has to be the loop target rather than merely sit in the loop body:
   * the loop is branch-sourced (`tool-calls → { loopTo }`), so anything ahead
   * of the target runs once and is never seen again. Being the target also
   * puts the window change BEFORE the injection engine and the slots, which
   * is the point — the triggers, the three slots and the wire then all see
   * the same window, and no component gets a different past than the model
   * does.
   *
   * `strategyName` rides along so the chart itself says which policy is
   * mounted; a reader of the graph should not have to guess.
   */
  readonly windowStage?: {
    readonly strategyName: string;
    readonly run: (scope: never) => Promise<void>;
  };
  /**
   * The messages-slot DELIVERY stage (7.21). Present ONLY when the agent has
   * something that could target the messages slot — a registered injection
   * declaring `inject.messages`, or any `.memory()` whose recall might format
   * as a non-system role. When absent the chart is the one it always was, so
   * an agent with nothing to deliver is byte-identical to 7.20.
   *
   * Mounted between the InjectionEngine and the Context fan-out: after the
   * engine has decided what is active, before anything reads the window. The
   * placement is the design — a delivered message has to be part of the past
   * that the slots project, the cache decision indexes, and the wire sends,
   * or the recording and the request would disagree about the conversation.
   */
  readonly deliverStage?: (scope: never) => void;
  readonly systemPromptSubflow: FlowChart;
  readonly messagesSubflow: FlowChart;
  readonly toolsSubflow: FlowChart;
  /**
   * Optional thinking-normalization sub-subflow (v2.14+). Mounted as a
   * stage AFTER CallLLM, BEFORE Route, only when a `ThinkingHandler`
   * resolved (declared by the provider or explicitly set
   * via `.thinkingHandler()`). When undefined, the stage is NOT added —
   * zero overhead for non-thinking agents (build-time conditional mount).
   */
  readonly thinkingSubflow?: FlowChart;

  // ─ Cache layer ──────────────────────────────────────────────────
  // The decision + gate now live inside `buildCacheSubflow()` (sf-cache),
  // which imports them directly — so they are NOT threaded through deps.
  // Only UpdateSkillHistory stays a main-loop stage (see buildCacheSubflow.ts).
  readonly updateSkillHistoryStage: (scope: never) => void;

  /**
   * Whether ≥1 Skill is registered. The `UpdateSkillHistory` stage (and
   * therefore the cache's skill-churn rule) is mounted ONLY when true:
   * with no skills the window would record "no skill" every iteration and
   * `detectSkillChurn` could never fire, so the stage would be pure dead
   * weight + a misleading box. Mirrors the `skills.length > 0` gate that
   * auto-attaches `read_skill`, and the `thinkingSubflow` conditional mount.
   */
  readonly hasSkills: boolean;

  /**
   * Whether ≥1 registered skill declares `steps` (9.18.0). Gates the step
   * pointer's mapper threading — engine in/out, the tools-slot arg, and (in
   * the grouped chart) the `sf-llm-call` boundary — so an agent without
   * stepped skills seeds and commits exactly the keys it always did. The
   * threading lives HERE in the builders, not in the subflow (the SG-C
   * blast-radius lesson): the alias discipline is
   * `stepPointer` in (readonly input) → Evaluate writes `nextStepPointer`
   * (the currentSkillId/nextSkillCursor precedent — the pointer changes
   * every iteration, so the turn-constant `turnRoute` pattern would serve
   * the tools slot a stale value) → mappers carry the alias back onto the
   * parent's `stepPointer`.
   */
  readonly hasSteps?: boolean;

  /**
   * The mount kernel's plan (9.58.0) — present ONLY on an agent built with
   * `.maps()`. Gates the `mapEngagement`/`nextMapEngagement` alias round
   * trip through the injection-engine boundary (the stepPointer discipline
   * verbatim). Absent → the keys are never threaded, so every other agent's
   * mapper bytes are exactly what they were.
   */
  readonly engagementPlan?: import('../../maps/engagement/types.js').EngagementPlan;

  /**
   * The unfinished-steps nudge branch (9.18.0). Present ONLY on an agent
   * with ≥1 stepped skill — and when present it is one more branch of the
   * Route decider carrying the same `{ loopTo }` the tool branch does,
   * because a nudge is one more ordinary turn (the SchemaRetry mechanism
   * verbatim). Absent → no branch, no stage, no scope key, no event.
   */
  readonly stepNudgeStage?: (scope: never) => void;

  /**
   * The evidence recheck branch (9.35.0). Present ONLY on an agent built with
   * `.namesAndNumbersFromEvidence({ posture: 'guard' | 'rails' })` — the
   * `'assist'` posture records and never loops, so it mounts no branch. One
   * more branch of the Route decider carrying the same `{ loopTo }` the tool
   * branch does, because a correction is one more ordinary turn (the
   * SchemaRetry mechanism verbatim). Absent → no branch, no stage, no event.
   */
  readonly evidenceRecheckStage?: (scope: never) => void;
  readonly negativeRecheckStage?: (scope: never) => void;

  /**
   * The out-of-budget wrap-up branch (9.56.0). Present on any agent that can
   * CALL a tool — a registered tool, or a `ToolProvider` that might list one —
   * unless `wrapUpAtMaxIterations: false` turned it off. An agent with no tool
   * surface can never run out of budget mid-action (a limit only cuts a turn
   * short when tool calls were pending), so it mounts no branch and its chart
   * is drawn exactly as it always was.
   *
   * One more branch of the Route decider carrying the same `{ loopTo }` the
   * tool branch does, because a wrap-up is one more ordinary turn (the
   * SchemaRetry mechanism verbatim). Absent → no branch, no stage, no scope
   * key, no event.
   */
  readonly wrapUpStage?: (scope: never) => void;

  /**
   * The evidence gate is mounted (9.35.0), at ANY posture. In the GROUPED
   * chart this gates bubbling `systemPromptInjections` out of `sf-llm-call`:
   * the slot writes it INSIDE the subflow and the outer Route decider needs
   * it to exempt values the app's own prompt (base prompt, skill body, a
   * retrieved passage) supplied — without the mapper key the gate would flag
   * the prompt's own identifiers in the default grouped shape (the
   * `hasEscalation` blast-radius lesson, one field down). The flat chart
   * shares one scope and needs no key; the flag is still threaded there so
   * both builders read the same deps object.
   */
  readonly hasEvidenceGate?: boolean;

  /**
   * `.limitsTravelWithTheAnswer()` is configured on a PROSE answer (no output
   * schema — a typed one sets `coverageLimitsAsData` instead). Swaps the
   * final branch's first stage for the variant that folds the run's declared
   * coverage into the answer before the turn payload is captured. Absent →
   * the same stage function the chart has always mounted, byte for byte; the
   * RECORDING half (events + `coverageDeclared`) is unconditional and does
   * not depend on this flag.
   */
  readonly attachCoverageLimits?: boolean;

  /**
   * `.limitsTravelWithTheAnswer()` on an agent with an output schema — the
   * answer is TYPED, so its limits travel as DATA and the block is never
   * appended (JSON followed by prose is not JSON). Swaps the final branch's
   * first stage for the variant that captures the model's answer unchanged
   * and projects the Route decider's committed `answerCoverage` onto
   * `turn_end`. The Agent sets this OR `attachCoverageLimits`, never both;
   * absent → the stage the chart has always mounted.
   */
  readonly coverageLimitsAsData?: boolean;

  /**
   * `.scriptTravelsWithTheAnswer()` — the final stage carries this turn's
   * recorded programs on `turn_end.scripts` and, on a prose answer (`typed`
   * unset), appends them after the `---` separator (`stages/prepareFinal.ts` ·
   * `prepareFinalFor`). Absent → the stage the chart has always mounted.
   */
  readonly scriptTravel?: import('./scripts/types.js').ResolvedScriptTravel & {
    readonly typed?: true;
  };

  /** Opt-in terminal guard and one committed token; absent preserves the original final stage. */
  readonly hasAnswerValidation?: boolean;
  /** Output middleware owns delivery: publish only the final captured answer. */
  readonly releaseOutputTokens?: true;
  /** The evidence gate's `'rails'` posture: a refused answer is recorded flagged and ends the branch (`prepareFinalFor`). */
  readonly evidenceRails?: true;
  /**
   * A tool's `displayName` (the app's words for a call), read through the
   * agent's own tools — present only where a tool can declare one. The prose
   * limits block names an item's declaring calls in those words
   * (`stages/prepareFinal.ts` · `prepareFinalFor`). Absent → the stage the
   * chart has always mounted.
   */
  readonly displayNameOfFor?: (scope: object) => (toolName: string) => string | undefined;

  /**
   * The time layer (`.time()`) is armed: under `attachCoverageLimits`, the
   * final stage renders each `Period:` line in the run's clock zone
   * (`stages/prepareFinal.ts` · `prepareFinalFor`). Absent → the stage the
   * chart has always mounted.
   */
  readonly timeLayer?: true;

  /**
   * The time layer is armed (`.time()`). Gates ONE mount arg on the Tools
   * branch's `inputMapper`: `timeWindows`, the turn's windows with the turn's
   * clock (`time/windows.ts` · `readerWindowsOf`, off
   * `parent.findingsLedger`) — the reader's (step T6b) and the app's control
   * window (`time.window`) — value-conditional, so a turn with none crosses no
   * key. The slot serves the reader's on each tool that declares a period and
   * the control window on every request (`ToolsSlotConfig.timeWindows`, G14).
   */
  readonly timeWindows?: true;

  /**
   * The time layer is armed with the inputs layer (`.time()` over a tool that
   * declares a period, step T8). Gates ONE mount arg on the Tools branch's
   * `inputMapper`: `timeLimits`, the turn's result-check facts for the model
   * (`semantics/coverage/timeLimitFacts.ts` · `timeLimitFactsOf`, audience `model`, off
   * `parent.findingsLedger`) — value-conditional, so a turn whose reads match
   * what was asked crosses no key. The slot renders and serves them in the
   * one time line (`ToolsSlotConfig.timeLimits`); the renderer loads there,
   * never on a plain agent's graph.
   */
  readonly timeLimits?: true;

  /**
   * An escalation brain is declared (9.19.0). In the GROUPED chart this
   * gates threading `skillEscalated` across the `sf-llm-call` boundary —
   * the flip is written by tool-calls on the OUTER scope and read by
   * callLLM INSIDE the subflow, so without the mapper key the escalation
   * would silently never serve a call in the default grouped shape (the
   * SG-C blast-radius lesson: the threading lives in the builders). The
   * flat chart shares one scope and needs no key; the flag is still
   * accepted here so both builders take identical deps.
   */
  readonly hasEscalation?: boolean;

  /** Findings is armed. The tools slot plants a stable optional schema;
   * live call assembly serves the current offer and ledger in late DATA.
   * This flag never makes the cache subflow suppress findings cache markers.
   */
  readonly hasFindingsLedger?: boolean;

  /**
   * The inputs layer is armed (honesty layer 2) — present ONLY when a tool
   * the build can see declares `askOrAssume`, or the agent was built with
   * `.inputsLayer()`. Mounts `sf-inputs` between the LLM call and Route
   * (`honesty/mounts.ts` · `mountInputsLayer`, the ONE helper both builders
   * call) and swaps the final branch's limits stage for the variant that also
   * carries the assumed values, when `.limitsTravelWithTheAnswer()` is on.
   * Absent — the default — and the chart is byte-identical.
   */
  readonly inputsLayer?: InputsMountDeps;

  /**
   * The results layer is armed (honesty layer 3, step 7b) — present ONLY when a
   * tool the build can see declares a `ToolPeriod`, or the agent was built
   * with `.resultsLayer()`. Mounts `sf-results` at the loop head, before the
   * window strategy, and makes it the loop target (`honesty/mounts.ts` ·
   * `mountResultsLayer`, the ONE helper both builders call). Absent — the
   * default — and the chart is byte-identical.
   */
  readonly resultsLayer?: ResultsMountDeps;
  /**
   * The answer layer is armed (honesty layer 4, `.answerLayer()`). Starts the
   * final branch with the layer's stage — the answer's standing, folded from
   * the committed record, filed for PrepareFinal and announced once
   * (`honesty/mounts.ts` · `startFinalBranch`, the ONE helper both builders
   * call) — and swaps PrepareFinal's body for the variant that carries the
   * standing on `turn_end` (and, under `standingLine`, appends its line to a
   * prose answer). Absent — the default — and the branch is byte-identical.
   */
  readonly answerLayer?: AnswerMountDeps;

  /**
   * Tool choice by classifier is armed (`.toolChoice()`, 9.105.0). Gates
   * THREE mount args on the Tools branch's `inputMapper` — `userMessage`
   * (what the classifier reads), `priorToolChoices` (the parent's rows,
   * under an alias because a mount input is frozen inside the subflow and
   * the slot writes the fresh list under the base key) and `wrapUpAsked`
   * (the wrap-up skip) — and ONE line on its `outputMapper`, carrying
   * `toolChoices` back onto the parent key `callLLM` appends the outcome
   * row to. In the grouped chart the same key crosses the `sf-llm-call`
   * boundary both ways. Absent — the default — the mount maps exactly the
   * keys it always did.
   */
  readonly hasToolChoice?: boolean;

  /**
   * The declared ontology is armed (`.ontology()`, 9.106.0). The flat chart
   * needs nothing from it — `callLLM` reads the run constant `ontology` off
   * the root scope; in the grouped chart `callLLM` lives INSIDE `sf-llm-call`
   * and the constant is written by seed on the OUTER scope, so the boundary's
   * `inputMapper` carries it across, under this gate and value-conditionally.
   * Absent — the default — the boundary maps exactly the keys it always did.
   */
  readonly hasOntology?: boolean;

  /**
   * ReAct loop semantics. `'dynamic'` (default) re-runs the InjectionEngine +
   * all 3 slots every iteration (loop → InjectionEngine). `'classic'`
   * engineers context ONCE (InjectionEngine + system-prompt + tools up front)
   * and loops only the Messages slot (loop → Messages). See AgentOptions.reactMode.
   */
  readonly reactMode?: 'classic' | 'dynamic';

  // ─ Build-time recorders (optional) ─────────────────────────────
  /** Structure recorders threaded into both `flowChart()` calls (the
   *  main chart and the PrepareFinal sub-chart). Each recorder
   *  observes per-node build events (`onStageAdded` /
   *  `onSubflowMounted` / etc.) for the Agent's chart. Undefined when
   *  the consumer didn't attach any. */
  readonly structureRecorders?: readonly StructureRecorder[];
}
