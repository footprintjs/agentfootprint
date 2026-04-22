/**
 * AgentTimelineRecorder — the canonical agent-shaped narrative.
 *
 * THE ABSTRACTION (mirrors footprintjs CombinedNarrativeRecorder):
 *
 *   footprintjs                            agentfootprint
 *   ───────────                            ──────────────
 *   CombinedNarrativeRecorder              AgentTimelineRecorder
 *      ↓ produces NarrativeEntry[]            ↓ produces AgentTimeline
 *      ↓ for ANY UI                           ↓ for ANY UI
 *   ExplainableShell, custom shells       Lens, Grafana panels,
 *                                         CLI debuggers, replay tools
 *
 * The library emits `agentfootprint.stream.*` + `agentfootprint.context.*`
 * events at every interesting moment in a run. This recorder is the ONE
 * PLACE every UI / observability consumer translates that emit stream
 * into the agent-shaped narrative they render against (turns →
 * iterations → tool calls + per-iteration context injections + ledger).
 * One recorder, one shape, every consumer.
 *
 * Storage primitive: footprintjs `SequenceRecorder<TimelineEntry>` —
 * inherits insertion-ordered storage, O(1) per-step lookup via
 * runtimeStageId map, range index for time-travel sliders, and
 * progressive `accumulate()` reduction. We don't reinvent these.
 *
 * @example
 * ```ts
 * import { Agent, agentTimeline, anthropic } from 'agentfootprint';
 *
 * const t = agentTimeline();
 * const agent = Agent.create({ provider: anthropic('claude-sonnet-4') })
 *   .recorder(t)
 *   .build();
 *
 * await agent.run('Investigate port errors on switch-3');
 *
 * t.getTimeline();         // AgentTimeline { turns, messages, tools, ... }
 * t.getEntryRanges();      // O(1) per-step range index for sliders
 * t.aggregate(...);        // reduce all entries
 * ```
 *
 * Multi-agent: each sub-agent in a Pipeline/Swarm gets its own named
 * instance — `agentTimeline({ id: 'classify' })` — and each lands in
 * its own `executor.getSnapshot().recorders[id]` slot. Multi-agent
 * shells aggregate them by id.
 */

import type { EmitEvent, EmitRecorder } from 'footprintjs';
import { SequenceRecorder } from 'footprintjs/trace';

// ── Public types — the AGENT-SHAPED narrative every UI consumes ───────
//
// These live in agentfootprint (not in any UI library) because the
// SHAPE is the contract. Multiple UIs (Lens, Grafana, custom dashboards)
// must read the same data; defining the shape here gives them all a
// single source of truth that evolves with the library, not with one
// UI consumer.

export interface AgentMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCalls?: readonly AgentToolCallStub[];
  readonly toolCallId?: string;
}

/** Tool call stub as it appears on an assistant message. */
export interface AgentToolCallStub {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/** A resolved tool invocation with args + result + timing. */
export interface AgentToolInvocation {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly result: string;
  readonly error?: boolean;
  readonly decisionUpdate?: Record<string, unknown>;
  /** 1-based iteration within the turn. */
  readonly iterationIndex: number;
  /** 0-based turn index. */
  readonly turnIndex: number;
  readonly durationMs?: number;
}

/**
 * One context-engineering injection captured during this iteration —
 * RAG retrieval, skill activation, memory write, instruction firing.
 * The library's "teaching surface" — every injection says WHO injected
 * WHAT into WHICH Agent slot.
 */
export interface AgentContextInjection {
  /** Source name — `rag` / `memory` / `skill` / `instructions` / custom. */
  readonly source: string;
  /** Which Agent slot this injection lands in. */
  readonly slot: 'system-prompt' | 'messages' | 'tools';
  /** Short label rendered in UI tags (e.g. "3 chunks · top 0.95"). */
  readonly label: string;
  /** Wire-level LLM role when the slot is `messages`. */
  readonly role?: 'system' | 'user' | 'assistant' | 'tool';
  /** Index in `messages[]` where the injected message landed. */
  readonly targetIndex?: number;
  /** Per-counter deltas this injection contributed (open key set). */
  readonly deltaCount?: Record<string, number | boolean>;
  /** Raw payload from the emit event — for advanced consumers. */
  readonly payload: Record<string, unknown>;
}

/** Per-iteration accumulated ledger — sum of every injection's deltaCount. */
export type AgentContextLedger = Record<string, number | boolean>;

/** One LLM call + its tool loop. */
export interface AgentIteration {
  readonly index: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly model?: string;
  readonly durationMs?: number;
  readonly stopReason?: string;
  readonly assistantContent: string;
  readonly toolCalls: readonly AgentToolInvocation[];
  readonly decisionAtStart: Record<string, unknown>;
  readonly matchedInstructions?: readonly string[];
  readonly visibleTools: readonly string[];
  /** Context injections that shaped this iteration's prompt. */
  readonly contextInjections: readonly AgentContextInjection[];
  /** Folded ledger across this iteration's injections. */
  readonly contextLedger: AgentContextLedger;
  /**
   * Number of messages in the conversation when this iter's `llm_start`
   * fired. `messages.slice(0, messagesSentCount)` reproduces what the
   * LLM saw on this iteration. Wire-level fact, not a UI concept.
   */
  readonly messagesSentCount: number;
}

/** One `.run()` call. Multi-turn conversations stack these. */
export interface AgentTurn {
  readonly index: number;
  readonly userPrompt: string;
  readonly iterations: readonly AgentIteration[];
  readonly finalContent: string;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalDurationMs: number;
  /** All injections this turn, flat union across iterations. */
  readonly contextInjections: readonly AgentContextInjection[];
  /** Folded ledger across all of this turn's iterations. */
  readonly contextLedger: AgentContextLedger;
}

/**
 * Agent identity attached to a timeline. The `id` matches the
 * recorder's id (the same one passed to `agentTimeline({ id })`); the
 * `name` is the display name from `Agent.create({ name })`. Single
 * source of truth for "which agent did this run belong to" — UI
 * libraries read `timeline.agent.name` instead of fishing it out of
 * the runtime snapshot or asking the consumer to thread a separate
 * prop. Also the foundation for multi-agent rendering: each sub-agent
 * has its own recorder, its own timeline, its own `agent` block.
 */
export interface AgentInfo {
  /** Recorder id — also used as snapshot slot key for multi-agent. */
  readonly id: string;
  /** Display name for UI. Defaults to "Agent" when not supplied. */
  readonly name: string;
}

/**
 * One sub-agent inside a multi-agent timeline. Distinct from
 * `AgentInfo` because sub-agents carry their own slice of turns +
 * messages + tools — they're "small timelines" inside the bigger one.
 *
 * Detection: events from a sub-agent arrive with `subflowPath`
 * populated (e.g. `["classify"]` for the classify stage of a
 * Pipeline). The recorder groups entries by `subflowPath[0]` to
 * derive these sub-agent slices. Single-agent runs have empty
 * `subflowPath` on every event → no sub-agents derived.
 */
export interface SubAgentTimeline {
  /** Sub-agent identity — derived from `subflowPath[0]`. */
  readonly id: string;
  /** Display name. Same as `id` until upstream wiring carries the
   *  human-readable name (e.g. via `Agent.create({ name })` on the
   *  sub-agent's builder). */
  readonly name: string;
  /** Turns owned by this sub-agent. */
  readonly turns: readonly AgentTurn[];
  /** Tool invocations from this sub-agent (subset of timeline.tools). */
  readonly tools: readonly AgentToolInvocation[];
}

/** The full picture: every turn stitched together. */
export interface AgentTimeline {
  /** Identity of the agent that produced this timeline. UIs label
   *  containers / cards / panels with this. */
  readonly agent: AgentInfo;
  readonly turns: readonly AgentTurn[];
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly AgentToolInvocation[];
  readonly finalDecision: Record<string, unknown>;
  /**
   * Per-sub-agent slices for multi-agent runs (Pipeline / Swarm /
   * Routing patterns). Empty array for single-agent runs (the typical
   * Agent / LLMCall / RAG case). UIs check `subAgents.length > 0` to
   * decide between single-container and N-container rendering.
   *
   * Each entry is a self-contained sub-timeline keyed by the
   * `subflowPath[0]` of the events it owns. Multi-agent shells
   * iterate over `subAgents` and render one container per entry.
   */
  readonly subAgents: readonly SubAgentTimeline[];
}

// ── Internal entry shape — what SequenceRecorder<T> stores ────────────
//
// One TimelineEntry per emit event. Discriminated union by `type`.
// `runtimeStageId` is what SequenceRecorder keys on for O(1) per-step
// lookups + range tracking. Kept internal because consumers think in
// terms of AgentTimeline (the derived view), not the raw entry stream.

type TimelineEntry =
  | TurnStartEntry
  | LLMStartEntry
  | LLMEndEntry
  | ToolStartEntry
  | ToolEndEntry
  | TurnEndEntry
  | ContextInjectionEntry;

interface BaseEntry {
  readonly runtimeStageId?: string;
  readonly timestamp: number;
  /**
   * Subflow path from outermost parent down to the subflow that
   * emitted this event. Populated by the executor on every EmitEvent
   * — preserved verbatim here so the folder can derive per-sub-agent
   * slices for multi-agent runs (group entries by `subflowPath[0]`).
   * Empty array for root-flowchart events (single-agent case).
   */
  readonly subflowPath: readonly string[];
}

interface TurnStartEntry extends BaseEntry {
  readonly type: 'turn_start';
  readonly userMessage: string;
}
interface LLMStartEntry extends BaseEntry {
  readonly type: 'llm_start';
  readonly iteration: number;
}
interface LLMEndEntry extends BaseEntry {
  readonly type: 'llm_end';
  readonly iteration: number;
  readonly content: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly stopReason?: string;
  readonly durationMs?: number;
  readonly toolCallCount: number;
}
interface ToolStartEntry extends BaseEntry {
  readonly type: 'tool_start';
  readonly toolName: string;
  readonly toolCallId: string;
  readonly args: Record<string, unknown>;
}
interface ToolEndEntry extends BaseEntry {
  readonly type: 'tool_end';
  readonly toolCallId: string;
  readonly result: string;
  readonly error?: boolean;
  readonly durationMs?: number;
}
interface TurnEndEntry extends BaseEntry {
  readonly type: 'turn_end';
  readonly finalContent?: string;
}
interface ContextInjectionEntry extends BaseEntry {
  readonly type: 'context_injection';
  readonly source: string;
  readonly slot: 'system-prompt' | 'messages' | 'tools';
  readonly label: string;
  readonly role?: 'system' | 'user' | 'assistant' | 'tool';
  readonly targetIndex?: number;
  readonly deltaCount?: Record<string, number | boolean>;
  readonly payload: Record<string, unknown>;
  /**
   * Routing flag captured at emit time: was the LLM phase active?
   * True ⇒ this injection shapes THIS iter's prompt (e.g. RAG fired
   * between llm_start and llm_end). False ⇒ it prepares the NEXT iter
   * (e.g. skill activation post-`read_skill`). The folder uses this to
   * route injections to the correct iteration without re-deriving.
   */
  readonly attachedToCurrentIter: boolean;
}

// ── Recorder ──────────────────────────────────────────────────────────

export interface AgentTimelineRecorderOptions {
  /** Recorder id. Default: `agentfootprint-agent-timeline`. Override
   *  for multi-agent so each sub-agent gets its own snapshot slot. */
  readonly id?: string;
  /**
   * Display name for the agent — surfaces on `timeline.agent.name` so
   * UIs can label the agent's container / card / panel without needing
   * the consumer to thread a separate prop. Defaults to "Agent" when
   * unset. Match this to `Agent.create({ name })` for end-to-end
   * consistency.
   */
  readonly name?: string;
}

export class AgentTimelineRecorder extends SequenceRecorder<TimelineEntry> implements EmitRecorder {
  readonly id: string;
  readonly name: string;

  /** True between an iter's llm_start and llm_end. Drives context-event
   *  routing (THIS iter vs NEXT iter). */
  private llmPhaseActive = false;

  constructor(options?: AgentTimelineRecorderOptions) {
    super();
    this.id = options?.id ?? 'agentfootprint-agent-timeline';
    this.name = options?.name ?? 'Agent';
  }

  // ── EmitRecorder ─────────────────────────────────────────────────────

  /**
   * Single entry point: every emit event the executor dispatches passes
   * through here. Translates the event into a TimelineEntry and stores
   * it via `SequenceRecorder.emit()`. Unknown events are silently
   * ignored — the executor delivers events from many subsystems and we
   * only care about agent-shaped ones.
   */
  onEmit(event: EmitEvent): void {
    const entry = translate(event, this.llmPhaseActive);
    if (!entry) return;
    if (entry.type === 'llm_start') this.llmPhaseActive = true;
    if (entry.type === 'llm_end' || entry.type === 'turn_end') {
      this.llmPhaseActive = false;
    }
    // SequenceRecorder.emit is protected — fine, we're a subclass.
    this.emit(entry);
  }

  /** Reset state. Called automatically by the executor before each
   *  `run()` (recorder-pattern lifecycle hook). */
  override clear(): void {
    super.clear();
    this.llmPhaseActive = false;
  }

  // ── Derived view ────────────────────────────────────────────────────

  /**
   * Fold the recorder's flat entry sequence into the agent-shaped
   * AgentTimeline. Pure derivation — same input always produces same
   * output. Cheap because entry count is bounded by run length.
   */
  getTimeline(): AgentTimeline {
    return foldEntries(this.getEntries(), { id: this.id, name: this.name });
  }
}

/**
 * Public factory. Use this in app code rather than `new AgentTimelineRecorder()`
 * — matches the convention of `agentObservability()`, `contextEngineering()`,
 * and footprintjs's `narrative()` / `metrics()` / `debug()`.
 */
export function agentTimeline(options?: AgentTimelineRecorderOptions): AgentTimelineRecorder {
  return new AgentTimelineRecorder(options);
}

// ── Translation ───────────────────────────────────────────────────────

function translate(event: EmitEvent, llmPhaseActive: boolean): TimelineEntry | null {
  const ts = event.timestamp;
  const id = event.runtimeStageId;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const name = event.name;
  // Preserve subflowPath verbatim — the folder uses it to derive the
  // multi-agent `subAgents` slices. Empty array for root flowchart.
  const subflowPath = event.subflowPath ?? [];

  if (name === 'agentfootprint.stream.llm_start') {
    return {
      type: 'llm_start',
      runtimeStageId: id,
      timestamp: ts,
      subflowPath,
      iteration: numberOr(payload.iteration, 1),
    };
  }
  if (name === 'agentfootprint.stream.llm_end') {
    return {
      type: 'llm_end',
      runtimeStageId: id,
      timestamp: ts,
      subflowPath,
      iteration: numberOr(payload.iteration, 1),
      content: stringOr(payload.content, ''),
      ...(typeof payload.model === 'string' && { model: payload.model }),
      ...maybeUsage(payload.usage),
      ...(typeof payload.stopReason === 'string' && { stopReason: payload.stopReason }),
      ...(typeof payload.durationMs === 'number' && { durationMs: payload.durationMs }),
      toolCallCount: numberOr(payload.toolCallCount, 0),
    };
  }
  if (name === 'agentfootprint.stream.tool_start') {
    return {
      type: 'tool_start',
      runtimeStageId: id,
      timestamp: ts,
      subflowPath,
      toolName: stringOr(payload.toolName, 'unknown'),
      toolCallId: stringOr(payload.toolCallId, `tool-${ts}`),
      args: (payload.args as Record<string, unknown>) ?? {},
    };
  }
  if (name === 'agentfootprint.stream.tool_end') {
    const r = payload.result;
    const result =
      typeof r === 'string'
        ? r
        : r && typeof r === 'object'
        ? stringOr((r as Record<string, unknown>).content, '')
        : '';
    const error = r && typeof r === 'object' && (r as Record<string, unknown>).error === true;
    return {
      type: 'tool_end',
      runtimeStageId: id,
      timestamp: ts,
      subflowPath,
      toolCallId: stringOr(payload.toolCallId, ''),
      result,
      ...(error ? { error: true } : {}),
      ...(typeof payload.durationMs === 'number' ? { durationMs: payload.durationMs } : {}),
    };
  }
  if (name === 'agentfootprint.agent.turn_start') {
    return {
      type: 'turn_start',
      runtimeStageId: id,
      timestamp: ts,
      subflowPath,
      userMessage: stringOr(payload.userMessage, ''),
    };
  }
  if (name === 'agentfootprint.agent.turn_complete') {
    return {
      type: 'turn_end',
      runtimeStageId: id,
      timestamp: ts,
      subflowPath,
      ...(typeof payload.content === 'string' && { finalContent: payload.content }),
    };
  }
  if (name.startsWith('agentfootprint.context.')) {
    const suffix = name.slice('agentfootprint.context.'.length);
    const tagged = buildContextInjection(suffix, payload);
    return {
      type: 'context_injection',
      runtimeStageId: id,
      timestamp: ts,
      subflowPath,
      ...tagged,
      attachedToCurrentIter: llmPhaseActive,
    };
  }
  return null;
}

function buildContextInjection(
  suffix: string,
  data: Record<string, unknown>,
): Pick<
  ContextInjectionEntry,
  'source' | 'slot' | 'label' | 'role' | 'targetIndex' | 'deltaCount' | 'payload'
> {
  const role =
    typeof data.role === 'string' ? (data.role as ContextInjectionEntry['role']) : undefined;
  const targetIndex = typeof data.targetIndex === 'number' ? data.targetIndex : undefined;
  const deltaCount =
    data.deltaCount && typeof data.deltaCount === 'object'
      ? (data.deltaCount as Record<string, number | boolean>)
      : undefined;
  const enriched = {
    ...(role !== undefined && { role }),
    ...(targetIndex !== undefined && { targetIndex }),
    ...(deltaCount !== undefined && { deltaCount }),
    payload: data,
  };

  switch (suffix) {
    case 'rag.chunks': {
      const chunkCount = numberOr(data.chunkCount, 0);
      const topScore = typeof data.topScore === 'number' ? data.topScore : undefined;
      const label =
        chunkCount > 0
          ? `${chunkCount} chunk${chunkCount === 1 ? '' : 's'}${
              topScore !== undefined ? ` · top ${topScore.toFixed(2)}` : ''
            }`
          : '0 chunks';
      return { source: 'rag', slot: 'messages', label, ...enriched };
    }
    case 'skill.activated': {
      const skillId = stringOr(data.skillId, 'skill');
      return { source: 'skill', slot: 'system-prompt', label: skillId, ...enriched };
    }
    case 'memory.injected': {
      const count = numberOr(data.count, 0);
      const label = count > 0 ? `memory · ${count} msg${count === 1 ? '' : 's'}` : 'memory';
      return { source: 'memory', slot: 'messages', label, ...enriched };
    }
    case 'instructions.fired': {
      const count = numberOr(
        data.count,
        Array.isArray(data.ids) ? (data.ids as unknown[]).length : 1,
      );
      const label = `${count} instruction${count === 1 ? '' : 's'}`;
      return { source: 'instructions', slot: 'system-prompt', label, ...enriched };
    }
    default:
      return {
        source: suffix.split('.')[0] || 'context',
        slot: 'messages',
        label: suffix,
        ...enriched,
      };
  }
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}
function maybeUsage(u: unknown): { inputTokens?: number; outputTokens?: number } {
  if (!u || typeof u !== 'object') return {};
  const x = u as Record<string, unknown>;
  const out: { inputTokens?: number; outputTokens?: number } = {};
  if (typeof x.inputTokens === 'number') out.inputTokens = x.inputTokens;
  if (typeof x.outputTokens === 'number') out.outputTokens = x.outputTokens;
  return out;
}

// ── Fold: TimelineEntry[] → AgentTimeline ─────────────────────────────
//
// Pure function lives outside the class so it's trivially unit-testable
// (feed an array, get a timeline) and so the recorder stays focused on
// the storage + translation responsibility.

interface MutableTurn {
  index: number;
  userPrompt: string;
  iterations: MutableIteration[];
  finalContent: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
}
interface MutableIteration {
  index: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  stopReason?: string;
  assistantContent: string;
  toolCalls: MutableTool[];
  decisionAtStart: Record<string, unknown>;
  visibleTools: string[];
  messagesSentCount: number;
  contextInjections: AgentContextInjection[];
}
interface MutableTool {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  error?: boolean;
  iterationIndex: number;
  turnIndex: number;
  durationMs?: number;
}

function foldCore(
  entries: readonly TimelineEntry[],
  agent: AgentInfo,
  deriveSubs: boolean,
): AgentTimeline {
  const turns: MutableTurn[] = [];
  const messages: AgentMessage[] = [];
  const toolByCallId = new Map<string, MutableTool>();
  let pendingPreIterInjections: AgentContextInjection[] = [];

  let currentTurn: MutableTurn | null = null;
  let currentIter: MutableIteration | null = null;

  for (const entry of entries) {
    switch (entry.type) {
      case 'turn_start': {
        currentTurn = {
          index: turns.length,
          userPrompt: entry.userMessage,
          iterations: [],
          finalContent: '',
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalDurationMs: 0,
        };
        turns.push(currentTurn);
        if (entry.userMessage) {
          messages.push({ role: 'user', content: entry.userMessage });
        }
        pendingPreIterInjections = [];
        currentIter = null;
        break;
      }
      case 'llm_start': {
        if (!currentTurn) continue;
        currentIter = {
          index: entry.iteration,
          assistantContent: '',
          toolCalls: [],
          decisionAtStart: {},
          visibleTools: [],
          messagesSentCount: messages.length,
          contextInjections: pendingPreIterInjections,
        };
        pendingPreIterInjections = [];
        currentTurn.iterations.push(currentIter);
        break;
      }
      case 'llm_end': {
        if (!currentIter || !currentTurn) continue;
        currentIter.assistantContent = entry.content;
        if (entry.model !== undefined) currentIter.model = entry.model;
        if (entry.inputTokens !== undefined) {
          currentIter.inputTokens = entry.inputTokens;
          currentTurn.totalInputTokens += entry.inputTokens;
        }
        if (entry.outputTokens !== undefined) {
          currentIter.outputTokens = entry.outputTokens;
          currentTurn.totalOutputTokens += entry.outputTokens;
        }
        if (entry.stopReason !== undefined) currentIter.stopReason = entry.stopReason;
        if (entry.durationMs !== undefined) {
          currentIter.durationMs = entry.durationMs;
          currentTurn.totalDurationMs += entry.durationMs;
        }
        if (entry.content) {
          messages.push({ role: 'assistant', content: entry.content });
        }
        if (entry.toolCallCount === 0) {
          currentTurn.finalContent = entry.content;
        }
        // currentIter STAYS bound — tool_start fires AFTER llm_end and
        // belongs to this iteration. The phase flag in the recorder
        // tracks llm-active separately for context routing.
        break;
      }
      case 'tool_start': {
        if (!currentIter || !currentTurn) continue;
        const tool: MutableTool = {
          id: entry.toolCallId || `tool-${currentIter.toolCalls.length}`,
          name: entry.toolName,
          arguments: entry.args,
          result: '',
          iterationIndex: currentIter.index,
          turnIndex: currentTurn.index,
        };
        currentIter.toolCalls.push(tool);
        toolByCallId.set(tool.id, tool);
        break;
      }
      case 'tool_end': {
        const tool = toolByCallId.get(entry.toolCallId);
        if (!tool) continue;
        tool.result = entry.result;
        if (entry.error === true) tool.error = true;
        if (entry.durationMs !== undefined) tool.durationMs = entry.durationMs;
        messages.push({ role: 'tool', content: entry.result, toolCallId: tool.id });
        break;
      }
      case 'context_injection': {
        if (!currentTurn) continue;
        const injection: AgentContextInjection = {
          source: entry.source,
          slot: entry.slot,
          label: entry.label,
          ...(entry.role !== undefined && { role: entry.role }),
          ...(entry.targetIndex !== undefined && { targetIndex: entry.targetIndex }),
          ...(entry.deltaCount !== undefined && { deltaCount: entry.deltaCount }),
          payload: entry.payload,
        };
        if (entry.attachedToCurrentIter && currentIter) {
          currentIter.contextInjections.push(injection);
        } else {
          pendingPreIterInjections.push(injection);
        }
        break;
      }
      case 'turn_end': {
        if (!currentTurn) continue;
        if (entry.finalContent && !currentTurn.finalContent) {
          currentTurn.finalContent = entry.finalContent;
        }
        currentTurn = null;
        currentIter = null;
        break;
      }
    }
  }

  // Freeze + derive turn-level fields
  const allTools: AgentToolInvocation[] = [];
  const frozenTurns: AgentTurn[] = turns.map((t) => {
    const turnInjections: AgentContextInjection[] = [];
    const turnLedger: Record<string, number | boolean> = {};
    const iterations: AgentIteration[] = t.iterations.map((i) => {
      const tcs = i.toolCalls.map((tc) => ({ ...tc } as AgentToolInvocation));
      allTools.push(...tcs);
      const contextInjections = [...i.contextInjections];
      const contextLedger: Record<string, number | boolean> = {};
      for (const ci of contextInjections) {
        if (!ci.deltaCount) continue;
        for (const [key, val] of Object.entries(ci.deltaCount)) {
          if (typeof val === 'number') {
            const prev =
              typeof contextLedger[key] === 'number' ? (contextLedger[key] as number) : 0;
            contextLedger[key] = prev + val;
            const prevTurn = typeof turnLedger[key] === 'number' ? (turnLedger[key] as number) : 0;
            turnLedger[key] = prevTurn + val;
          } else if (typeof val === 'boolean') {
            contextLedger[key] = contextLedger[key] === true || val;
            turnLedger[key] = turnLedger[key] === true || val;
          }
        }
      }
      turnInjections.push(...contextInjections);
      return {
        ...i,
        toolCalls: tcs,
        contextInjections,
        contextLedger,
      } as AgentIteration;
    });
    return {
      ...t,
      iterations,
      contextInjections: turnInjections,
      contextLedger: turnLedger,
    } as AgentTurn;
  });

  return {
    agent,
    turns: frozenTurns,
    messages: [...messages],
    tools: allTools,
    finalDecision: {},
    // `subAgents` is the multi-agent dimension. When the caller is
    // `foldEntries` (the public path), we derive it. When the caller
    // is `deriveSubAgents` (already inside a sub-agent fold), we don't
    // recurse — passing `deriveSubs: false` short-circuits the recursion.
    subAgents: deriveSubs ? deriveSubAgents(entries) : [],
  };
}

function foldEntries(entries: readonly TimelineEntry[], agent: AgentInfo): AgentTimeline {
  return foldCore(entries, agent, true);
}

/**
 * Group timeline entries by their `subflowPath[0]` (the top-level
 * sub-agent name) and fold each group into its own SubAgentTimeline.
 *
 * Single-agent runs have `subflowPath = []` on every event → produces
 * empty array (UIs render single container).
 *
 * Multi-agent runs (Pipeline / Swarm) — events from each sub-agent
 * fire with `subflowPath = ["classify"]`, `["analyze"]`, etc. — one
 * SubAgentTimeline per distinct first segment.
 *
 * Each sub-agent slice is its own self-contained timeline (re-folded
 * from the subset of entries belonging to it). The OUTER timeline
 * still contains everything; sub-agents are an additional view, not
 * a replacement.
 */
function deriveSubAgents(entries: readonly TimelineEntry[]): SubAgentTimeline[] {
  // Group by subflowPath[0]. Skip entries with empty subflowPath
  // (those belong to the root parent agent, not a sub-agent).
  const bySubAgent = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const subAgentId = entry.subflowPath[0];
    if (!subAgentId) continue;
    const arr = bySubAgent.get(subAgentId) ?? [];
    arr.push(entry);
    bySubAgent.set(subAgentId, arr);
  }
  if (bySubAgent.size === 0) return [];

  // Find the parent's user message — sub-agent slices don't get their
  // own turn_start (the parent owns the conversation), but the fold
  // requires one to initialize `currentTurn`. Synthesize one prepended
  // to each sub-agent's entries so the fold has a turn anchor.
  const parentTurnStart = entries.find((e) => e.type === 'turn_start');
  const parentUserMessage =
    parentTurnStart?.type === 'turn_start' ? parentTurnStart.userMessage : '';

  // Fold each group with `deriveSubs=false` to short-circuit recursion.
  // Sub-agents inherit the subflow id as their name — upstream wiring
  // (Agent.create({ name }) on sub-agents) can carry the real human
  // name through future enhancements.
  const out: SubAgentTimeline[] = [];
  for (const [id, subEntries] of bySubAgent) {
    const synthTurnStart: TimelineEntry = {
      type: 'turn_start',
      runtimeStageId: `synth:turn_start:${id}`,
      timestamp: subEntries[0]?.timestamp ?? Date.now(),
      subflowPath: [id],
      userMessage: parentUserMessage,
    };
    const subTimeline = foldCore([synthTurnStart, ...subEntries], { id, name: id }, false);
    out.push({
      id,
      name: id,
      turns: subTimeline.turns,
      tools: subTimeline.tools,
    });
  }
  return out;
}
