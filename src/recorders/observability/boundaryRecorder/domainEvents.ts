import type { ContextSlot } from '../../../events/types.js';
import type { ToolStartPayload, ToolEndPayload } from '../../../events/payloads.js';

// ─── DomainEvent: discriminated union ────────────────────────────────

/** Fields every domain event carries. */
interface DomainEventBase {
  /** Stable per-execution key (footprintjs primitive). For run events it
   *  is `'__root__#0'`; subflow events use the parent stage's runtimeStageId
   *  at mount; typed events use the firing stage's runtimeStageId. */
  readonly runtimeStageId: string;
  /** Decomposition of `subflowId` into segments, rooted under `'__root__'`. */
  readonly subflowPath: readonly string[];
  /** Depth in the run tree — root = 0, top-level subflow = 1, etc. */
  readonly depth: number;
  /** Wall-clock ms at capture time. */
  readonly ts: number;
  /** Commit count when this event fired. 0 if the recorder was
   *  constructed without `getCommitCount` (legacy mode). The boundary
   *  RANGE for an (entry, exit) pair is `[entry.commitIdxBefore,
   *  exit.commitIdxBefore]`. Phase 5 Layer 2 — see
   *  `docs/design/boundary-commit-ranges.md`. */
  readonly commitIdxBefore: number;
  /** RESERVED for future event types that trigger engine writes.
   *  CURRENT BEHAVIOR: always equals `commitIdxBefore` for every event
   *  emitted by today's BoundaryRecorder. Observer events don't write
   *  to scope, so the executor's commit count doesn't change between
   *  the moment the event is sampled and the moment it's recorded.
   *  Consumers should currently treat this as identical to
   *  `commitIdxBefore`; do NOT rely on it being strictly greater.
   *  The field exists for forward compatibility — if a future
   *  observer pattern triggers commits during its handler, this is
   *  where the post-effect count will land. */
  readonly commitIdxAfter: number;
}

export interface DomainRunEvent extends DomainEventBase {
  readonly type: 'run.entry' | 'run.exit';
  readonly payload?: unknown;
  /** Always `true` for run events — convenience flag for filter callers. */
  readonly isRoot: true;
}

export interface DomainSubflowEvent extends DomainEventBase {
  readonly type: 'subflow.entry' | 'subflow.exit';
  /** Path-prefixed engine id (matches `FlowSubflowEvent.subflowId`). */
  readonly subflowId: string;
  /** Last segment of `subflowId` — convenience for leaf-name grouping. */
  readonly localSubflowId: string;
  readonly subflowName: string;
  /** Build-time description from the subflow root (`'<Kind>: <detail>'`). */
  readonly description?: string;
  /** Parsed `'<Kind>:'` prefix — `'Agent'`, `'LLMCall'`, `'Sequence'`, etc. */
  readonly primitiveKind?: string;
  /** Set ONLY for the 3 input-slot subflows (sf-system-prompt / sf-messages / sf-tools). */
  readonly slotKind?: ContextSlot;
  /** True for Agent state-machine routing/wrapper subflows (route, tool-calls, final, merge). */
  readonly isAgentInternal: boolean;
  /** `inputMapper` result on entry; subflow shared state on exit. */
  readonly payload?: unknown;
}

export interface DomainForkBranchEvent extends DomainEventBase {
  readonly type: 'fork.branch';
  readonly parentSubflowId: string;
  readonly childName: string;
}

export interface DomainDecisionBranchEvent extends DomainEventBase {
  readonly type: 'decision.branch';
  readonly decider: string;
  readonly chosen: string;
  readonly rationale?: string;
  /**
   * `true` when this decision comes from one of the Agent's internal
   * routing stages (e.g., the ReAct `Route` decider that picks
   * `tool-calls` vs `final`). Filtered out of the timeline by
   * `buildStepGraph` — the actor arrows that follow already encode
   * the routing observably (`llm→tool` vs `llm→user`).
   *
   * `false` when the decision comes from a consumer-defined
   * `Conditional` primitive — those ARE meaningful timeline steps.
   */
  readonly isAgentInternal: boolean;
}

export interface DomainLoopIterationEvent extends DomainEventBase {
  readonly type: 'loop.iteration';
  readonly target: string;
  readonly iteration: number;
}

/**
 * Composition boundary event — fired for every composition primitive
 * (Parallel / Sequence / Loop / Conditional). Mirrors `subflow.entry/exit`
 * but for the COMPOSITION wrapper itself (the box that contains the
 * branches / steps / iterations / chosen-branch).
 *
 * This pair OPENS and CLOSES a boundary range in `boundaryIndex`. Child
 * subflows that fire between the pair nest naturally inside the
 * composition's range.
 *
 * The `runtimeStageId` is the composition's own per-execution id —
 * SAME format as any other runtimeStageId, with `#executionIndex`. The
 * `kind` discriminates which composition primitive this is.
 *
 * For the Lens compound time axis, this group is what collapses
 * parallel branches into ONE slider position at the parent's drill
 * level. Drill into the composition to see its children as positions.
 */
export interface DomainCompositionEvent extends DomainEventBase {
  readonly type: 'composition.start' | 'composition.end';
  readonly kind: 'Parallel' | 'Sequence' | 'Loop' | 'Conditional';
  readonly compositionId: string;
  readonly name: string;
  /** On `composition.end`, the exit status reported by the composition. */
  readonly status?: 'ok' | 'err' | 'break' | 'budget_exhausted';
  readonly durationMs?: number;
}

/**
 * The 4 actor arrows of a ReAct cycle. Tagged on `llm.start` / `llm.end`
 * at capture time so consumers (slider, run-flow renderer) dispatch by
 * `event.actorArrow` instead of running their own state machine.
 *
 *   - `'user→llm'` — first LLM call, or any LLM call NOT preceded by a
 *     tool result (assembled-context delivery to the model).
 *   - `'tool→llm'` — LLM call that follows a tool's result (the next
 *     iteration of a ReAct loop).
 *   - `'llm→tool'` — `llm.end` whose `toolCallCount > 0` (the LLM is
 *     requesting tool execution).
 *   - `'llm→user'` — `llm.end` with `toolCallCount === 0` (terminal
 *     response delivered to the user).
 */
export type ActorArrow = 'user→llm' | 'tool→llm' | 'llm→tool' | 'llm→user';

export interface DomainLLMStartEvent extends DomainEventBase {
  readonly type: 'llm.start';
  readonly model: string;
  readonly provider: string;
  readonly systemPromptChars?: number;
  /**
   * The ASSEMBLED system prompt, verbatim as sent (9.88.0) — carried through
   * from `stream.llm_start`, so present under exactly the same condition:
   * the run was built with `recordSystemPrompt: true`. It used to be dropped
   * here, which meant the one opt-in that puts the prompt on the record
   * reached every sink EXCEPT the ordered boundary stream a replay reads.
   *
   * PRIVACY: it carries whatever its pieces carried. See
   * `payloads.ts` · `LLMStartPayload`.
   */
  readonly systemPromptText?: string;
  readonly messagesCount?: number;
  readonly toolsCount?: number;
  /**
   * The tool CATALOG the model saw for this call — `{ name, description }` per
   * tool, in request order (9.88.0, carried through from `stream.llm_start`;
   * absent when the call had no tools). `toolsCount` above says HOW MANY, and
   * a count is not an answer to "which tools was it choosing between?".
   */
  readonly tools?: readonly { readonly name: string; readonly description?: string }[];
  /** Capture-time classification: `'user→llm'` for the first call or any
   *  call not preceded by a tool result; `'tool→llm'` after a tool result. */
  readonly actorArrow: 'user→llm' | 'tool→llm';
}

export interface DomainLLMEndEvent extends DomainEventBase {
  readonly type: 'llm.end';
  readonly content: string;
  readonly toolCallCount: number;
  readonly usage: { readonly input: number; readonly output: number };
  readonly stopReason?: string;
  /** Capture-time classification: `'llm→tool'` when the LLM requested
   *  tools (`toolCallCount > 0`); `'llm→user'` for terminal delivery. */
  readonly actorArrow: 'llm→tool' | 'llm→user';
}

export interface DomainToolStartEvent extends DomainEventBase {
  readonly type: 'tool.start';
  readonly toolName: string;
  readonly toolCallId: string;
  readonly args?: unknown;
  /** 9.113.0 — copied from `stream.tool_start`: a call a paused batch never
   *  dispatched. The step graph draws no tool step for it and a boundary's
   *  rollup does not count it. Absent on every other tool event. */
  readonly notDispatched?: ToolStartPayload['notDispatched'];
}

export interface DomainToolEndEvent extends DomainEventBase {
  readonly type: 'tool.end';
  readonly toolCallId: string;
  readonly result?: unknown;
  readonly durationMs?: number;
  readonly error?: boolean;
  /** 9.113.0 — copied from `stream.tool_end`: the settled call's bracket
   *  closing. Its `result` is the library's sentence, not a tool's. */
  readonly notDispatched?: ToolEndPayload['notDispatched'];
}

export interface DomainContextInjectedEvent extends DomainEventBase {
  readonly type: 'context.injected';
  readonly slot: ContextSlot;
  readonly source: string;
  readonly sourceId?: string;
  readonly asRole?: 'system' | 'user' | 'assistant' | 'tool';
  readonly contentSummary?: string;
  readonly reason?: string;
  readonly sectionTag?: string;
  readonly upstreamRef?: string;
  readonly retrievalScore?: number;
  readonly rankPosition?: number;
  /** Tokens consumed by this injection (from `budgetSpent.tokens`). */
  readonly budgetTokens?: number;
  /** Fraction of slot cap consumed (from `budgetSpent.fractionOfCap`). */
  readonly budgetFraction?: number;
}

/** Discriminated union covering every observable moment in a run. */
export type DomainEvent =
  | DomainRunEvent
  | DomainSubflowEvent
  | DomainCompositionEvent
  | DomainForkBranchEvent
  | DomainDecisionBranchEvent
  | DomainLoopIterationEvent
  | DomainLLMStartEvent
  | DomainLLMEndEvent
  | DomainToolStartEvent
  | DomainToolEndEvent
  | DomainContextInjectedEvent;
