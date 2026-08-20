/**
 * Event payload types — the payload interfaces behind the registered events
 * (never a hardcoded count here: the registry's counts are pinned by
 * test/events/unit/registry.test.ts).
 *
 * Pattern: Discriminated Union (Gang of Four inspired, TS-native).
 * Role:    Contract layer of Event-Driven Hexagonal Architecture.
 * Emits:   (types only).
 */

import type {
  CompositionKind,
  ContextLifetime,
  ContextRecency,
  ContextRole,
  ContextSlot,
  ContextSource,
  LLMProviderName,
  ToolProtocol,
} from './types.js';
import type { PermissionCapability } from '../adapters/types.js';
import type { MemoryFlavor, MemoryStrategyKind, MemoryType } from '../memory/define.types.js';
import type { ArtifactOp, ArtifactRefusalReason } from '../artifacts/capability.js';
import type { ArtifactOrigin, ArtifactSweepReason } from '../artifacts/types.js';
import type { ThinkingBlock } from '../thinking/types.js';
import type { LoopMoment } from '../core/agent/moments.js';
import type { InstructionDeliveryLease, ToolResultStatus } from '../core/agent/toolEffects.js';
import type { ToolSemantics } from '../lib/semantics/types.js';

// ─── Tier 1+2: Core Domain (library-emitted) ──────────────────────────

// composition.* (8)
export interface CompositionEnterPayload {
  readonly kind: CompositionKind;
  readonly id: string;
  readonly name: string;
  readonly childCount: number;
}

export interface CompositionExitPayload {
  readonly kind: CompositionKind;
  readonly id: string;
  /** Display name supplied at composition build time (e.g., the
   *  `Sequence.create({ name: 'IntakePipeline' })` arg). Mirrors the
   *  `name` field on `CompositionEnterPayload` so consumers narrating
   *  the exit moment can reference the same human-readable identity
   *  used at entry — no name-cache required across the start/stop
   *  pair. Optional for back-compat with pre-v2.14.5 emitters. */
  readonly name?: string;
  readonly status: 'ok' | 'err' | 'break' | 'budget_exhausted';
  readonly durationMs: number;
}

export interface ParallelForkStartPayload {
  readonly parentId: string;
  readonly branches: readonly { id: string; name: string }[];
}

export interface ParallelBranchCompletePayload {
  readonly parentId: string;
  readonly branchId: string;
  readonly status: 'ok' | 'err';
  readonly durationMs: number;
}

export interface ParallelMergeEndPayload {
  readonly parentId: string;
  /**
   * Which merge strategy ran. `'fn'` = `mergeWithFn` (strict, plain
   * results map). `'llm'` = `mergeWithLLM` (strict, LLM synthesis).
   * `'outcomes-fn'` = `mergeOutcomesWithFn` (tolerant, full
   * `BranchOutcome` map). Distinct values so consumers can render
   * tolerant vs strict merges differently in dashboards.
   */
  readonly strategy: 'llm' | 'fn' | 'outcomes-fn';
  readonly resultSummary: string;
  /** Number of branches whose result FED the merge — i.e., succeeded
   *  (or, in tolerant mode, those the merge fn actually consumed as
   *  `{ok: true}`). Failing branches are counted in `totalBranchCount
   *  - mergedBranchCount`. */
  readonly mergedBranchCount: number;
  /** Total number of branches declared on the Parallel — equals
   *  `mergedBranchCount` on all-success runs, larger on partial. */
  readonly totalBranchCount: number;
}

export interface ConditionalRouteDecidedPayload {
  readonly conditionalId: string;
  readonly chosen: string;
  readonly rationale?: string;
  readonly evidence?: unknown;
}

export interface LoopIterationStartPayload {
  readonly loopId: string;
  readonly iteration: number;
}

export interface LoopIterationExitPayload {
  readonly loopId: string;
  readonly iteration: number;
  readonly reason: 'budget' | 'guard_false' | 'break' | 'body_complete';
}

// agent.* (7)
export interface AgentTurnStartPayload {
  readonly turnIndex: number;
  readonly userPrompt: string;
}

export interface AgentTurnEndPayload {
  readonly turnIndex: number;
  readonly finalContent: string;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly iterationCount: number;
  readonly durationMs: number;
  /**
   * Why the loop stopped before the model said it was done (9.56.0) — present
   * ONLY on a turn a limit cut short, absent on every normal finish.
   *
   * It rides `turn_end` because that is the event a consumer already reads to
   * render an outcome: the moment the answer exists. Reading `finalContent`
   * without it, a dashboard cannot tell a finished answer from the fragment a
   * loop stopped in the middle of — which is exactly how a half-sentence gets
   * shown to a person under a green tick.
   *
   * `wrappedUp` says which of the two this is. `true` = the run spent one more
   * call with the tools withheld and `finalContent` is that summary; absent =
   * the turn ended on whatever the last call produced. Mirrors the committed
   * `stoppedEarly` record (`agent.stoppedEarly()`), never a second source of
   * it.
   */
  readonly stoppedEarly?: {
    readonly reason: 'max-iterations' | 'cost-budget';
    readonly iteration: number;
    readonly pendingToolCalls: number;
    readonly wrappedUp?: true;
  };
}

/**
 * A turn's budget ran out while the model was still working (9.56.0).
 *
 * Fires ONCE per turn, from the Route decider, at the boundary that refused to
 * run the tool calls the model just asked for — the same moment
 * `cost.limit_hit { kind: 'max_iterations' }` fires, and beside it rather than
 * instead of it: that event reports a LIMIT being crossed, this one reports
 * what the run then DID about it.
 *
 * `action` is the whole point. `'wrapped-up'` means one more call went out with
 * the tools withheld and its answer is the turn's answer; `'cut-short'` means
 * the turn ended on whatever text rode the last call — a fragment, mid-task,
 * more often than not. A consumer that only ever sees `'wrapped-up'` is
 * looking at a healthy default; one seeing `'cut-short'` is looking at a turn
 * whose answer nobody should trust as complete.
 */
export interface AgentBudgetExhaustedPayload {
  /** Which budget ran out. Only `'max-iterations'` is ever wrapped up. */
  readonly reason: 'max-iterations' | 'cost-budget';
  /** The iteration the budget ran out on. */
  readonly iteration: number;
  /**
   * The budget itself — present ONLY for `'max-iterations'`, where it is
   * `maxIterations`.
   *
   * Absent for `'cost-budget'`, deliberately: the run's committed state carries
   * the cumulative SPEND, not the cap, and reporting spend as `limit` is the
   * exact mistake `cost.limit_hit` documents and avoids. The real USD cap rides
   * that event, emitted the moment the budget was crossed.
   */
  readonly limit?: number;
  /** How many tool calls the model asked for that will never run. */
  readonly pendingToolCalls: number;
  /** What the run did about it. */
  readonly action: 'wrapped-up' | 'cut-short';
}

export interface AgentIterationStartPayload {
  readonly turnIndex: number;
  readonly iterIndex: number;
}

export interface AgentIterationEndPayload {
  readonly turnIndex: number;
  readonly iterIndex: number;
  readonly toolCallCount: number;
  /** Conversation history (LLM messages) at the END of this
   *  iteration. Captured by `agent.run()` for fault-tolerant
   *  resume — `RunCheckpointError.checkpoint` snapshots this so
   *  `agent.resumeOnError(...)` can replay from the last good
   *  iteration. Optional for back-compat with v2.x recorders that
   *  subscribed without expecting this field. */
  readonly history?: ReadonlyArray<unknown>;
}

export interface AgentRouteDecidedPayload {
  readonly turnIndex: number;
  readonly iterIndex: number;
  /**
   * The branch the turn took. `'output-retry'` (7.26) appears only on an
   * agent built with `.outputSchema(parser, { retries })`, and only on a
   * turn whose answer failed the schema with retries left — the loop is
   * about to ask again rather than finish. `'step-nudge'` (9.18.0) appears
   * only on an agent with a stepped skill, and only on a turn whose
   * would-be-final answer left declared steps unrun with the one teaching
   * nudge still unspent. `'evidence-recheck'` (9.35.0) appears only on an
   * agent built with `.namesAndNumbersFromEvidence({ posture: 'guard' |
   * 'rails' })`, and only on a turn whose would-be-final answer stated values
   * no tool result carried, with the one revision still unspent. `'wrap-up'`
   * (9.56.0) appears only on a turn whose `maxIterations` ran out while the
   * model was still asking for tools, on an agent that did not set
   * `wrapUpAtMaxIterations: false` — the loop is about to spend one last call
   * with the tools withheld so the turn ends with a summary.
   */
  readonly chosen:
    | 'tool-calls'
    | 'final'
    | 'output-retry'
    | 'step-nudge'
    | 'evidence-recheck'
    | 'wrap-up';
  readonly rationale?: string;
}

export interface AgentHandoffPayload {
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly reason?: string;
  readonly viaProtocol?: 'native' | 'mcp' | 'http';
}

// stream.* (5)
export interface LLMStartPayload {
  readonly iteration: number;
  readonly provider: LLMProviderName;
  readonly model: string;
  readonly systemPromptChars: number;
  /**
   * The ASSEMBLED system prompt, verbatim as sent to the provider (9.50.0) —
   * every injection piece joined exactly the way the wire saw it. **OPT-IN,
   * default OFF**: present only when the run was built with
   * `recordSystemPrompt: true` (`AgentOptions` / `LLMCallOptions`).
   *
   * PRIVACY: the assembled prompt routinely carries what its pieces carry —
   * skill bodies, RAG passages, memory recalls, per-user instructions. With
   * the dial on, all of it lands in every event sink and every recording
   * (`recordRun` → `persistRecording`), so treat those artifacts as being as
   * sensitive as the prompt itself. Absent, the event keeps its exact prior
   * bytes: only `systemPromptChars` (the length) is recorded, and the
   * assembled string is honestly NOT in the recording.
   */
  readonly systemPromptText?: string;
  readonly messagesCount: number;
  readonly toolsCount: number;
  /**
   * The tool CATALOG the model saw for this call — what was at its disposal when
   * it chose (the menu behind its tool-selection reasoning). One `{ name,
   * description }` per tool sent to the provider, in request order. Absent when
   * the call had no tools. The structured "what the model saw" payload: pair it
   * with the iteration's reasoning to debug WHY a tool was (or wasn't) picked.
   * Names + descriptions only — full input schemas live in the snapshot.
   */
  readonly tools?: readonly { readonly name: string; readonly description?: string }[];
  readonly estimatedPromptTokens?: number;
  readonly temperature?: number;
  readonly providerRequestRef?: string;
  /**
   * WHICH BRAIN answered, when a brain rung won (9.19.0 — "the cursor picks
   * the brain"). `via: 'skill'` = the active skill's declared brain served
   * this call (`skillId` names the tenure); `via: 'escalation'` = the turn
   * crossed its declared refusal threshold and the escalation brain is
   * serving the rest of it. ABSENT whenever the agent's own configured /
   * default model answered — an agent without brains keeps its exact prior
   * event bytes. `provider` + `model` above always report what was actually
   * called, whichever rung supplied them.
   */
  readonly brain?: {
    readonly via: 'skill' | 'escalation';
    readonly skillId?: string;
  };
}

export interface LLMEndPayload {
  readonly iteration: number;
  readonly content: string;
  readonly toolCallCount: number;
  readonly usage: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    /**
     * 9.29.0 — reasoning tokens the model spent on this call, when the
     * provider reports them (`LLMResponse.usage.thinking`).
     *
     * This field is the fix for a gap a field trial found by walking into it:
     * a 256-token Gemini stream produced ONE visible chunk, and the run only
     * made sense once the numbers were read — `input 21, output 9,
     * thinking 243`. The provider had been reporting that third number all
     * along and this payload's type dropped it, so the event that a consumer
     * actually subscribes to could not explain its own run.
     *
     * **Not inside `output`.** On Gemini `candidatesTokenCount` counts visible
     * tokens only; thinking is a separate, billed line item. A cost estimate
     * built from `input + output` under-counts a thinking model by whatever it
     * thought. `cost.tick` deliberately does NOT fold it in — `PricingTable`
     * prices four kinds and thinking is not one of them, and inventing a rate
     * would be this library guessing at somebody's invoice.
     *
     * Undefined when the provider does not report thinking tokens, which is
     * most calls.
     */
    readonly thinking?: number;
  };
  readonly stopReason: string;
  readonly durationMs: number;
  readonly providerResponseRef?: string;
}

export interface LLMTokenPayload {
  readonly iteration: number;
  readonly tokenIndex: number;
  readonly content: string;
}

export interface ToolStartPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly parallelCount?: number;
  readonly protocol?: ToolProtocol;
}

/**
 * One progress report from inside a still-running tool call (9.52.0) — filed
 * by `ctx.progress(payload)` from within `tool.execute`, in call order, always
 * BETWEEN this call's `stream.tool_start` and its `stream.tool_end`.
 *
 * The split is deliberate: the three identity fields are stamped by the
 * FRAMEWORK from the dispatch it is already holding (a tool cannot claim to be
 * another call, another tool, or another iteration), and `payload` is the tool
 * author's data forwarded verbatim. Nothing here is ever shown to the model —
 * this is the telemetry channel, not the result channel.
 *
 * Absent entirely for every tool that never reports: a run whose tools call
 * nothing files no `tool_progress` events at all.
 */
export interface ToolProgressPayload {
  /** The invocation this report belongs to — matches `stream.tool_start.toolCallId`. */
  readonly toolCallId: string;
  /** The tool that reported. */
  readonly toolName: string;
  /** The ReAct iteration this call was dispatched on (`0` where there is no loop). */
  readonly iteration: number;
  /**
   * The tool author's payload, verbatim — whatever shape they chose
   * (`{ done: 3, total: 12 }`, a status string, a partial row). The library
   * neither reads it nor normalizes it; it must survive `structuredClone`,
   * because it lands in every event sink and every recording.
   */
  readonly payload: unknown;
}

export interface ToolEndPayload {
  readonly toolCallId: string;
  readonly result: unknown;
  readonly error?: boolean;
  readonly durationMs: number;
  /**
   * The tool's OWN declared outcome (9.19.0) — present only when the tool
   * returned a result envelope carrying `status`. Normalized vocabulary
   * (`'denied'` must never read like `'success'`); route edges key on it
   * via `onToolStatus`. Absent for every tool that never opted in.
   */
  readonly status?: ToolResultStatus;
}

// context.* (5) — THE CORE DOMAIN
export interface ContextInjectedPayload {
  readonly contentSummary: string;
  readonly contentHash: string;
  readonly rawContent?: string;
  readonly slot: ContextSlot;
  readonly asRole?: ContextRole;
  readonly asRecency?: ContextRecency;
  readonly position?: number;
  readonly sectionTag?: string;
  readonly source: ContextSource;
  readonly sourceId?: string;
  readonly upstreamRef?: string;
  readonly reason: string;
  readonly retrievalScore?: number;
  readonly rankPosition?: number;
  readonly threshold?: number;
  readonly budgetSpent?: { readonly tokens: number; readonly fractionOfCap: number };
  readonly expiresAfter?: ContextLifetime;
}

export interface ContextEvictedPayload {
  readonly slot: ContextSlot;
  readonly contentHash: string;
  readonly reason: 'budget' | 'stale' | 'low_score' | 'policy' | 'user_revoked';
  readonly survivalMs: number;
}

export interface ContextSlotComposedPayload {
  readonly slot: ContextSlot;
  readonly iteration: number;
  readonly budget: {
    readonly cap: number;
    readonly used: number;
    readonly headroomChars: number;
  };
  readonly sourceBreakdown: Readonly<
    Partial<Record<ContextSource, { readonly chars: number; readonly count: number }>>
  >;
  readonly orderingStrategy?: string;
  readonly droppedCount: number;
  readonly droppedSummaries: readonly string[];
}

/**
 * Fired when a budget is exceeded — by a context SLOT composing over its
 * `budgetCap`, or by a window STRATEGY measuring the window over its
 * `thresholdTokens`.
 *
 * ## Read `unit` before you read a number (8.14.0)
 *
 * Two emitters share this event name and the `slot: 'messages'` value, and
 * **they do not count in the same unit**:
 *
 * | emitter | what it measures | `unit` |
 * |---|---|---|
 * | the three context slots (`contextBudget`) | `String.length` of what it composed | `'chars'` |
 * | a window strategy (`.window()` / `.compaction()`) | the provider's reported input tokens | `'tokens'` |
 *
 * Since `contextBudget` is on by default, one subscriber routinely receives
 * both — and before 8.14.0 nothing in the payload told them apart, so
 * "cap 200, projected 258" could be 258 characters or 258 tokens. `unit` is
 * the answer; `cap` and `projected` are the same two numbers under names that
 * do not assert an untrue one.
 *
 * `planAction: 'none'` means no mitigation was performed — nothing was
 * evicted or truncated and the full content still went to the LLM. That
 * is what the built-in slots report: they never truncate, so the event is
 * the signal that the budget is not being respected.
 */
export interface ContextBudgetPressurePayload {
  readonly slot: ContextSlot;
  /** How far over the cap, in {@link unit}. Never carried a unit in its name. */
  readonly overflowBy: number;
  readonly planAction: 'evict' | 'summarize' | 'abort' | 'none';
  /**
   * What {@link cap}, {@link projected} and {@link overflowBy} are counted in
   * (8.14.0). `'chars'` from a context slot, `'tokens'` from a window
   * strategy. Branch on this before comparing any of the three numbers to
   * anything.
   */
  readonly unit: 'chars' | 'tokens';
  /**
   * The budget that was exceeded, in {@link unit}.
   *
   * Called `capTokens` until 9.0.0 — a name that asserted tokens on a channel
   * that is CHARS half the time, since `contextBudget` is on by default and a
   * slot counts `String.length`. Both spellings shipped through 8.x with the
   * identical value; 9.0.0 keeps only this one.
   */
  readonly cap: number;
  /** What was measured, in {@link unit}. Called `projectedTokens` until 9.0.0
   *  — see {@link cap}. */
  readonly projected: number;
}

/**
 * Fired once per iteration by the Injection Engine after it evaluates every
 * Injection's trigger — BEFORE the Context fork routes the survivors into the
 * three slots. This is the "what was considered, what won, what was skipped
 * and why" signal; `context.slot_composed` is its downstream counterpart
 * ("what actually landed in each slot"). Pure observability — no flow stage
 * reads it.
 */
/** A guard threshold value as the record carries it — plain data only. */
export type SkillGuardValueRecord =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<string | number | boolean | null>;

/**
 * One route-edge guard evaluation, as `cursorMove.guard` / `guardsClosed`
 * carry it (9.51.0): the guarded edge, the tool result it judged, the
 * verdict, and per-condition evidence — each declared condition
 * (`key`/`op`/`value`), the summarized value it was judged against (bounded
 * to 80 chars — evidence, not a transcript), and whether it passed. The
 * operator vocabulary deliberately mirrors footprintjs's `WhereFilter`
 * (`eq/ne/gt/gte/lt/lte/in/notIn`).
 */
export interface SkillGuardEvaluationRecord {
  readonly from: string;
  readonly to: string;
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly verdict: boolean;
  readonly conditions: ReadonlyArray<{
    readonly key: string;
    readonly op: string;
    readonly value: SkillGuardValueRecord;
    readonly actualSummary: string;
    readonly passed: boolean;
  }>;
}

export interface ContextEvaluatedPayload {
  readonly iteration: number;
  /** Number of injections active this iteration. */
  readonly activeCount: number;
  /** Number skipped (predicate false counts as neither — only errors/unknown land here). */
  readonly skippedCount: number;
  /** Total injections evaluated (the full declared list). */
  readonly evaluatedTotal: number;
  /** Ids of the active injections, in evaluation order. */
  readonly activeIds: readonly string[];
  /** Why each skipped injection was skipped (errors / unknown trigger kinds). */
  readonly skippedDetails: readonly {
    readonly id: string;
    readonly reason: 'predicate-threw' | 'unknown-trigger-kind';
    readonly error?: string;
  }[];
  /** Count of active injections by trigger kind (always / rule / on-tool-return / llm-activated). */
  readonly triggerKindCounts: Readonly<Record<string, number>>;
  /**
   * The Skill CATALOG the LLM was offered this turn — every registered Skill's
   * `id` + `description` (the same text that lands in the `read_skill` tool
   * description). Lets observers pair "what was offered" against "what the LLM
   * chose" (`read_skill` → `activatedInjectionIds`) when debugging a missed or
   * wrong activation. Empty when no Skills are registered. Static across turns.
   */
  readonly skillCatalog: readonly { readonly id: string; readonly description: string }[];
  /**
   * Routing PROVENANCE for the active injections that came from a `skillGraph()`
   * — *why* each was reached. One entry per active skill-graph injection (a
   * decision-tree leaf, a flat entry, or a route edge); absent when no active
   * injection carries skill-graph metadata. The structured counterpart to the
   * `context.routed` commentary line — lets the lens show the decision path, the
   * matched predicate, and the tools a route unlocked. Structural shape (mirrors
   * `SkillRouting` from the injection engine; events stay decoupled from it).
   */
  readonly routing?: readonly {
    readonly injectionId: string;
    readonly flavor: string;
    /** `'tree' | 'entry' | 'route' | 'model'`. */
    readonly via: string;
    /** Decision path (tree only): predicates root→leaf + branch taken. */
    readonly path?: readonly { readonly label: string; readonly branch: string }[];
    /** Entry/route edge caption. */
    readonly label?: string;
    /** Source skill id (route only). */
    readonly from?: string;
    /** Compiled trigger kind for a route. */
    readonly triggerKind?: string;
    /** Tool names this injection unlocked. */
    readonly tools?: readonly string[];
  }[];
  /**
   * How the skill-graph CURSOR moved on THIS iteration — the winning clause of the
   * graph's one cursor resolver, reported by it (8.5.0). Present only for an agent
   * built with `.skillGraph()` (and a graph new enough to explain itself).
   *
   * Distinct from `routing[]` above, and the distinction is the point: `routing[]`
   * is per-SKILL build-time provenance ("how is this skill reachable"), while this
   * is per-HOP runtime truth ("what moved us, this turn"). `by: 'model-pick'` is the
   * case the two disagree on — a `read_skill` pick the gate accepted, into a skill
   * that also has a declared edge whose predicate never fired.
   */
  readonly cursorMove?: {
    readonly from?: string;
    readonly to?: string;
    /** `'entry' | 'route' | 'model-pick' | 'intent' | 'continuity' | 'stay' | 'none'`. */
    readonly by: string;
    /** The turn-start MENU this model pick resolved (SG-C) — present only on
     *  the iteration an accepted pick closed an outstanding menu. */
    readonly offered?: readonly string[];
    /** The accepted pick was reachable but NOT on the offered menu — the
     *  model's divergence, on the record (data under `'assist'`, a refusal
     *  under `'guard'`/`'rails'`, which never reach here). */
    readonly declinedOffer?: boolean;
    /** WHAT the message said that routed this hop (9.28.0) — present only for a
     *  `by: 'entry'` move a DATA matcher (`match:` — RegExp / `{ keywords }` /
     *  `{ all }`) decided. `text` is the matched substring of the USER message,
     *  whitespace-collapsed and bounded to 80 characters (ellipsis included);
     *  `keyword` names WHICH declared keyword hit, for the keywords arm.
     *  Absent for `when` predicates (opaque code), unconditional entries, and
     *  every scorer verdict (whose evidence is its scores). */
    readonly witness?: { readonly text: string; readonly keyword?: string };
    /**
     * The EVIDENCE the winning data GUARD routed on (9.51.0) — present only
     * for a `by: 'route'` move whose firing edge declared a `guard:`. The
     * full per-condition evaluation (verdict `true`): which edge, which tool
     * result it judged, and every declared condition with the summarized
     * value it saw. Structural shape (mirrors the graph's `GuardEvaluation`;
     * events stay decoupled from it).
     */
    readonly guard?: SkillGuardEvaluationRecord;
    /**
     * The data guards that REFUSED this iteration (9.51.0) — guarded edges
     * out of the cursor whose other declared conditions a tool result met
     * and whose guard said no (verdict `false`; at most one record per
     * edge). Rides whatever move resulted — including a `'stay'`, where it
     * answers "why didn't my guarded edge fire?" with the conditions and
     * values that closed it. Absent when no guard decided anything.
     */
    readonly guardsClosed?: readonly SkillGuardEvaluationRecord[];
    /**
     * The REACHABLE set from the cursor this move landed on (9.50.0) — the
     * skill ids the `read_skill` gate will admit on THIS iteration: declared
     * hops out of the landed cursor plus the open skills (`llm-activated`
     * skills the graph wires no edge to). It is the same set, from the same
     * two resolvers, that builds the `read_skill` offer prose and any
     * `skill.rejected.allowed` list this iteration — as DATA, so no consumer
     * has to parse the menu sentence back into ids. `[]` is a fact (a dead
     * end: no hop and no open skill is admissible); ABSENT means the graph
     * predates `reachableSkills` and the set was not on the record.
     */
    readonly reachable?: readonly string[];
  };
  /**
   * Skill-graph entries whose own `when` matched this iteration and which the cursor
   * law kept OFF the wire (8.15.0). A conditional entry is active exactly while the
   * cursor is on it — `when` says where a turn STARTS, not what stays loaded — so an
   * entry whose rule still matches while the graph is elsewhere is suppressed.
   *
   * Read it beside `cursorMove`, which names where the graph went instead: together
   * they answer "why isn't my entry loading?" without re-running a predicate to
   * guess. Absent when nothing was suppressed, and for every non-skill-graph run.
   *
   * Distinct from `agentfootprint.skill.reroute_superseded`, which reports a DISCRETE
   * broken promise (a `read_skill` pick the gate accepted and a declared edge
   * outranked). This is a CONTINUOUS condition — an entry whose rule stays true while
   * the cursor is parked elsewhere is suppressed on every iteration — so it rides the
   * per-iteration event.
   */
  readonly supersededIds?: readonly string[];
}

// error.fatal + pause (always-on from library core)
export interface ErrorFatalPayload {
  readonly error: string;
  readonly stage: string;
  readonly scope: string;
}

export interface PauseRequestPayload {
  readonly reason: string;
  readonly questionPayload: Readonly<Record<string, unknown>>;
}

export interface PauseResumePayload {
  readonly resumeInput: Readonly<Record<string, unknown>>;
  readonly pausedDurationMs: number;
  /** The registered component the paused ask nominated to collect its answer
   *  (9.24.0) — read from the checkpoint's own pause payload, whichever pause
   *  kind carried it. Absent when the ask was prose-only. */
  readonly componentId?: string;
}

// ─── check-in (evidence-carrying human consent) ───────────────────────
/** A tool declared `checkIn` and it tripped — the run paused to ask a human,
 *  with the evidence pack riding the ask. Emitted BEFORE the tool executes. */
export interface CheckInRequestPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** The typed ask + evidence pack (`CheckInRequest`). JSON/clone-safe. */
  readonly request: Readonly<Record<string, unknown>>;
}
/** A human answered a pending check-in. Emitted on resume, BEFORE the tool
 *  runs (approve) or the decline result lands. */
export interface CheckInDecisionPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly approved: boolean;
  readonly by: string;
  readonly note?: string;
  /** The registered component that COLLECTED this decision (9.24.0) — the
   *  `componentId` the ask carried. Absent when the ask was prose-only. The
   *  decision itself is unchanged: a structured fact, never parsed from the
   *  words a screen rendered. */
  readonly componentId?: string;
}

// ─── middleware (the governance chains) ───────────────────────────────
/**
 * One link of a `toolMiddleware` / `messageMiddleware` chain answered.
 *
 * Its own domain rather than a `permission.check` with a different label:
 * a middleware decision is not a permission check, and reporting it as one
 * would make every consumer reading that channel believe a checker they
 * never configured had fired.
 *
 * Deliberately carries no `before` / `after` — the values live in the
 * committed `middlewareDecisions` ledger, under whatever redaction the run
 * configured. An event stream is a fan-out to sinks we do not control, and
 * a scrubbed value should not leave the run through it.
 */
export interface MiddlewareDecisionPayload {
  readonly middleware: string;
  /** Where in the loop this happened — the vocabulary `.act()` is keyed on. */
  readonly moment: LoopMoment;
  /** The 7.18 spelling of the same fact. Narrow on `moment`. */
  readonly at: 'tool' | 'message';
  readonly phase?: 'input' | 'output';
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly iteration: number;
  readonly outcome: 'allow' | 'deny' | 'ask';
  /** True when this link changed the value the chain carries forward. */
  readonly changed: boolean;
  /** The transform's `why`, the denial's `reason`, or the ask's `question`. */
  readonly why?: string;
  /** The registered component that COLLECTED this decision (9.24.0). Present
   *  only on the resume-side rows of an `ask` that carried one. */
  readonly componentId?: string;
}

// ─── Tier 3: Observability Layers (recorder-emitted, opt-in) ──────────

// memory.* (4)
export interface MemoryStrategyAppliedPayload {
  readonly strategyId: string;
  readonly strategyKind:
    | 'sliding-window'
    | 'summarizing'
    | 'semantic'
    | 'fact-extraction'
    | 'hybrid';
  readonly reason: string;
  readonly scoreEvidence?: Readonly<Record<string, unknown>>;
  readonly inputMemoryCount: number;
  readonly outputMemoryCount: number;
  readonly droppedIds: readonly string[];
  readonly addedIds: readonly string[];
}

/**
 * One piece of stored content reached the prompt.
 *
 * Emitted once per admitted chunk by the memory formatter (8.8.0 — the
 * payload was declared in 2.x and nothing emitted it until then).
 * `memoryId` is the STORE ENTRY's id, which for an indexed corpus is the
 * chunk id you can cite. Which retriever produced it is
 * `meta.runtimeStageId` (`sf-memory-read-<id>/format-default#N`) — the
 * house rule is that events correlate by runtime stage id, not by
 * duplicating the owner into every payload.
 */
export interface MemoryAttachedPayload {
  readonly memoryId: string;
  readonly contentSummary: string;
  readonly score?: number;
  readonly rank?: number;
  readonly source: 'store' | 'auto-extract' | 'manual';
  readonly retriever?: 'pinecone' | 'weaviate' | 'qdrant' | 'chroma' | 'custom';
}

/** One candidate a retrieval considered, admitted or not. */
export interface RetrievedCandidatePayload {
  readonly id: string;
  readonly score: number;
  readonly rank: number;
  readonly admitted: boolean;
  /**
   * Why it did not reach the prompt. `'over-char-budget'` (8.19.0) means it
   * cleared the score floor and the count rule, and the retriever's
   * `maxChars` budget was already spent by better-ranked passages.
   */
  readonly reason?: 'below-threshold' | 'over-budget' | 'over-max-entries' | 'over-char-budget';
  readonly docUri?: string;
  readonly page?: number;
  readonly heading?: string;
}

/**
 * A retrieval happened — here is everything it considered (8.8.0).
 *
 * The event that makes "why did the agent NOT read that passage"
 * answerable. Until 8.8.0 the quality floor was applied inside the store,
 * so a rejected candidate never came back and a retrieval that injected
 * nothing left no trace of what it nearly injected.
 *
 * `candidates` absent means the store could not tell us (see
 * `candidatesOmittedReason`) — it never means there were none. That case
 * is `candidates: []` with `consideredCount: 0` and `corpusEmpty: true`.
 */
export interface MemoryRetrievedPayload {
  /**
   * Which rule ruled — the `RetrievalStrategy.name` that produced the verdicts
   * below, e.g. `'top-k'`. The port promises its name "appears in the
   * recording"; this is where. Without it a shipped `topK` and a consumer's own
   * re-ranker leave records that are identical except for the numbers they
   * disagree about.
   */
  readonly strategy: string;
  /** Stable hash of the query text. The text itself is already in the recording once. */
  readonly queryHash: string;
  /** How many chunks the retriever was willing to admit. */
  readonly k: number;
  /** The quality floor, when the retriever set one. */
  readonly threshold?: number;
  /**
   * The character budget the admitted passages were spent against (8.19.0),
   * when the retriever set one. A count bound (`k`) is not a size bound;
   * this is the size bound, and the candidates it dropped carry
   * `reason: 'over-char-budget'`.
   */
  readonly maxChars?: number;
  /**
   * Passage characters the admitted set spends. Present exactly when
   * `maxChars` is. Passage text only — the `<source …>` wrapper and the
   * block header are added later by the formatter.
   */
  readonly charsUsed?: number;
  readonly embedderId?: string;
  /** Length of the query vector. */
  readonly dimensions?: number;
  readonly consideredCount: number;
  readonly admittedCount: number;
  readonly rejectedCount: number;
  readonly candidates?: readonly RetrievedCandidatePayload[];
  /**
   * Whether `candidates` is every candidate that existed, or only as far
   * as the requested pool reached. `false` never weakens the ADMITTED
   * set — only the rejected list is then a sample.
   */
  readonly candidatesComplete: boolean;
  readonly candidatesOmittedReason?: string;
  /**
   * The namespace held nothing at all. Almost always means the corpus was
   * indexed under a different identity than the one being queried.
   */
  readonly corpusEmpty: boolean;
  /** The namespace that was searched. */
  readonly namespace?: string;
}

export interface MemoryDetachedPayload {
  readonly memoryId: string;
  readonly reason: 'stale' | 'budget' | 'score_low' | 'policy';
}

export interface MemoryWrittenPayload {
  readonly memoryId: string;
  readonly contentSummary: string;
  readonly source: 'auto' | 'manual';
  readonly actor?: string;
}

// tools.* (3)
export interface ToolsOfferedPayload {
  readonly availableIds: readonly string[];
  readonly withheldIds: readonly string[];
  readonly withheldReasons: Readonly<
    Record<string, 'permission' | 'skill_inactive' | 'gated' | 'cost_guard'>
  >;
  readonly reason: string;
}

export interface ToolsActivatedPayload {
  readonly toolId: string;
  readonly reason: 'skill_activated' | 'autoActivate' | 'permission_granted';
  readonly source?: string;
}

export interface ToolsDeactivatedPayload {
  readonly toolId: string;
  readonly reason: 'skill_deactivated' | 'permission_revoked';
}

/**
 * Emitted at the start of a `ToolProvider.list(ctx)` call inside the
 * Discover stage. Pairs with `tools.discovery_completed` (success) or
 * `tools.discovery_failed` (error). Use the pair to measure async-
 * provider latency per iteration without joining stages by hand.
 */
export interface ToolsDiscoveryStartedPayload {
  readonly providerId: string | undefined;
  readonly iteration: number;
}

/**
 * Emitted when `ToolProvider.list(ctx)` resolves successfully. The
 * `durationMs` is the wall-clock between `tools.discovery_started` and
 * resolution; `toolCount` is the size of the returned tool list. For
 * sync providers `durationMs` is ~0; for async hub-backed providers
 * this is your observability hook for catalog-fetch latency.
 */
export interface ToolsDiscoveryCompletedPayload {
  readonly providerId: string | undefined;
  readonly iteration: number;
  readonly durationMs: number;
  readonly toolCount: number;
}

/**
 * Emitted when a custom `ToolProvider.list(ctx)` throws or rejects.
 * The iteration is aborted; a configured `reliability` rule decides
 * whether to retry, fall back, or fail-fast. `providerId` lets
 * consumers route alerts to the right hub adapter (rube / mcp /
 * custom-discovery). `durationMs` measures how long the failed call
 * spent before throwing, so timeouts vs immediate rejections are
 * distinguishable.
 */
export interface ToolsDiscoveryFailedPayload {
  readonly providerId: string | undefined;
  readonly error: string;
  readonly errorName: string;
  readonly iteration: number;
  readonly durationMs: number;
}

/**
 * Emitted when two sources claim ONE tool name and the source the model READS is not
 * the source that will RUN (8.7.0).
 *
 * Today that is exactly one pair: a `ToolProvider` and an active Skill's
 * `inject.tools`. The tools slot merges `[static, provider, skill]` first-wins, so the
 * provider's schema reaches the LLM; the dispatcher resolves `registryByName` first,
 * which holds every skill tool and no provider tool, so the skill's `execute` runs.
 * The model reads one description and calls a different function.
 *
 * Not an error event: the run continues, a tool really executes, and the fix is a
 * rename. It fires once per offending name PER ITERATION, because a provider list is
 * resolved per iteration and a shadow can begin mid-run.
 *
 * Carries names only — never args, never results, never a description body.
 */
export interface ToolsShadowedPayload {
  /** The contested tool name. */
  readonly toolName: string;
  readonly iteration: number;
  /** Which source's SCHEMA the model was shown. */
  readonly schemaFrom: 'provider' | 'registry' | 'skill';
  /** That source's id — the `ToolProvider.id`, when it has one. */
  readonly schemaFromId?: string;
  /** Which source's IMPLEMENTATION the dispatcher will resolve. */
  readonly dispatchTo: 'provider' | 'registry' | 'skill';
  /** That source's id — the skill id, for the provider↔skill pair. */
  readonly dispatchToId?: string;
}

// ── tools.session_* (4) — the tool-session lifecycle (9.7.0) ─────────────────
//
// A tool that holds a session (a managed code interpreter, a browser context)
// registers cleanup through `ctx.onTeardown`; these four are what that leaves
// behind. They ride the EXISTING `agentfootprint.tools.` prefix on purpose:
// `toolsRecorder` already bridges the whole prefix and `'agentfootprint.tools.*'`
// is already a wildcard arm, so a new domain would have re-opened the two-part
// trap 9.4.0 spent a release climbing out of (payloads and registry entries in
// place, no bridge and no wildcard, eight minors of silence).
//
// **`keyHash`, never the key.** The isolation key composes tenant, principal and
// the hosting `sessionId`; publishing it would put a user identifier into every
// exporter's payload. `meta.sessionId` already carries the session legitimately
// (9.4.0), so the payload carries a short, stable, non-reversible digest — enough
// to JOIN two rows, not enough to say whose they are.

/** Shared shape of the four `tools.session_*` payloads. */
interface ToolSessionPayloadBase {
  /** The tool that registered the cleanup. */
  readonly tool: string;
  /** Which scope it asked for — how long it expected to live. */
  readonly scope: 'call' | 'run' | 'session' | 'shutdown';
  /** Digest of the isolation key. SHA-256 (12 hex chars) where `node:crypto`
   *  resolves, FNV-1a in a browser bundle. NEVER the key. */
  readonly keyHash: string;
  /** The adapter holding the resource — `CodeRunner.id`, say. */
  readonly runnerId?: string;
  /** One fact the tool chose to state about what was opened (the language, the
   *  browser profile). Never user data. */
  readonly label?: string;
}

/** A tool opened something and registered its cleanup. */
export type ToolsSessionStartedPayload = ToolSessionPayloadBase;

/**
 * A later call reused the session already held under this key.
 *
 * This is the payoff being measured: `calls` is how many dispatches have shared
 * one start-up. It is also the liveness signal the idle sweep and the LRU bound
 * read, which is why a tool re-registers on every execute rather than only once.
 */
export interface ToolsSessionReusedPayload extends ToolSessionPayloadBase {
  /** How many calls have now shared this session, including this one. */
  readonly calls: number;
}

/** The cleanup ran. `reason` says which firing site ran it. */
export interface ToolsSessionClosedPayload extends ToolSessionPayloadBase {
  readonly reason: 'call-end' | 'run-end' | 'session-end' | 'shutdown' | 'idle' | 'evicted';
  /** Wall-clock from registration to close. */
  readonly durationMs: number;
}

/**
 * The cleanup threw, or outran `toolTeardownTimeoutMs`.
 *
 * Teardown never throws into the run — but it is never SILENT either, and this
 * event is the difference. A vendor `Stop` that fails leaves a live sandbox
 * somebody is still paying for; the run has no way to say so, so this does.
 * `errorClass` mirrors `credential.failed`'s 9.4.0 addition: routable without
 * parsing prose (`'ToolTeardownTimeoutError'` for the budget case).
 */
export interface ToolsSessionCloseFailedPayload extends ToolSessionPayloadBase {
  readonly reason: 'call-end' | 'run-end' | 'session-end' | 'shutdown' | 'idle' | 'evicted';
  readonly durationMs: number;
  readonly error: string;
  readonly errorClass?: string;
}

// validation.* (1)
/**
 * Emitted when LLM-produced tool args fail validation against the tool's
 * declared `inputSchema` (backlog #9). Fires for BOTH modes that validate:
 * `enforced: true` means the call was rejected before dispatch and the
 * model received a structured retry message as the tool result;
 * `enforced: false` ('warn' mode) means the tool executed anyway.
 * `issues` name paths, expectations, and received TYPES — never the
 * supplied values (they can carry PII / injection payloads).
 */
export interface ValidationArgsInvalidPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly issues: ReadonlyArray<{
    readonly path: string;
    readonly expected: string;
    readonly got: string;
  }>;
  readonly enforced: boolean;
}

// skill.* (9)
/**
 * The turn-start routing verdict (SG-C) — one per turn on skill-graph agents
 * whose graph ran the cascade (`classify` configured, or
 * `continuity: 'conversation'` with something to decide). Fired by the
 * RouteTurn stage DURING traversal (collect-during-traversal; never rebuilt),
 * BEFORE iteration 1, so it precedes every `context.evaluated` of its turn.
 *
 * The LOSERS are on the record: `scores` ranks every candidate the tier-2
 * scorer judged (role-hidden skills are excluded before scoring — a hidden
 * capability is never named, not even to observers of this run); `offered`
 * names the menu the model was handed; `policy` stamps the exact thresholds
 * that judged the hop, so no observer has to guess which numbers decided.
 */
export interface SkillTurnRoutedPayload {
  /** The tier that decided the turn's start:
   *  `'entry'` — a tier-1 rule (the recorded vocabulary for rule-won starts);
   *  `'intent'` — the tier-2 scorer was decisive;
   *  `'continuity'` — the inherited cursor held (incumbent won / near-tie /
   *  sticky default / the decider picked STAY — `decider` says which);
   *  `'menu'` — a menu was put in-band (near-tie or unmatched);
   *  `'decider'` — the configured tier-3 decider resolved the menu
   *  out-of-band (9.19.0; `decider` carries the pick);
   *  `'none'` — the cascade decided nothing the loop may act on (a rails
   *  menu — the offer is still recorded here — or a dropped resume). */
  readonly by: 'entry' | 'intent' | 'continuity' | 'menu' | 'decider' | 'none';
  /** The inherited cursor (continuity), when one existed. */
  readonly from?: string;
  /** Where the turn starts. Absent = menu pending / none. */
  readonly to?: string;
  /** `IntentScorer.name` / entry-scorer name, when tier 2 ran. */
  readonly scorer?: string;
  /** EVERY candidate, ranked best-first — the losers, with the numbers that
   *  lost. `score` is raw (strategy-specific); `relevance` is the
   *  full-softmax share. */
  readonly scores?: ReadonlyArray<{
    readonly id: string;
    readonly score: number;
    readonly relevance: number;
  }>;
  /** The top-vs-2nd PAIRWISE gap actually judged (count-independent — see
   *  routingPolicy.ts; NOT the difference of two `relevance` shares). */
  readonly runnerUp?: { readonly id: string; readonly gap: number };
  /** Whether tier 2 cleared the margin + floor. */
  readonly decisive?: boolean;
  /** WHAT the message said that won tier 1 (9.28.0) — present only on a
   *  `by: 'entry'` verdict a DATA matcher (`match:` — RegExp / `{ keywords }` /
   *  `{ all }`) decided. `text` is the matched substring of the USER message
   *  (never tool or system text), whitespace-collapsed and bounded to 80
   *  characters, ellipsis included; `keyword` names WHICH declared keyword hit
   *  (keywords arm only). Absent for `when` predicates — opaque code the
   *  library cannot quote — and for intent/scorer verdicts, whose evidence is
   *  the `scores` above. */
  readonly witness?: { readonly text: string; readonly keyword?: string };
  /** The tier-3 menu (near-tie cluster, or every entry when unmatched). */
  readonly offered?: readonly string[];
  /** STAY was a first-class option in that menu (mid-conversation). */
  readonly stayOffered?: boolean;
  /** The thresholds that judged this turn, verbatim. `floor` is the EFFECTIVE
   *  floor (`policy.floor ?? scorer.floor`); absent = no floor, so
   *  `unmatched` was unreachable and near-tie governed. */
  readonly policy: {
    readonly nearTieMargin: number;
    readonly menuSize: number;
    readonly floor?: number;
  };
  /** Prior conversational turns the scorer saw (its declared window). */
  readonly window?: number;
  /** A continuity cursor that could not be honored — the stored id is not a
   *  node of the currently mounted graph (a deploy changed it). The turn
   *  started cold instead, and says so. */
  readonly droppedResume?: { readonly id: string; readonly reason: 'unknown-skill' };
  /**
   * The tier-3 DECIDER's involvement (9.19.0) — present whenever one was
   * configured AND a menu verdict reached it. `picked` is the constrained
   * pick that resolved the menu (an offered id, or `'stay'`); ABSENT when
   * the decider declined (`'none'` / parse failure / a throw) and the
   * in-band envelope stood. Recorded on every outcome so the record always
   * says the decider was consulted — a resolver that ran and said nothing
   * is still a fact.
   */
  readonly decider?: {
    readonly provider: string;
    readonly model?: string;
    readonly picked?: string;
  };
}

export interface SkillActivatedPayload {
  readonly skillId: string;
  readonly reason: 'autoActivate' | 'read_skill_result' | 'manual';
  readonly injectedTools?: readonly string[];
  readonly injectedSystemPromptChars?: number;
}

export interface SkillDeactivatedPayload {
  readonly skillId: string;
  readonly reason: string;
}

/**
 * Fired by the skill-graph read_skill GATE when the model tries to `read_skill`
 * a skill that is NOT reachable from the current cursor. The jump is rejected
 * (cursor/activations unchanged); the model gets a synthetic re-prompt naming
 * `allowed`. Powers the lens / Why-panel "it tried to leave the graph here".
 */
/**
 * Fired when a `read_skill` pick the gate ACCEPTED did not end up active — the
 * model was told "Skill 'X' activated for the next iteration" and something else
 * won. There is exactly one way to get here: a declared route edge fired on the
 * same turn (the model emitted a domain tool AND `read_skill` in one message, and
 * the tool's result matched the edge). The author's declared edge wins by design
 * (`D1 > D2`), so the pick is superseded — and reported here rather than silently
 * dropped. The next iteration shows the model where it actually is.
 */
export interface SkillRerouteSupersededPayload {
  /** The skill the model picked with `read_skill` (accepted, then superseded). */
  readonly volunteeredId: string;
  /** The skill the declared edge routed to instead (the cursor that won). */
  readonly wonId?: string;
  /** The cursor the hop started from. */
  readonly fromSkillId?: string;
  /** The ReAct iteration whose evaluation dropped the pick. */
  readonly iteration: number;
  /**
   * WHO volunteered the superseded move (9.19.0). Absent = the model's
   * `read_skill` pick, exactly as this event has always meant;
   * `'tool-proposal'` = an accepted `propose-transition` effect that a
   * same-batch declared edge outran (D1 wins over the proposal exactly as
   * it wins over a pick — the author's determinism is never overridden).
   */
  readonly source?: 'tool-proposal';
}

/**
 * The DECLARED skill map, as the author drew it (9.50.0) — fired ONCE per run,
 * right after `agent.run_configured`, for every agent whose `.skillGraph()`
 * mount could state its map. Nodes and edges come from the BUILT graph
 * (`graph.nodes` / `graph.edges`), never inferred from runtime hops — so a
 * recording carries the complete authored topology, not the lower bound that
 * per-hop `routing[]` provenance names (an edge appears there only once it
 * FIRES). A consumer drawing the graph from a recording no longer has to say
 * "partial" or ask the caller to pass the built graph in.
 *
 * ABSENT (no event) when no graph is mounted, or when a structurally-typed
 * graph carries no `nodes` — the map is then honestly not on the record,
 * never guessed.
 */
export interface SkillGraphDeclaredPayload {
  /** The drawn nodes: `kind: 'skill'` boxes, plus `'predicate'` diamonds for a
   *  decision `tree()`. `description` is the skill's catalog description,
   *  verbatim (the text the model reads) — absent when the skill declares
   *  none. `label` is the drawn caption (predicate nodes). */
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    /** `'skill' | 'predicate'` (reported verbatim from the graph). */
    readonly kind: string;
    readonly description?: string;
    readonly label?: string;
  }>;
  /** The author's edges, verbatim. `from: null` is the synthetic START (an
   *  entry edge — the lens's declared-edge consumers filter on
   *  `from !== null`). `kind` is the declared `SkillEdgeKind`
   *  (`'entry' | 'predicate' | 'on-tool-return' | 'on-tool-status' | 'guard'
   *  | 'model'`). `guard` (9.51.0) is the edge's declared DATA guard,
   *  verbatim — conditions in declaration order, all ANDed, the operator
   *  vocabulary mirroring footprintjs's `WhereFilter` — so a recording's
   *  SkillMap shows its guard conditions without anyone re-reading source. */
  readonly edges: ReadonlyArray<{
    readonly from: string | null;
    readonly to: string;
    readonly kind: string;
    readonly label?: string;
    readonly guard?: {
      readonly conditions: ReadonlyArray<{
        readonly key: string;
        readonly op: string;
        readonly value: SkillGuardValueRecord;
      }>;
    };
  }>;
}

export interface SkillRejectedPayload {
  /** The skill id the model requested via `read_skill`. */
  readonly requestedId: string;
  /** The cursor it was at (undefined = cold start, before any entry resolved). */
  readonly currentSkillId?: string;
  /** The reachable set it was bounded to (what the re-prompt offered). */
  readonly allowed: readonly string[];
  /** The ReAct iteration the rejection fired on. */
  readonly iteration: number;
  /** Present when a POSTURE, not reachability, refused (SG-C `strictness`):
   *  `'guard'` — the pick was reachable but off the outstanding menu (or no
   *  menu was outstanding); `'rails'` — routing picks are refused outright
   *  (rules/scorer route turn starts; declared routes handle transitions).
   *  Absent = today's reachability refusal, unchanged. */
  readonly posture?: 'guard' | 'rails';
}

/**
 * Fired when two or more tool results of ONE parallel batch matched skill-graph
 * edges to DIFFERENT targets (9.16.0). The first match in call order wins the
 * cursor move; every later result matching another target is suppressed — and
 * reported here so the record explains the hop the run did not take. Before
 * 9.16.0 there was no conflict to report because there was no batch: only the
 * LAST call of a batch was consulted, and the earlier calls' routing
 * implications were silently dropped.
 *
 * Not fired for same-target matches (they all asked for the move that
 * happened), nor for batches where only one result matched. Distinct from
 * `skill.reroute_superseded`, which reports a declared edge outranking a
 * `read_skill` pick — this one is edge-vs-edge, inside one batch.
 */
export interface SkillRouteConflictPayload {
  /** The ReAct iteration whose evaluation resolved the batch. */
  readonly iteration: number;
  /** The cursor the winning hop started from. */
  readonly fromSkillId?: string;
  /** The call-order-first match — the one that moved the cursor. */
  readonly winner: {
    /** The provider's tool_use id for the winning call, when known. */
    readonly toolCallId?: string;
    readonly toolName: string;
    /** The skill the cursor moved to. */
    readonly target: string;
  };
  /** Later matches to other targets, in call order — the suppressed hops. */
  readonly losers: ReadonlyArray<{
    readonly toolCallId?: string;
    readonly toolName: string;
    /** The skill this result would have routed to. */
    readonly target: string;
  }>;
  /**
   * WHAT conflicted (9.19.0). Absent = declared route edges, exactly as
   * this event has always meant; `'tool-proposal'` = two or more accepted
   * `propose-transition` effects of one batch named different targets —
   * first accepted in call order wins, the rest are suppressed and
   * reported here under the same law.
   */
  readonly source?: 'tool-proposal';
}

/**
 * A declared step completed: its tool returned (non-error) while it was
 * current (9.18.0). Fired at the tool-return boundary, in batch call order —
 * two adjacent steps naming the same tool advance twice in one batch, each
 * on the record. A skip is NOT a completion: a `skip_step` that moved the
 * pointer fires `step_skipped { policy: 'advance' }` alone.
 */
export interface SkillStepAdvancedPayload {
  readonly skillId: string;
  /** The step that just completed (or was skipped past). */
  readonly step: {
    readonly index: number;
    readonly total: number;
    readonly tool: string;
    readonly note: string;
  };
  readonly iteration: number;
  /** The provider's tool_use id for the completing call, when known. */
  readonly toolCallId?: string;
  /** Present on the LAST step: the procedure finished. */
  readonly completed?: true;
}

/**
 * The model declined a step, with its reason — the integrity condition, not
 * polish (9.18.0). The framework moved on or held per the skill's declared
 * `onSkip`; both facts are here. An empty reason never gets this far: the
 * tool-calls stage answers it with a teaching result and no event.
 */
export interface SkillStepSkippedPayload {
  readonly skillId: string;
  readonly step: SkillStepAdvancedPayload['step'];
  /** The model's own words. */
  readonly reason: string;
  readonly policy: 'advance' | 'hold';
  readonly iteration: number;
  readonly toolCallId?: string;
}

/**
 * The turn is ending with steps unrun (9.18.0). `'nudged'` = the one
 * teaching re-ask went back (at most once per turn); `'accepted'` = the
 * model stopped again and the framework honored it — never a forced
 * continue; `'cut-short'` = a limit (max-iterations / cost-budget) ended
 * the turn, and a nudge would have spent an iteration the limit refused.
 */
export interface SkillStepsUnfinishedPayload {
  readonly skillId: string;
  readonly remaining: ReadonlyArray<{
    readonly index: number;
    readonly tool: string;
    readonly note: string;
  }>;
  readonly total: number;
  readonly action: 'nudged' | 'accepted' | 'cut-short';
  readonly iteration: number;
}

/**
 * The turn's refusal loop crossed the declared threshold and the rest of the
 * turn runs on the escalation brain (9.19.0). Fired ONCE per turn, at the
 * flip, from the gate that counted the refusals — escalation is always on
 * recorded evidence (`skill.rejected`, reachability or posture), never on
 * vibes. De-escalation is the next turn's seed; no event marks it.
 */
export interface SkillEscalatedPayload {
  /** The ReAct iteration whose refusal tripped the threshold. */
  readonly iteration: number;
  /** The declared threshold (`escalation.afterRefusals`). */
  readonly afterRefusals: number;
  /** The observed refusal count that tripped it (== afterRefusals at the
   *  flip; the counter keeps counting but the event fires once). */
  readonly refusals: number;
  /** The brain that WAS serving — resolved by the same precedence chain
   *  callLLM applies (skill brain > configured > default). */
  readonly from: { readonly provider: string; readonly model: string };
  /** The declared escalation brain. `model` absent = it inherits down the
   *  chain (same-provider escalations only; enforced at build). */
  readonly to: { readonly provider: string; readonly model?: string };
}

/**
 * One typed tool effect was judged (9.19.0) — the effects channel's own
 * record, fired in batch call order from the stage that judged it.
 *
 *   • `'accepted'` — a `propose-transition` passed the graph's reachability
 *     law (the cursor moves at the next evaluation unless a same-batch
 *     declared edge wins — that suppression is `skill.reroute_superseded
 *     { source: 'tool-proposal' }`), or a `require-instruction` named a
 *     registered instruction and its lease was granted.
 *   • `'refused'` — the teaching refusal: unreachable target, no graph to
 *     route, unknown instruction id, a body whose declared channel cannot
 *     be pushed, or a malformed effect. `refusalReason` says which.
 *   • `'superseded'` — an accepted transition proposal lost the batch to an
 *     EARLIER accepted proposal naming a different target
 *     (`skill.route_conflict { source: 'tool-proposal' }` reports the same
 *     batch once, winner + losers).
 *
 * No effects = this event never fires (zero-cost-when-unused).
 */
export interface ToolEffectPayload {
  readonly kind: 'propose-transition' | 'require-instruction';
  readonly outcome: 'accepted' | 'refused' | 'superseded';
  /** The tool whose result carried the effect. */
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly iteration: number;
  /** propose-transition: the proposed cursor target. */
  readonly targetSkillId?: string;
  /** propose-transition: the effect's own declared reason. */
  readonly reason?: string;
  /** require-instruction: the registered injection id it pushes. */
  readonly instructionId?: string;
  /** require-instruction: the granted (or asked-for) lease. */
  readonly deliveryLease?: InstructionDeliveryLease;
  /** outcome `'refused'`: the teaching sentence, verbatim. */
  readonly refusalReason?: string;
  /** outcome `'superseded'`: what outran it. */
  readonly supersededBy?: 'earlier-proposal';
}

/**
 * A tool's result was refused for exceeding the tool's own declared
 * `resultCeiling` (9.20.0) — the record of the size the content channels never
 * carry. The model read a teaching refusal ("No data was returned", plus how
 * to narrow); the oversized payload entered NO channel — not history, not
 * `stream.tool_end`, not this event. The delivered result carries status
 * `'invalid'`, so `onToolStatus` edges can route the overflow.
 *
 * No `resultCeiling` on the tool = this event never fires
 * (zero-cost-when-unused).
 */
export interface ToolResultRefusedPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** The stringified result's TRUE length — the fact the refusal replaced. */
  readonly sizeChars: number;
  /** The tool's declared ceiling it exceeded. */
  readonly maxChars: number;
  /** The declared parameter names the refusal suggested narrowing by. */
  readonly narrowBy?: readonly string[];
  /** When the refused result was an effects envelope: the status the tool
   *  DECLARED before delivery was refused (its declared effects were still
   *  judged — a proposed transition does not die with an oversized payload). */
  readonly declaredStatus?: ToolResultStatus;
}

/**
 * A tool returned exactly what it returned before, for exactly the same
 * arguments (9.26.0) — and the model was told so.
 *
 * A NOTE was appended to that result; the call ran, the result is unchanged
 * beside the note, and nothing was refused. Payloads never ride this event:
 * `argsFingerprint` and `resultFingerprint` are short non-cryptographic
 * digests, which answer "is this the same?" and nothing else. See
 * `core/agent/repeatedCall.ts` for why the fingerprints and not the values.
 */
export interface ToolRepeatedCallPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** How many times this exact call+result has landed this turn, including
   *  this one. The note fires on the threshold landing only. */
  readonly occurrences: number;
  /** Digest of the arguments — never the arguments. */
  readonly argsFingerprint: string;
  /** Digest of the result — never the result. */
  readonly resultFingerprint: string;
}

/**
 * A tool looked and found nothing, and said so with `absent(…)`.
 *
 * The event exists because the RECORD is where "we looked here and there was
 * nothing" has to survive: read off the answer alone, a clean run and a run
 * that searched an empty collector look identical. Carries the coverage the
 * tool declared — never the arguments the model passed, which are the model's
 * own words about what it wanted, not the tool's about what it covered.
 */
export interface ToolAbsentPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** What the tool says it was looking for (its own prose). */
  readonly lookedFor?: string;
  /** Ground the search DID cover. Non-empty by construction — `absent()`
   *  refuses a declaration that names no coverage. */
  readonly checked: readonly CoverageItemPayload[];
  /** Ground this search did not reach — the absence proves nothing there. */
  readonly notChecked?: readonly CoverageItemPayload[];
  /** Ground no call to this tool can reach. No retry changes it. */
  readonly cannotCover?: readonly CoverageItemPayload[];
}

/**
 * A tool returned a verdict WITH its own boundary — `coverage(result, …)`.
 *
 * The sibling of the evidence gate on the record: the gate's events say which
 * VALUES an answer could not support, this one says which LIMITS it did not
 * state. Fires per declaring call, whatever `.limitsTravelWithTheAnswer()`
 * is set to — the recording half is unconditional, only the appending half is
 * opt-in.
 */
/**
 * A code-runner tool ran a program the model wrote.
 *
 * **The code itself is deliberately NOT here.** Generated code quotes the data
 * it was given — a row, a serial, an address — so shipping it to every attached
 * exporter would put customer data on a wire nobody audited for it. This is the
 * same rule the session events already follow with `keyHash`, never the key.
 *
 * What travels instead is `shapeHash`: the program with its string literals,
 * numbers and identifier names stripped, leaving the CALL SHAPE — which
 * operations, in what order. Two runs that compute the same thing over
 * different data share a shape hash, which is exactly the grouping that makes
 * this useful: rank the shapes by how often they recur and the top of that list
 * is a backlog of tools somebody keeps having to write by hand.
 */
export interface ToolsCodeRunPayload {
  /** The code-runner tool's own name, since an app may mount more than one. */
  readonly tool: string;
  /** The language the runner was configured for. */
  readonly language: string;
  /** How many declared artifact inputs were staged as files for this run. */
  readonly stagedInputs: number;
  /** Characters of stdout returned, AFTER the runner's cap. */
  readonly outputChars: number;
  /** True when the output hit `maxOutputChars` and was cut. */
  readonly truncated: boolean;
  /** Whether the program ran to completion. */
  readonly ok: boolean;
  /** A stable hash of the normalized call shape. Never the code. */
  readonly shapeHash: string;
}

export interface ToolCoverageDeclaredPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly checked?: readonly CoverageItemPayload[];
  readonly notChecked?: readonly CoverageItemPayload[];
  readonly cannotCover?: readonly CoverageItemPayload[];
}

/** One piece of declared ground, as it rides an event: detached plain data,
 *  copied out of the tool's own declaration. */
export interface CoverageItemPayload {
  readonly what: string;
  readonly why?: string;
}

/**
 * A tool returned a semantic envelope (`semantic(…)`, 9.53.0) — typed
 * series/facts/edges with the caveats that make them honest (grain,
 * provenance, coverage) as data.
 *
 * The event carries the FULL envelope — render hints, the three-list
 * coverage detail, the marker, everything — because this is the channel
 * recordings and UIs read; the MODEL received only the compact
 * rendering-free projection (`semanticsForModel`). Emitted BEFORE the
 * result ceiling is measured, so grain and provenance survive to the record
 * even when the content itself was refused as oversized. Detached plain
 * data (structuredClone), never a live reference into the tool's own value.
 */
export interface ToolSemanticsDeclaredPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly semantics: ToolSemantics;
}

// permission.* (4)
export interface PermissionCheckPayload {
  /** 9.11.0 — the shared vocabulary, so the event cannot drift from the
   *  request. `'skill_read'` joined it when skill activation became something
   *  a policy can refuse. */
  readonly capability: PermissionCapability;
  readonly actor: string;
  readonly target?: string;
  readonly result: 'allow' | 'deny' | 'halt' | 'gate_open';
  readonly policyEngine?: 'opa' | 'cerbos' | 'custom';
  readonly policyRuleId?: string;
  readonly rationale?: string;
  /** v2.12 — telemetry tag carried through from PermissionDecision.reason. */
  readonly reason?: string;
}

export interface PermissionGateOpenedPayload {
  readonly gateId: string;
  readonly openedBy: string;
  readonly expiresAt?: number;
}

// ─── credential (declare-and-push; NEVER carries the secret) ──────────
/** A tool's declared credential is being resolved before invocation. */
export interface CredentialRequestedPayload {
  readonly service: string;
  readonly mode?: 'machine' | 'user';
}
/** A credential was issued. Carries the `kind` only — NEVER the token/secret. */
export interface CredentialAcquiredPayload {
  readonly service: string;
  readonly kind: string;
  readonly expiresAt?: number;
}
/** 3-legged consent is required (the tool is not run until the user authorizes).
 *  Carries `sessionId` for correlation, NOT the authorization URL. */
export interface CredentialAuthorizationRequiredPayload {
  readonly service: string;
  readonly sessionId: string;
}
/**
 * Credential resolution failed — the provider threw, so the tool is not run
 * (fail-closed: never half-authed).
 *
 * **Never carries the credential, the token, or the authorization URL.** See
 * the security contract on `CredentialProvider`: `reason` is the provider's own
 * thrown message, so a provider must scrub secrets before throwing.
 *
 * `tool` and `errorClass` were added in 9.4.0, for the operator watching a
 * dashboard rather than reading a transcript. Without the tool name this event
 * says a service failed but not what stopped working; without the class every
 * distinct failure is one undifferentiated string. Both are optional because
 * neither is always knowable: `tool` is absent when the resolution was not made
 * on a tool's behalf, and `errorClass` is absent when what was thrown was not
 * an `Error`.
 */
export interface CredentialFailedPayload {
  /** The service id the tool declared (or asked for), never the credential. */
  readonly service: string;
  /** The provider's thrown message. */
  readonly reason: string;
  /** The tool whose call needed it — the thing that actually stopped working. */
  readonly tool?: string;
  /** Constructor name of what was thrown (e.g. `'TypeError'`, `'TimeoutError'`)
   *  — the routable half of the failure, so alerts do not have to parse prose. */
  readonly errorClass?: string;
}

export interface PermissionGateClosedPayload {
  readonly gateId: string;
  readonly reason: string;
}

/**
 * Emitted (v2.12) when a `PermissionChecker.check()` returns
 * `{ result: 'halt', ... }`. Pairs with the typed `PolicyHaltError`
 * thrown by `Agent.run()` — the event is the OBSERVABILITY signal,
 * the error is the RUNTIME signal. Both carry the same `reason` for
 * routing (e.g. `'security:exfiltration'` → PagerDuty).
 *
 * Fires AFTER the synthetic tool_result has been written to scope.history
 * but BEFORE the run terminates, so observability adapters see the
 * halt while the conversation history is consistent for downstream
 * audit/replay.
 */
export interface PermissionHaltPayload {
  readonly checkerId?: string;
  readonly target: string;
  readonly reason: string;
  readonly tellLLM?: string;
  readonly iteration: number;
  readonly sequenceLength: number;
}

// risk.* + fallback.* (2)
export interface RiskFlaggedPayload {
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly category:
    | 'pii'
    | 'prompt_injection'
    | 'runaway_loop'
    | 'cost_overrun'
    | 'hallucination_flag';
  readonly detector: 'nemo_guardrails' | 'llama_guard' | 'custom' | 'heuristic';
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly action: 'warn' | 'redact' | 'abort';
}

export interface FallbackTriggeredPayload {
  readonly kind: 'provider' | 'tool' | 'skill';
  readonly primary: string;
  readonly fallback: string;
  readonly reason: string;
}

// cost.* (2)
export interface CostTickPayload {
  readonly scope: 'iteration' | 'turn' | 'run';
  /**
   * The model this money was spent on — the one `pricingTable.pricePerToken`
   * was asked about.
   *
   * Always present: a tick exists because a priced call happened, and a call
   * has a model. Without it the event said what was spent and not on what, so
   * a run that switched models mid-loop (a `'retry-other'` failover, a
   * summarizer on a cheaper model) produced a bill nothing could break down.
   */
  readonly model: string;
  /**
   * The provider that billed it, by `LLMProvider.name` — the other half of
   * attribution, since one model name can be served by several providers
   * (Bedrock and Anthropic both answer to a Claude model id, at different
   * prices).
   *
   * Optional for ONE honest reason: a window/compaction strategy reports its
   * summarizer spend through `WindowStrategyResult.spend`, and the provider is
   * read from that strategy's `billing` declaration, which the seam leaves
   * optional. Every shipped strategy declares it. Absent therefore means "the
   * strategy that billed this did not say", never "the agent's provider".
   */
  readonly provider?: string;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly estimatedUsd: number;
  readonly cumulative: {
    readonly tokensInput: number;
    readonly tokensOutput: number;
    readonly estimatedUsd: number;
  };
}

export interface CostLimitHitPayload {
  readonly kind: 'max_tokens' | 'max_cost' | 'max_iterations' | 'max_wallclock';
  readonly limit: number;
  readonly actual: number;
  readonly action: 'abort' | 'warn' | 'degrade';
}

// eval.* (3)
export interface EvalScorePayload {
  readonly metricId: string;
  readonly value: number;
  readonly threshold?: number;
  readonly target: 'iteration' | 'turn' | 'run' | 'toolCall';
  readonly targetRef: string;
  readonly evaluator?: 'llm' | 'fn' | 'heuristic';
  readonly evidence?: Readonly<Record<string, unknown>>;
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
   *  asserted nothing the extractor treats as data. */
  readonly candidates: number;
  /** The values that appear in no tool result, truncated to a readable list.
   *  Empty when `action` is `'grounded'`. */
  readonly unsupported: readonly { readonly value: string; readonly shape: string }[];
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
}

/**
 * The model this run STARTS with, and what may replace it mid-run.
 *
 * `model` is the agent's resolved default — the one `callLLM` sends unless
 * something overrides it. It is deliberately not the "final" model: a
 * `.configure()` resolver reads the run's input in the seed stage (AFTER this
 * event), and per-skill brains pick per iteration. Resolving `.configure()`
 * here to make this field "effective" would call a consumer's resolver twice
 * per run, and two calls can disagree — so the manifest names the starting
 * choice and {@link RunConfiguredLlmPayload.modelOverrides} names who is
 * allowed to change it. What each call REALLY used is on
 * `agentfootprint.stream.llm_start`, per call, as it always was.
 */
export interface RunConfiguredLlmPayload {
  /** `LLMProvider.name` — the effective provider, decorators included. */
  readonly provider: string;
  /** The agent's resolved default model. */
  readonly model: string;
  /**
   * Which mounted mechanisms may replace `model` during this run, by NAME —
   * `'configure'` (a `.configure()` resolver) and `'skill-brains'` (per-skill
   * providers/models, escalation included). Absent when nothing can: then
   * `model` is what every call of this run used, and an experiment can group
   * on it alone.
   */
  readonly modelOverrides?: readonly ('configure' | 'skill-brains')[];
}

/**
 * One mounted memory, by the names it DECLARED.
 *
 * The store itself is not named: `MemoryStore` declares no id and no kind, so
 * naming which backend was in play would mean inventing a label (a class name
 * that survives no bundler, say) and an invented label is exactly what an arm
 * must not be grouped on. What IS declared is here.
 */
export interface RunConfiguredMemoryPayload {
  /** The `defineMemory({ id })` — the same id `memory.*` events carry. */
  readonly id: string;
  /** `'episodic' | 'semantic' | 'narrative' | 'causal'`. */
  readonly type: MemoryType;
  /** The strategy KIND it was compiled from (`'window'`, `'topK'`, …).
   *  Absent for a hand-built definition, which declares none. */
  readonly strategy?: MemoryStrategyKind;
  /** `RetrievalStrategy.name`, when the memory was given a spelled-out
   *  retrieval rule. Absent for the `{ topK, threshold }` shorthand — which
   *  is a rule with no name, not the default one. */
  readonly retrieval?: string;
  /** The embedder in play, by its own `Embedder.id` (or the declared
   *  `embedderId` when the store embeds server-side and no embedder was
   *  passed). Absent when neither side named one. */
  readonly embedderId?: string;
  /** `'memory'` (conversation recall) or `'rag'` (corpus retrieval), when the
   *  definition declared which claim it makes. */
  readonly flavor?: MemoryFlavor;
}

/**
 * The mounted skill graph's routing posture. The OBJECT's presence means a
 * graph is mounted; each absent field means that half was not declared.
 */
export interface RunConfiguredSkillGraphPayload {
  /** The mount's `strictness` — how much authority the graph has over the
   *  model's own picks. Absent for a graph mounted without the turn-start
   *  cascade options (routing then works exactly as it did in 9.16). */
  readonly routing?: 'assist' | 'guard' | 'rails';
  /** Whether the cursor survives the turn. Absent for the same reason. */
  readonly continuity?: 'turn' | 'conversation';
  /**
   * `IntentScorer.name` — the `.classify()` scorer that routes turn starts.
   * Absent when the graph declares no classifier, INCLUDING a graph routed by
   * `entryBy()` / `entryByRelevance()`: those hand the agent a bound
   * `scoreEntries` function and never the strategy that owns it, so there is
   * no name here to report. `skill.turn_routed.scorer` names the scorer that
   * really ran, whichever door it came through.
   */
  readonly scorer?: string;
}

/**
 * The artifacts wiring. Presence means a store is configured; like
 * `MemoryStore`, `ArtifactStore` declares no id, so WHICH store is not named.
 */
export interface RunConfiguredArtifactsPayload {
  /** True when the placement dial is on — oversized tool results travel to
   *  the model as a claim ticket instead of inline text. The threshold is a
   *  number, not a name, so it is not carried. */
  readonly placement?: true;
  /** True when each run is filed as a recording artifact. */
  readonly recordings?: true;
}

/**
 * One applied recipe — the declared, versioned composition that produced part
 * of this agent (9.48.0).
 *
 * The pair is what makes the row worth reading: two runs of `support-desk` that
 * answered differently are a mystery until the record says one was `1.2.0` and
 * the other `1.3.0`. The recipe's `description` is deliberately not here — it
 * is prose about the composition, and the manifest carries what a consumer
 * BRANCHES on.
 */
export interface RunConfiguredRecipePayload {
  /** The composition's plain name, e.g. `'support-desk'`. */
  readonly id: string;
  /** Its SemVer version, e.g. `'1.2.0'`. Kept a SEPARATE field from `id` —
   *  a composed `'support-desk@1.2.0'` would be one string that two different
   *  pairs could produce as soon as either half may contain the separator. */
  readonly version: string;
}

/**
 * The run-configuration manifest — ONE event at run start naming which
 * adapters and strategies this run is about to use.
 *
 * ## Why it exists
 *
 * Swapping a strategy in this library is easy; ATTRIBUTING an outcome to it
 * was not. Every other event carries `meta.runId`, and the numbers are already
 * there (tokens, latency, iterations, routing, refusals, evidence verdicts) —
 * what was missing was the JOIN KEY that says which of them belong to the same
 * ARM. Two ports used to name what varied (`skill.turn_routed.scorer`,
 * `memory.retrieved.strategy`); everything else was anonymous, and grouping N
 * runs into labelled arms was the experimenter's own bookkeeping, differently
 * spelled in every study. Group by this payload and the arms name themselves.
 *
 * ## Names and ids ONLY — the hard rule
 *
 * No credentials, endpoints, connection strings, keys, tenants or principals,
 * and no config VALUE that could be one. A manifest that leaks an endpoint is
 * worse than no manifest: it travels into every recording, every vendor sink
 * and every shared trace, which is precisely where a secret must not be. When
 * the only handle on a component is a value (a directory, a URL, a table), the
 * component is reported as PRESENT and left unnamed. Pinned by test.
 *
 * ## Absence is a fact, never a guess
 *
 * An absent field means "not configured" or "the strategy did not say" — never
 * `'default'` or `'unknown'` filled in on a reader's behalf, the same
 * distinction `CostTickPayload.provider` already makes. `memories: []` is the
 * explicit "no memory is mounted".
 *
 * ## What it costs
 *
 * One small event per run, by design — the manifest of a run that emitted no
 * manifest cannot be recovered afterwards. It carries names, never lists that
 * grow with the workload (tool names ride `tools.offered`, injections ride
 * `context.injected`), so its size is bounded by the agent's CONFIGURATION and
 * not by the turn. Skipped entirely when nothing is listening.
 *
 * @example Group two runs into two arms
 * ```ts
 * const arms = new Map<string, string>();          // runId → arm label
 * agent.on('agentfootprint.agent.run_configured', (e) => {
 *   arms.set(e.meta.runId, `${e.payload.llm.model}/${e.payload.memories[0]?.retrieval ?? 'no-retrieval'}`);
 * });
 * agent.on('agentfootprint.agent.turn_end', (e) => {
 *   record(arms.get(e.meta.runId), e.payload.durationMs);
 * });
 * ```
 */
export interface AgentRunConfiguredPayload {
  /** The agent's stable id — the same one `meta.compositionPath` carries.
   *  A study that runs two differently-configured agents groups on this. */
  readonly agentId: string;
  readonly llm: RunConfiguredLlmPayload;
  /** Which chart shape ran the loop. A strategy choice with its own
   *  behaviour, not a cosmetic one (see `AgentOptions.reactMode`). */
  readonly reactMode: 'classic' | 'dynamic' | 'dynamic-grouped';
  /** Every mounted memory, declaration order. `[]` means none is mounted —
   *  stated rather than omitted, because "no memory" is itself an arm. */
  readonly memories: readonly RunConfiguredMemoryPayload[];
  /** `WindowStrategy.name` — the one strategy `.window()` or `.compaction()`
   *  mounted (both doors set the same strategy). Absent = no window stage. */
  readonly window?: string;
  readonly skillGraph?: RunConfiguredSkillGraphPayload;
  /** The evidence gate's posture (`.namesAndNumbersFromEvidence()`).
   *  Presence means the gate is on; absence means it is not mounted. */
  readonly evidenceGate?: 'assist' | 'guard' | 'rails';
  readonly artifacts?: RunConfiguredArtifactsPayload;
  /**
   * The recipes `.recipe()` applied, in declaration order — which declared,
   * versioned composition produced this agent (9.48.0).
   *
   * ABSENT when none was applied, and that is the one asymmetry with
   * {@link memories}: "no memory" is an arm a study compares against, while
   * "no recipe" is the state of every agent written before recipes existed,
   * and an empty list on all of them would be new bytes in every recording for
   * a feature nobody used.
   */
  readonly recipes?: readonly RunConfiguredRecipePayload[];
}

export interface AgentOutputSchemaValidationFailedPayload {
  /** Validation error message (from Zod / parser). */
  readonly message: string;
  /** Validation stage — JSON parse vs schema validate. Lets dashboards
   *  distinguish "model emitted prose" (`json-parse`) from "model emitted
   *  JSON but wrong shape" (`schema-validate`); they trend differently
   *  under model drift. */
  readonly stage: 'json-parse' | 'schema-validate';
  /** Failing field path when the parser exposes one (e.g. `'amount.currency'`).
   *  Only set when `stage === 'schema-validate'`. */
  readonly path?: string;
  /** The raw string output that failed — useful for narrative entries showing
   *  "what the model actually said" alongside the validation error. */
  readonly rawOutput?: string;
  /** 1-indexed attempt counter. `1` for the first failure, `2` for the
   *  retry that also failed, etc. */
  readonly attempt: number;
  /** Total output-schema failures in this gate execution. Same as
   *  `validationErrorHistory.length`. Distinct from `attempt` because a
   *  gate can also retry on non-validation errors (5xx, etc.) — this
   *  counts ONLY the schema-driven failures. */
  readonly cumulativeRetries: number;
}

// error.* (retry/recover; fatal is Tier 1)
//
// NOTE: error.retried / error.recovered are shaped for the standalone
// PROVIDER DECORATORS (withRetry / withFallback / withCircuitBreaker) —
// a decorator has a fixed `maxAttempts` + exponential `backoffMs` and a
// wall-clock `totalDurationMs`. The rules-based reliability loop has no
// fixed attempt cap and no backoff (rules decide dynamically), so it
// uses the `reliability.*` family below instead. Keep the two families
// distinct — do NOT cross-emit (see docs/MENTAL_MODEL.md §14).
export interface ErrorRetriedPayload {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly lastError: string;
  readonly backoffMs: number;
  readonly reason: string;
}

export interface ErrorRecoveredPayload {
  readonly attempt: number;
  readonly totalDurationMs: number;
}

/**
 * v9.32 — `withCircuitBreaker` moved between states.
 *
 * The gap this fills, named: until 9.32 the breaker reported nothing at all
 * through the in-run channel. `onStateChange` was the only way to see a trip,
 * and that is a consumer-level callback where a run's correlation ids are not
 * available — so a breaker that opened mid-run was invisible in the trace
 * beside the tool calls it stopped. An independent reviewer (2026-08-13, on a
 * local harness of scripted failures) watched a breaker open after two
 * failures, serve the next request from fallback, half-open after cooldown and
 * close after two probes: every step correct, every step off the record.
 *
 * Transitions ONLY. A hundred requests rejected while the breaker is already
 * open produce zero events — a re-entry into the same state is not a change,
 * and reporting it would turn a state log into a request log.
 *
 * On the `error.*` domain because that is where the provider decorators
 * already report; `reliability.*` is the separate rules-based loop.
 */
export interface ErrorCircuitChangedPayload {
  /** The state entered. */
  readonly state: 'closed' | 'open' | 'half-open';
  /**
   * WHY, in the breaker's own words — `'3 consecutive failures'`,
   * `'cooldown elapsed'`, `'2 probe successes'`, `'half-open probe failed'`.
   *
   * Never an error's message: the failure that tripped it is reported by
   * whoever threw it, and copying it here would attribute one vendor's text to
   * a state machine that only counted.
   */
  readonly reason: string;
  /** WHICH provider this breaker wraps — `inner.name`, not a composite chain
   *  name. Two breakers under one fallback produce one stream, and this is
   *  what tells them apart. */
  readonly providerName: string;
}

// reliability.* — the RULES-BASED reliability loop's telemetry family
// (Agent.create(...).reliability({...})). Distinct from error.* (which is
// for the provider decorators). Pure telemetry on the emit channel; the
// loop's control state stays in scope (reliabilityFail* on AgentState).
//
// `errorKind` is a plain string here (not the reliability ErrorKind
// union) so the events contract layer does not depend on reliability
// internals — mirrors how ErrorRetriedPayload uses `lastError: string`.

/**
 * Fired when the rules loop (or the reliability gate chart) gives up via
 * a `fail-fast` decision. Superset shape: `phase`/`kind`/`attempt` are
 * always present; the remaining fields are populated by whichever site
 * emits (the loop carries `label`/`providerUsed`/`errorKind`; the gate
 * chart carries `reason`).
 */
export interface ReliabilityFailFastPayload {
  readonly phase: 'pre-check' | 'post-decide';
  /** The matched rule's `kind` (machine-readable bucket). */
  readonly kind: string;
  /** 1-indexed attempt counter at the point of failure. */
  readonly attempt: number;
  /** Human-readable label of the matched rule (loop sites). */
  readonly label?: string;
  /** Free-form reason string (gate-chart sites). */
  readonly reason?: string;
  /** Provider in use when the loop failed fast. */
  readonly providerUsed?: string;
  /** Classification of the failure being failed-fast on. */
  readonly errorKind?: string;
  /** Originating error message, when present. */
  readonly errorMessage?: string;
}

/**
 * Fired each time the rules loop decides to RETRY after a failed attempt
 * — `action` distinguishes a same-provider retry from a provider failover.
 */
export interface ReliabilityRetriedPayload {
  /** 1-indexed counter of the attempt that just FAILED and is being retried. */
  readonly attempt: number;
  /** `retry` = same provider again; `retry-other` = switch provider. */
  readonly action: 'retry' | 'retry-other';
  /** Classification of the failure being retried. */
  readonly errorKind: string;
  /** Originating error message, when present. */
  readonly errorMessage?: string;
  /** Provider that just failed. */
  readonly fromProvider: string;
  /** Provider the NEXT attempt will use (equals `fromProvider` for `retry`). */
  readonly toProvider: string;
}

/**
 * Fired when the rules loop produces a successful response AFTER one or
 * more failed attempts (self-healed). `recoveredVia` names the mechanism
 * of the final successful step.
 */
export interface ReliabilityRecoveredPayload {
  /** 1-indexed attempt number that finally succeeded. */
  readonly attempt: number;
  /** How recovery happened. */
  readonly recoveredVia: 'retry' | 'retry-other' | 'fallback';
  /** How many attempts failed before this success. */
  readonly priorFailures: number;
  /** Classification of the LAST failure before recovery. */
  readonly errorKind: string;
}

// resilience.* (2) — the OUTPUT-fallback ladder, distinct from both
// `error.*` (decorator-shaped) and `reliability.*` (the rules loop). These
// two fire when a typed answer failed its own `outputSchema` and the
// 3-tier `outputFallback` ladder took over: tier 2 (the fallback function)
// and tier 3 (the canned value). Emitted since 8.18.0 through a loosely
// typed `emit(eventType: string, …)` parameter, which is how they shipped
// for months without a payload interface or an `ALL_EVENT_TYPES` entry —
// registered here so `runner.on(...)` accepts them like every other event.

/**
 * Tier 2 engaged: `parseOutput()` / `runTyped()` could not validate the
 * model's answer against `outputSchema`, and the consumer-supplied
 * `fallback` function is about to run. Fires BEFORE the fallback executes,
 * so it is a record of degradation starting — not of it succeeding.
 */
export interface ResilienceOutputFallbackTriggeredPayload {
  /** Which half of validation failed: bad JSON, or good JSON of the wrong shape. */
  readonly stage: 'json-parse' | 'schema-validate';
  /** First 200 chars of the model's raw answer. Truncated by construction —
   *  never the whole output. */
  readonly rawOutputPreview: string;
  /** Message of the `OutputSchemaError` that opened the ladder. */
  readonly primaryErrorMessage: string;
  /** Corrective re-asks this run already paid for before the answer reached
   *  the ladder (the `outputAttempts` ledger minus the first attempt).
   *  ABSENT when the caller parsed a string that did not come from this
   *  agent's last run — absent means unknown, never zero. */
  readonly retriesSpent?: number;
}

/**
 * Tier 3 engaged: the fallback function itself failed (threw, or returned a
 * value that also failed the schema) and the static `canned` value is being
 * returned instead. This is the event that says a run billed real tokens and
 * ended in a constant — with `canned` configured, `runTyped()` is
 * structurally unable to throw, so this event is the ONLY signal.
 */
export interface ResilienceOutputCannedUsedPayload {
  /** First 200 chars of the model's raw answer. Truncated by construction. */
  readonly rawOutputPreview: string;
  /** Why tier 2 did not hold — the fallback's own throw, or the validation
   *  error its return value produced. */
  readonly fallbackErrorMessage: string;
  /** Corrective re-asks this run already paid for. ABSENT when unknown. */
  readonly retriesSpent?: number;
}

// embedding.* (1)
export interface EmbeddingGeneratedPayload {
  readonly model: string;
  readonly provider: 'openai' | 'cohere' | 'voyage' | 'local' | 'custom';
  readonly inputKind: 'query' | 'document';
  readonly dimension: number;
  readonly count: number;
  readonly durationMs: number;
  readonly tokensSpent?: number;
}

// stream.thinking.* (2) + agent.thinking.* (1) — v2.14 extended thinking

/**
 * Emitted (v2.14) per provider chunk that carries thinking-content
 * tokens. Lives in `stream.*` domain — parallel to `stream.token` for
 * visible-content tokens.
 *
 * **Provider behavior:**
 * - Anthropic: fires for every `content_block_delta` with
 *   `delta.type === 'thinking_delta'`. May fire 100s of times per turn.
 * - OpenAI o1/o3: NEVER fires (OpenAI doesn't stream reasoning content
 *   as of early 2026). Only `thinking_end` fires at response completion.
 * - Custom providers: fire when `ThinkingHandler.parseChunk()` returns
 *   a non-empty `thinkingDelta`.
 *
 * **Default consumer behavior:** thinking_delta events are emitted but
 * not surfaced to end users unless a consumer explicitly subscribes to
 * this event (e.g. for reasoning-as-it-streams UIs).
 *
 * **Sensitive data:** `content` is raw model thinking text. Use
 * `RedactionPolicy.thinkingPatterns` (Phase 3) to scrub before audit-log
 * adapters fire. Same risk profile as `stream.token`.
 */
export interface StreamThinkingDeltaPayload {
  readonly iteration: number;
  readonly tokenIndex: number;
  /** Per-chunk delta text, NOT accumulated. ~10–50 chars typical. */
  readonly content: string;
}

/**
 * Emitted (v2.14) once per LLM call where thinking blocks were
 * produced. Pairs with the leading `stream.thinking_delta` events when
 * streaming, OR fires standalone for non-streaming providers (OpenAI).
 *
 * Use this event for live per-iteration UIs (chat-bubble reasoning
 * pills, retry-rate dashboards, telemetry). The `blocks` field carries
 * the same content that lands on `LLMMessage.thinkingBlocks` — read it
 * here for live display instead of post-walking `scope.history` after
 * the run completes (the framework's "collect during traversal" rule).
 *
 * **`tokens` field population:**
 * - Anthropic: `undefined` currently — Anthropic's `response.usage`
 *   doesn't break out thinking tokens (bundled in `output_tokens`).
 *   May change in future Anthropic API revisions.
 * - OpenAI o1/o3: populated from
 *   `response.usage.completion_tokens_details.reasoning_tokens`.
 * - Custom providers: populated when handler computes it during
 *   `normalize()`.
 *
 * **Sensitive data:** the `blocks` field carries reasoning content.
 * Same risk profile as `stream.token` — wildcard (`*`) recorders
 * piping to external sinks (Datadog, CloudWatch, OTel) will see this.
 * Treat thinking content with the same redaction posture you give
 * visible response tokens. `providerMeta` is already stripped by the
 * framework before persistence (Phase 6 invariant), so the blocks
 * here match the audit-log surface bytes-exactly.
 */
export interface StreamThinkingEndPayload {
  readonly iteration: number;
  readonly blockCount: number;
  readonly totalChars: number;
  readonly tokens?: number;
  /**
   * v2.14+ — the normalized thinking blocks for this LLM call.
   *
   * Same data the framework persists to `LLMMessage.thinkingBlocks`
   * (post-`providerMeta` strip). Lets live consumers render the
   * model's chain-of-thought per iteration without scope-walking
   * after the run.
   *
   * Empty / undefined when no thinking content was produced this
   * call (handler returned `[]`). Non-empty when at least one
   * thinking or redacted_thinking block landed.
   */
  readonly blocks?: readonly ThinkingBlock[];
}

/**
 * Emitted (v2.14) when a `ThinkingHandler.normalize()` call throws.
 * The framework catches the throw, drops the thinking blocks (they
 * don't land on `LLMMessage.thinkingBlocks`), and continues the agent
 * run. Same graceful-failure pattern as v2.11.6
 * `tools.discovery_failed`.
 *
 * Lives in `agent.*` domain (NOT `stream.*`) because parse failure is
 * a turn-level error concern — recovery happens at the agent loop
 * level, not at the SDK call level.
 *
 * **Anti-pattern (provider authors):** sanitize error messages before
 * throwing. NEVER include raw unparsed thinking content in the error
 * — the message ends up in audit logs and can leak reasoning content
 * the consumer expected to be redacted. Same guidance as
 * `tools.discovery_failed.error`.
 */
export interface AgentThinkingParseFailedPayload {
  readonly providerName: string;
  readonly subflowId: string;
  readonly error: string;
  readonly errorName: string;
  readonly iteration: number;
}

// artifacts.* (4) — the claim-check lifecycle (9.21.0). Every hop of a ref —
// minted, resolved, swept, refused — lands on the record AS IT HAPPENS, which
// is what separates this store from "where are the bytes" systems: the trace
// answers which step produced an artifact, reading what, under which decision.
// LAW: these payloads carry META ONLY. Payload bytes never enter an event, a
// recorder, or an exporter — an id in a log is safe by construction because a
// ref alone opens nothing.

/** A tool checked a payload in and the store minted its claim ticket. */
export interface ArtifactMintedPayload {
  readonly ref: string;
  /** Consumer vocabulary: 'dataset/rows', 'chart/spec', … */
  readonly kind: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly label?: string;
  /** `sha-256:<hex>` when the put asked for one. Metadata, never the key. */
  readonly digest?: string;
  /** Unix ms when the ref stops resolving — stated at mint, never sprung. */
  readonly expiresAt?: number;
  /** The join to the trace: the run and tool call that minted it. */
  readonly origin?: ArtifactOrigin;
  /** Derivation facts — validated at mint, so they cannot dangle at birth. */
  readonly parentRefs?: readonly string[];
  /** The tool whose execute minted it. */
  readonly tool: string;
}

/** A ref was redeemed — described (`head`) or read (`get`) — under scope. */
export interface ArtifactResolvedPayload {
  readonly ref: string;
  /** `head` is the render-by-ref decision; `get` pays for the payload. */
  readonly via: 'head' | 'get';
  readonly kind: string;
  readonly bytes: number;
  /** The tool that redeemed it. ABSENT when the redemption came through the
   *  hosting door instead of a tool (9.23.0) — a screen resolving
   *  `artifact-head` / `artifact-get` over the wire, under the requesting
   *  session's identity. Stamping a phantom tool name there would be a
   *  dashboard grouping by an actor that does not exist. */
  readonly tool?: string;
}

/** An artifact left the store without its owner asking — the calendar (ttl)
 *  or a budget (max-bytes / max-count). Reported by the put that swept it. */
export interface ArtifactExpiredPayload {
  readonly ref: string;
  /** One vocabulary, defined in `artifacts/` and imported here — the
   *  PermissionCapability lesson: two copies of one union can drift. */
  readonly reason: ArtifactSweepReason;
  readonly kind: string;
  readonly bytes: number;
  /** The tool whose put discovered/forced the sweep. */
  readonly tool: string;
}

/** An artifact verb refused — or answered "no data" — and said why. `no-store`
 *  is the fail-closed capability teaching how to attach a store;
 *  `missing-or-expired` keeps the API's deliberate ambiguity while the record
 *  still shows a resolve that found nothing; `digest-mismatch` is integrity
 *  refusing to deliver corrupt bytes as whole. Since 9.22.0, `op: 'dispatch'`
 *  is the framework's own door: a tool's declared `wants` argument (or a
 *  `present` call) that could not be delivered — the tool did not run and the
 *  model read a teaching refusal listing what CAN resolve
 *  (`kind-mismatch` names a ref that resolved to the wrong kind). */
export interface ArtifactRefusedPayload {
  readonly op: ArtifactOp;
  readonly reason: ArtifactRefusalReason;
  readonly ref?: string;
  /** The refusal sentence, when one was thrown. */
  readonly detail?: string;
  /** The tool whose call was refused. ABSENT when the refusal answered the
   *  hosting door instead of a tool (9.23.0) — a wire resolution that found
   *  nothing (`missing-or-expired`: the one indistinguishable answer for
   *  missing, expired and another-session's alike) or reached an agent with
   *  no store (`no-store`). */
  readonly tool?: string;
}

/** The model handed an artifact to the screen (9.22.0): `present({ ref, as,
 *  label? })` resolved under the run's scope. `snapshot` is the description
 *  the claim ticket carries at speak time — `{ kind, mediaType, bytes,
 *  label }` — the same snapshot stored INSIDE the tool result so a reloaded
 *  conversation can render an honest placeholder after the artifact expired.
 *  `as` is the model's consumer vocabulary ('bar-chart', 'table', …), stored
 *  as data — the component registry that would validate it is a later phase.
 *  Meta only, never the payload: the screen redeems the ref itself, under
 *  its own identity. */
export interface ArtifactPresentedPayload {
  readonly ref: string;
  readonly as: string;
  readonly snapshot: {
    readonly kind: string;
    readonly mediaType: string;
    readonly bytes: number;
    readonly label?: string;
  };
  /** The presenting call — the join to the trace. */
  readonly toolCallId: string;
  readonly iteration: number;
}
