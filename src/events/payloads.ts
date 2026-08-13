/**
 * Event payload types — the 45 typed event payloads across 13 domains.
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
import type { ThinkingBlock } from '../thinking/types.js';
import type { LoopMoment } from '../core/agent/moments.js';

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

// agent.* (6)
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
   * nudge still unspent.
   */
  readonly chosen: 'tool-calls' | 'final' | 'output-retry' | 'step-nudge';
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

export interface ToolEndPayload {
  readonly toolCallId: string;
  readonly result: unknown;
  readonly error?: boolean;
  readonly durationMs: number;
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
   *  sticky default);
   *  `'menu'` — a menu was put in-band (near-tie or unmatched);
   *  `'none'` — the cascade decided nothing the loop may act on (a rails
   *  menu — the offer is still recorded here — or a dropped resume). */
  readonly by: 'entry' | 'intent' | 'continuity' | 'menu' | 'none';
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
