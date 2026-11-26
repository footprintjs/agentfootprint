/**
 * stepGraphTypes — the step graph's public shapes: what
 * `FlowchartRecorder.ts · buildStepGraphFromEvents` folds a boundary event
 * stream into, and what Lens and the strategies read.
 *
 * Role:  Types only. Re-exported from `FlowchartRecorder.ts`, the module every
 *        consumer imports them from; kept apart so the fold stays small.
 */

// ─── Public types (preserved shape — Lens consumes these today) ─────

/**
 * One node in the step-level flowchart. Node kind drives rendering
 * (actor icon, color). ReAct steps carry token + tool details; topology
 * nodes (subflow / fork-branch / decision-branch) mirror the footprintjs
 * composition events and exist so composition structure (Loop, Parallel,
 * Conditional, Swarm) stays visible in the graph.
 */
export interface StepNode {
  readonly id: string;
  readonly kind:
    | 'user->llm' // input arrived at the LLM (first iteration)
    | 'llm->tool' // LLM requested tool execution
    | 'tool->llm' // tool result returned, next LLM call begins
    | 'llm->user' // terminal LLM response (no tool calls remaining)
    | 'subflow' // composition boundary (root run + non-internal subflows)
    | 'fork-branch' // one branch of a Parallel fan-out
    | 'decision-branch'; // chosen branch of a Conditional
  readonly label: string;
  readonly startOffsetMs: number;
  readonly endOffsetMs?: number;
  /** LLM step: token usage of the call that bounded this step. */
  readonly tokens?: { readonly in: number; readonly out: number };
  /** llm->tool / tool->llm: the tool name. */
  readonly toolName?: string;
  /** user->llm / tool->llm: the model that was invoked. */
  readonly llmModel?: string;
  /** Decomposition of the underlying subflowId (rooted under '__root__'). */
  readonly subflowPath: readonly string[];
  /** Context injections attributed to this step (LLM steps only). */
  readonly injections?: readonly ContextInjection[];
  /** 1-based ReAct iteration this step belongs to. Undefined for
   *  topology / composition nodes. */
  readonly iterationIndex?: number;
  /** Which slot the step's input updated. ReAct steps only. */
  readonly slotUpdated?: 'system-prompt' | 'messages' | 'tools';
  /** True ONLY for `subflow` StepNodes whose primitiveKind is `'Agent'`.
   *  Narrow flag for callers that distinguish ReAct agents from other
   *  composition primitives (cost / iteration / token attribution). */
  readonly isAgentBoundary?: boolean;
  /** Primitive kind from the subflow root description prefix
   *  (`'Agent'` / `'LLMCall'` / `'Sequence'` / etc.). */
  readonly primitiveKind?: string;
  /** True for `subflow` StepNodes representing any KNOWN primitive
   *  (Agent / LLMCall / Sequence / Parallel / Conditional / Loop) —
   *  drives Lens's drill-in container treatment. */
  readonly isPrimitiveBoundary?: boolean;
  /** `inputMapper` payload at the subflow's entry. Subflow nodes only. */
  readonly entryPayload?: unknown;
  /** Subflow shared state at exit. Subflow nodes only.
   *  Undefined for in-progress / paused subflows. */
  readonly exitPayload?: unknown;
  /** Set instead of `entryPayload` when the recording keeps that payload with
   *  the invocation (a recording saved in parts, index format 2): ask for the
   *  invocation `runtimeStageId` names. Neither field = none was recorded. */
  readonly entryPayloadWith?: 'invocation';
  /** The same, instead of `exitPayload`. */
  readonly exitPayloadWith?: 'invocation';
  /** LLM's text content. Set on `llm->tool` (the reasoning emitted with the
   *  tool_use blocks) and on `llm->user` (the terminal answer). */
  readonly assistantText?: string;
  /** Tool input arguments the LLM produced. Set on `llm->tool` from the
   *  matching `tool.start` event payload. */
  readonly toolArgs?: unknown;
  /** Tool result returned to the LLM. Set on `tool->llm` from the
   *  preceding `tool.end` event payload. */
  readonly toolResult?: unknown;
  /** Stable per-execution key — same `runtimeStageId` Trace view uses. */
  readonly runtimeStageId?: string;
  /**
   * Slot boundary payloads composed for THIS LLM step.
   *
   * Set ONLY for `kind === 'user->llm'` and `kind === 'tool->llm'`
   * StepNodes — the moments where context flows INTO the LLM. Each
   * entry carries the slot subflow's `inputMapper` result (entryPayload)
   * and rendered slot output (exitPayload).
   *
   * Attribution: any slot subflow that fired BETWEEN the previous LLM
   * end (or run start) and THIS LLM start is attributed to this call.
   * Done at projection time over `boundary.getEvents()`; no consumer-
   * side correlation required.
   *
   * Lens uses this to make the 3 slot rows inside the LLM card
   * clickable — clicking a slot reveals its entry/exit payloads in
   * the right-pane detail panel without needing direct BoundaryRecorder
   * access.
   */
  readonly slotBoundaries?: {
    readonly systemPrompt?: SlotBoundary;
    readonly messages?: SlotBoundary;
    readonly tools?: SlotBoundary;
  };
}

/** One slot's boundary pair attributed to a specific LLM step. */
export interface SlotBoundary {
  /** runtimeStageId of the slot subflow execution. */
  readonly runtimeStageId: string;
  /** `inputMapper` payload — the data the slot was COMPOSED FROM
   *  (RAG hits, skill content, user message, tool result, etc). */
  readonly entryPayload?: unknown;
  /** Subflow shared state at exit — the rendered slot content
   *  (system prompt string, messages array, tools array). */
  readonly exitPayload?: unknown;
  /** Set instead of `entryPayload` when the recording keeps that payload with
   *  the slot invocation `runtimeStageId` names (index format 2). */
  readonly entryPayloadWith?: 'invocation';
  /** The same, instead of `exitPayload`. */
  readonly exitPayloadWith?: 'invocation';
}

/** Consumer-facing context injection (5 axes of context engineering). */
export interface ContextInjection {
  readonly slot: 'system-prompt' | 'messages' | 'tools';
  readonly asRole?: 'system' | 'user' | 'assistant' | 'tool';
  readonly source: string;
  readonly sourceId?: string;
  readonly contentSummary?: string;
  readonly reason?: string;
  readonly sectionTag?: string;
  readonly upstreamRef?: string;
  readonly retrievalScore?: number;
  readonly rankPosition?: number;
  readonly budgetTokens?: number;
  readonly budgetFraction?: number;
}

export interface StepEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'next' | 'loop-iteration' | 'fork-branch' | 'decision-branch';
  readonly iteration?: number;
}

export interface StepGraph {
  readonly nodes: readonly StepNode[];
  readonly edges: readonly StepEdge[];
  readonly activeNodeId?: string;
}
