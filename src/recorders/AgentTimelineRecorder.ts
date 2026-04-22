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
 * // v2 API — call selectors, not a pre-shaped bundle
 * t.selectTurns();         // AgentTurn[] — iterations with tool calls + context
 * t.selectActivities();    // Activity[] — humanized breadcrumb list (ThinkKit)
 * t.selectStatus();        // StatusLine — typing-bubble one-liner
 * t.selectCommentary();    // CommentaryLine[] — human narrative per event
 * t.selectTopology();      // Topology — composition graph for flowchart view
 * t.selectRunSummary();    // RunSummary — tokens, tools, duration totals
 * t.setHumanizer({ describeToolStart: ... });  // swap domain phrasings
 * ```
 *
 * Multi-agent: each sub-agent in a Pipeline/Swarm gets its own named
 * instance — `agentTimeline({ id: 'classify' })` — and each lands in
 * its own `executor.getSnapshot().recorders[id]` slot. Multi-agent
 * shells aggregate them by id.
 */

import type {
  EmitEvent,
  EmitRecorder,
  FlowDecisionEvent,
  FlowForkEvent,
  FlowLoopEvent,
  FlowRecorder,
  FlowSubflowEvent,
} from 'footprintjs';
import type { Topology } from 'footprintjs/trace';
import { SequenceRecorder, TopologyRecorder } from 'footprintjs/trace';

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

// ── Selector return types (v2: event stream + selectors + humanizer) ───

/**
 * A compact, human-readable activity entry for "what is the agent doing"
 * UI surfaces (ThinkKit-style chat bubbles, typing indicators, breadcrumb
 * progress lists). Produced by `selectActivities()` via an event-reduction
 * state machine + the current humanizer.
 */
export interface Activity {
  readonly id: string;
  /** Human-readable, humanized label. Already phrased by the humanizer. */
  readonly label: string;
  readonly done: boolean;
  /** Short follow-up info — "2 steps to run", "Got the result" — phrased
   *  by the humanizer. Optional. */
  readonly meta?: string;
  /** Which event type produced this activity. Consumers can filter/style. */
  readonly kind: 'llm' | 'tool' | 'turn';
  /** Source event's runtimeStageId for correlation / scrubbing. */
  readonly runtimeStageId?: string;
  /** Per-iteration tag (for `llm` + `tool` kinds). 1-based within a turn. */
  readonly iterationIndex?: number;
}

/**
 * Single-line status suitable for a typing bubble or "now running…" pill.
 * Always reflects the most recent event at the given cursor.
 */
export interface StatusLine {
  readonly text: string;
  readonly kind: 'llm' | 'tool' | 'turn' | 'idle';
  /** Index into the event stream when this status was observed. */
  readonly eventIndex: number;
}

/**
 * One human-readable line in the run's commentary — the analyst view.
 * Differs from Activity in that it's PURE narrative (not tied to in-flight
 * vs. done state). One CommentaryLine per significant event.
 */
export interface CommentaryLine {
  readonly text: string;
  readonly kind: 'llm' | 'tool' | 'turn' | 'context';
  readonly runtimeStageId?: string;
  readonly timestamp: number;
}

/**
 * Per-slot injection summary — what each Agent API slot received and from
 * which source. Powers slot-row badges on the flowchart ("Messages +3 from
 * RAG · +5 from memory") and the analyst Commentary panel.
 *
 * Shape:
 *   slots[]             — one entry per system-prompt / messages / tools slot
 *   slots[].sources[]   — per-source group within that slot (rag / skill / memory / ...)
 *   slots[].totalInjections — all injections into this slot (all sources summed)
 *   aggregatedLedger    — deltaCount values summed across all slots + sources
 */
export interface ContextBySource {
  readonly slots: readonly ContextSlotSummary[];
  readonly aggregatedLedger: Readonly<Record<string, number | boolean>>;
}

export interface ContextSlotSummary {
  readonly slot: 'system-prompt' | 'messages' | 'tools';
  readonly sources: readonly ContextSourceSummary[];
  readonly totalInjections: number;
}

export interface ContextSourceSummary {
  readonly source: string;
  readonly count: number;
  readonly deltaCount: Readonly<Record<string, number | boolean>>;
  readonly labels: readonly string[];
}

/** Numeric totals over the entire run — for dashboards & headers. */
export interface RunSummary {
  readonly turnCount: number;
  readonly iterationCount: number;
  readonly toolCallCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalDurationMs: number;
  readonly toolUsage: Readonly<Record<string, { count: number; totalDurationMs: number }>>;
  readonly skillsActivated: readonly string[];
}

/**
 * Index of iteration ↔ event-stream position. Scrubbers and time-travel
 * sliders read this to map a slider cursor to an iteration (or vice versa)
 * in O(1) without re-walking events.
 */
export interface IterationRangeIndex {
  /** One entry per iteration in order. Each entry's `firstEventIndex` /
   *  `lastEventIndex` delimits the events belonging to that iteration. */
  readonly iterations: readonly IterationRange[];
  /** `eventIndex → iteration index` lookup. Dense array. */
  readonly byEventIndex: readonly number[];
}

export interface IterationRange {
  readonly turnIndex: number;
  readonly iterationIndex: number;
  readonly firstEventIndex: number;
  readonly lastEventIndex: number;
  readonly runtimeStageId?: string;
}

/**
 * Pluggable humanizer — produces human-readable strings for activities,
 * statuses, and commentary. Library provides a default (generic phrasings
 * like "Running ${toolName}"); domain apps override per-tool for friendlier
 * phrasings (e.g., NEO's "Checking port status on switch-3").
 *
 * Each method returns `string` to supply a phrase, or `undefined` to fall
 * through to the library default. Supplying an empty string means "don't
 * render" (Activity/CommentaryLine will be skipped).
 */
export interface Humanizer {
  describeTurnStart?(event: { userMessage: string }): string | undefined;
  describeTurnEnd?(event: { finalContent?: string }): string | undefined;
  describeLLMStart?(event: { iteration: number }): string | undefined;
  describeLLMEnd?(event: {
    toolCallCount: number;
    inputTokens?: number;
    outputTokens?: number;
    stopReason?: string;
  }): string | undefined;
  describeToolStart?(event: {
    toolName: string;
    args: Record<string, unknown>;
  }): string | undefined;
  describeToolEnd?(event: {
    toolName: string;
    result: string;
    error?: boolean;
  }): string | undefined;
  describeContextInjection?(event: {
    source: string;
    slot: string;
    label: string;
  }): string | undefined;
}

/**
 * The structured event stream — the single source of truth. Every selector
 * derives from this. Exported so low-level consumers (custom renderers,
 * debug bundles, replay tools) can read the canonical shape directly.
 *
 * Discriminated by `type`. No rendered strings — strings appear only at
 * selector time after the humanizer runs.
 */
export type AgentEvent = TimelineEntry;

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

/**
 * AgentTimelineRecorder v2 — event stream + selectors + humanizer.
 *
 * THE ARCHITECTURE (one shape, many renderers):
 *
 *   EVENT STREAM              (structured, canonical — single source of truth)
 *       ↓
 *   SELECTORS                 (typed, memoized, lazy, composable — THE API)
 *       ↓
 *   VIEWS                     (React / Vue / Angular / CLI / Grafana / replay)
 *
 * Consumers never reshape data themselves — they call selectors. New
 * renderer view? Add a selector. Never add pre-computed fields to some
 * timeline blob (that's the anti-pattern this design replaces).
 *
 * OBSERVER CHANNELS (from footprintjs):
 *
 *   1. EmitRecorder       — `agentfootprint.stream.*` / `.context.*`
 *                           events translate into the `AgentEvent` stream.
 *   2. FlowRecorder       — subflow / fork / decision / loop events
 *                           forwarded to a composed `TopologyRecorder`.
 *   3. SequenceRecorder<AgentEvent> base — storage + O(1) per-step lookup.
 *
 * Footprintjs's `attachCombinedRecorder` detects which methods this
 * recorder implements and routes events accordingly. Consumers attach
 * once; all three channels wire up automatically.
 *
 * HUMANIZATION: swap `setHumanizer(custom)` to override generic phrasings
 * ("Running toolName") with domain-specific strings ("Checking port status
 * on switch-3"). The library NEVER bakes rendered strings into events —
 * they appear only at selector time, through the humanizer, so translation,
 * localization, and UX tone changes don't require data-model changes.
 */
export class AgentTimelineRecorder
  extends SequenceRecorder<AgentEvent>
  implements EmitRecorder, FlowRecorder
{
  readonly id: string;
  readonly name: string;

  /** True between an iter's llm_start and llm_end. Drives context-event
   *  routing (THIS iter vs NEXT iter). */
  private llmPhaseActive = false;

  /** Composed topology accumulator — selectors use this for subflow/
   *  fork/decision queries. Private; consumers query via `selectTopology()`. */
  private readonly topology: TopologyRecorder;

  /** Active humanizer. Starts as the default; consumer swaps via
   *  `setHumanizer`. */
  private humanizer: Humanizer = {};

  /**
   * Memoization version — incremented on every `emit()` and `clear()`.
   * Selector results are keyed by `(selectorName, version, cursor)`. A
   * long run renders many frames without recomputing unchanged views.
   */
  private version = 0;
  private readonly cache = new Map<string, unknown>();

  constructor(options?: AgentTimelineRecorderOptions) {
    super();
    this.id = options?.id ?? 'agentfootprint-agent-timeline';
    this.name = options?.name ?? 'Agent';
    this.topology = new TopologyRecorder({ id: `${this.id}-topology` });
  }

  // ── EmitRecorder ─────────────────────────────────────────────────────

  /**
   * Translate the incoming emit event into an `AgentEvent` and append to
   * the stream. Events not in the agent shape are silently dropped —
   * executors deliver events from many subsystems.
   */
  onEmit(event: EmitEvent): void {
    const entry = translate(event, this.llmPhaseActive);
    if (!entry) return;
    if (entry.type === 'llm_start') this.llmPhaseActive = true;
    if (entry.type === 'llm_end' || entry.type === 'turn_end') {
      this.llmPhaseActive = false;
    }
    this.emit(entry);
    this.bumpVersion();
  }

  // ── FlowRecorder hooks (forward to composed TopologyRecorder) ────────

  onSubflowEntry(event: FlowSubflowEvent): void {
    this.topology.onSubflowEntry(event);
    this.bumpVersion();
  }

  onSubflowExit(event: FlowSubflowEvent): void {
    this.topology.onSubflowExit(event);
    this.bumpVersion();
  }

  onFork(event: FlowForkEvent): void {
    this.topology.onFork(event);
    this.bumpVersion();
  }

  onDecision(event: FlowDecisionEvent): void {
    this.topology.onDecision(event);
    this.bumpVersion();
  }

  onLoop(event: FlowLoopEvent): void {
    this.topology.onLoop(event);
    this.bumpVersion();
  }

  override clear(): void {
    super.clear();
    this.llmPhaseActive = false;
    this.topology.clear();
    this.bumpVersion();
  }

  // ── Raw event-stream access ──────────────────────────────────────────

  /** The canonical event stream. Most consumers call selectors instead;
   *  this is for low-level tools (custom renderers, debug bundles). */
  getEvents(): readonly AgentEvent[] {
    return this.getEntries();
  }

  /** Direct access to the composed topology recorder for consumers that
   *  need the full composition graph (fork-branches, decision-branches,
   *  edges). Equivalent for rendering: use `selectTopology()`. */
  getTopology(): TopologyRecorder {
    return this.topology;
  }

  // ── Humanizer ────────────────────────────────────────────────────────

  /** Override or replace the active humanizer. Invalidates memoized
   *  selector results so the next read re-phrases. */
  setHumanizer(humanizer: Humanizer): void {
    this.humanizer = humanizer;
    this.bumpVersion();
  }

  /** Returns the currently-active humanizer (consumer-supplied). */
  getHumanizer(): Humanizer {
    return this.humanizer;
  }

  // ── Selectors (memoized, lazy, the API) ──────────────────────────────

  /** Agent identity — { id, name } from constructor options. */
  selectAgent(): AgentInfo {
    return { id: this.id, name: this.name };
  }

  /** All turns with their iterations, tool calls, context injections. */
  selectTurns(): readonly AgentTurn[] {
    return this.memo('turns', () => foldTurns(this.getEvents()));
  }

  /** Message list mirroring `sharedState.messages` (reconstructed from
   *  `turn_start.userMessage` + `llm_end.content` + assistant tool calls
   *  + `tool_end.result`). */
  selectMessages(): readonly AgentMessage[] {
    return this.memo('messages', () => foldMessages(this.getEvents()));
  }

  /** All tool invocations across all turns, in chronological order. */
  selectTools(): readonly AgentToolInvocation[] {
    return this.memo('tools', () => foldTools(this.getEvents()));
  }

  /** Sub-agent slices for multi-agent runs. Identity from the composed
   *  topology's subflow nodes; per-sub-agent content (turns, tools) folded
   *  from emit events tagged with matching `subflowPath[0]`. Empty for
   *  single-agent runs. */
  selectSubAgents(): readonly SubAgentTimeline[] {
    return this.memo('subAgents', () => deriveSubAgentSlices(this.getEvents(), this.topology));
  }

  /** Final decision object captured from `agentfootprint.agent.turn_complete`. */
  selectFinalDecision(): Record<string, unknown> {
    return this.memo('finalDecision', () => foldFinalDecision(this.getEvents()));
  }

  /** Composition graph snapshot. Renderers use `nodes`/`edges` for layout. */
  selectTopology(): Topology {
    // Topology has its own internal state; snapshot once per query.
    return this.topology.getTopology();
  }

  /** Event-reduced activity list for status/progress renderers (ThinkKit).
   *  Humanized labels. Optional cursor: only include events up to that
   *  index (progressive reveal / time-travel scrubbing). */
  selectActivities(cursor?: number): readonly Activity[] {
    const key = cursor === undefined ? 'activities:all' : `activities:${cursor}`;
    return this.memo(key, () => reduceActivities(this.getEvents(), this.humanizer, cursor));
  }

  /** Single-line current status — for typing bubbles / "now running…" pills.
   *  Cursor defaults to the latest event. */
  selectStatus(cursor?: number): StatusLine {
    const key = cursor === undefined ? 'status:latest' : `status:${cursor}`;
    return this.memo(key, () => deriveStatus(this.getEvents(), this.humanizer, cursor));
  }

  /** Human-readable narrative — one line per significant event. For
   *  analyst-style commentary panels. Humanized. */
  selectCommentary(cursor?: number): readonly CommentaryLine[] {
    const key = cursor === undefined ? 'commentary:all' : `commentary:${cursor}`;
    return this.memo(key, () => buildCommentary(this.getEvents(), this.humanizer, cursor));
  }

  /** Numeric totals — turn count, token usage, duration, tool usage. */
  selectRunSummary(): RunSummary {
    return this.memo('runSummary', () => computeRunSummary(this.getEvents()));
  }

  /** Context-engineering injection summary — per slot, grouped by source
   *  (rag / skill / memory / instructions / custom). Powers slot-row badges
   *  on the flowchart AND the analyst Commentary panel. Cursor-aware:
   *  pass an event index to see injections up to that point. */
  selectContextBySource(cursor?: number): ContextBySource {
    const key = cursor === undefined ? 'contextBySource:all' : `contextBySource:${cursor}`;
    return this.memo(key, () => computeContextBySource(this.getEvents(), cursor));
  }

  /** Iteration ↔ event-stream index map for scrubbers / time-travel. */
  selectIterationRanges(): IterationRangeIndex {
    return this.memo('iterationRanges', () => computeIterationRanges(this.getEvents()));
  }

  // ── Internals ────────────────────────────────────────────────────────

  private bumpVersion(): void {
    this.version++;
    this.cache.clear();
  }

  private memo<T>(key: string, compute: () => T): T {
    const cacheKey = `${key}@${this.version}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached as T;
    const value = compute();
    this.cache.set(cacheKey, value);
    return value;
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

/** Internal bundle produced by `foldCore`. Selectors extract slices.
 *  Not exported — consumers use the individual `select*` methods. */
interface FoldedBundle {
  readonly turns: readonly AgentTurn[];
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly AgentToolInvocation[];
  readonly finalDecision: Record<string, unknown>;
}

function foldCore(entries: readonly TimelineEntry[]): FoldedBundle {
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
        // Synthesize a turn anchor if none exists. Real executors call
        // recorder.clear() at run-start, wiping any turn_start that
        // arrived via observe() BEFORE run. Rather than forcing every
        // caller to emit turn_start on the emit channel, we recover
        // here: first llm_start without a turn creates a synthetic one.
        if (!currentTurn) {
          currentTurn = {
            index: turns.length,
            userPrompt: '',
            iterations: [],
            finalContent: '',
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalDurationMs: 0,
          };
          turns.push(currentTurn);
        }
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
    turns: frozenTurns,
    messages: [...messages],
    tools: allTools,
    finalDecision: {},
  };
}

// ── Slice helpers — used by selectors ─────────────────────────────────

/**
 * Multi-agent slices: the topology supplies sub-agent identity (id, name);
 * per-sub-agent content (turns, tools) is folded from emit events whose
 * `subflowPath[0]` matches the node's id. Both sources come from the same
 * executor traversal — topology via FlowRecorder events, subflowPath via
 * emit-event metadata — but it's the recorder's job to stitch them.
 *
 * For sub-agents that have no matching emit events (e.g. a plain-stage
 * fork child), turns/tools are empty arrays.
 */
/**
 * An Agent's signature — the set of API-slot subflows every Agent
 * mounts via `buildAgentLoop`. A topology subflow that CONTAINS any of
 * these as a child is an Agent wrapper (and therefore a sub-agent when
 * nested inside a composition runner). Subflows that ARE one of these
 * slots themselves, or other leaf subflows not containing a slot, are
 * internal structure — not sub-agents.
 *
 * This heuristic replaces a hardcoded deny-list. Robust against new
 * internal-agent subflows added later (they'll auto-classify as
 * "internal" because they don't wrap slots).
 */
const AGENT_SLOT_SUBFLOW_IDS: ReadonlySet<string> = new Set([
  'sf-system-prompt',
  'sf-messages',
  'sf-tools',
]);

/** TopologyRecorder disambiguates re-entered subflows with a `#n`
 *  suffix. Strip that suffix so a re-entered slot still matches the
 *  signature set. */
function baseSubflowId(id: string): string {
  const hashIdx = id.indexOf('#');
  return hashIdx === -1 ? id : id.slice(0, hashIdx);
}

function isAgentWrapper(nodeId: string, topology: TopologyRecorder): boolean {
  // A sub-agent is a subflow whose descendants in the topology tree
  // include at least one of the API-slot signature subflows.
  const stack = [...topology.getChildren(nodeId)];
  while (stack.length > 0) {
    const child = stack.pop()!;
    if (AGENT_SLOT_SUBFLOW_IDS.has(baseSubflowId(child.id))) return true;
    stack.push(...topology.getChildren(child.id));
  }
  return false;
}

function deriveSubAgentSlices(
  events: readonly AgentEvent[],
  topology: TopologyRecorder,
): readonly SubAgentTimeline[] {
  const allNodes = topology.getSubflowNodes();
  // Keep only subflows that WRAP an Agent (have API-slot descendants).
  // In single-agent runs, the slots are top-level — nothing wraps them
  // → empty array → Lens renders the single-agent flowchart.
  // In multi-agent (Pipeline/Parallel/Swarm/Conditional), each sub-agent
  // root wraps its own slots → returned as a sub-agent.
  const nodes = allNodes.filter((n) => isAgentWrapper(n.id, topology));
  if (nodes.length === 0) return [];

  // Group events by first subflowPath segment. Keep only events whose
  // top-of-path IS one of the classified sub-agents (filter out events
  // belonging to internal-agent subflows of the root agent, which are
  // technically at subflowPath[0] in single-agent runs but aren't
  // sub-agents).
  const subAgentIds = new Set(nodes.map((n) => n.id));
  const bySubAgent = new Map<string, AgentEvent[]>();
  for (const e of events) {
    const id = e.subflowPath[0];
    if (!id || !subAgentIds.has(id)) continue;
    const arr = bySubAgent.get(id) ?? [];
    arr.push(e);
    bySubAgent.set(id, arr);
  }

  // Synthesize a turn_start so the fold has a turn anchor (sub-agents
  // inherit the parent's conversation; they don't emit their own
  // turn_start events).
  const parentTurnStart = events.find((e) => e.type === 'turn_start');
  const parentUserMessage =
    parentTurnStart?.type === 'turn_start' ? parentTurnStart.userMessage : '';

  return nodes.map((node) => {
    const subEvents = bySubAgent.get(node.id);
    if (!subEvents || subEvents.length === 0) {
      return { id: node.id, name: node.name, turns: [], tools: [] };
    }
    const synthTurnStart: AgentEvent = {
      type: 'turn_start',
      runtimeStageId: `synth:turn_start:${node.id}`,
      timestamp: subEvents[0]?.timestamp ?? Date.now(),
      subflowPath: [node.id],
      userMessage: parentUserMessage,
    };
    const bundle = foldCore([synthTurnStart, ...subEvents]);
    return { id: node.id, name: node.name, turns: bundle.turns, tools: bundle.tools };
  });
}

function foldTurns(events: readonly AgentEvent[]): readonly AgentTurn[] {
  return foldCore(events).turns;
}

function foldMessages(events: readonly AgentEvent[]): readonly AgentMessage[] {
  return foldCore(events).messages;
}

function foldTools(events: readonly AgentEvent[]): readonly AgentToolInvocation[] {
  return foldCore(events).tools;
}

function foldFinalDecision(events: readonly AgentEvent[]): Record<string, unknown> {
  return foldCore(events).finalDecision;
}

// ── Default humanizer — generic phrasings for every event kind ────────
//
// Consumer-supplied `Humanizer` overrides win. Each describeXxx returns
// a short phrase ready for Activity.label / StatusLine.text.

function defaultTurnStart(): string {
  return 'Getting started';
}
function defaultTurnEnd(): string {
  return 'Done';
}
function defaultLLMStart(): string {
  return 'Thinking';
}
function defaultLLMEnd(e: { toolCallCount: number }): string {
  return e.toolCallCount > 0
    ? `Running ${e.toolCallCount} step${e.toolCallCount === 1 ? '' : 's'}`
    : 'Writing response';
}
function defaultToolStart(e: { toolName: string }): string {
  return `Running ${e.toolName}`;
}
function defaultToolEnd(e: { error?: boolean }): string {
  return e.error ? 'Tool errored' : 'Got result';
}
function defaultContextInjection(e: { source: string; slot: string }): string {
  return `${e.source} → ${e.slot}`;
}

/** Pick the humanizer's phrasing or fall through to the default. */
function humanize<T>(custom: ((e: T) => string | undefined) | undefined, fallback: (e: T) => string, e: T): string {
  if (custom) {
    const r = custom(e);
    if (typeof r === 'string') return r;
  }
  return fallback(e);
}

// ── Activity reduction state machine ──────────────────────────────────
//
// `selectActivities()` uses this to turn the event stream into an
// ordered breadcrumb list {id, label, done, meta, kind}. The humanizer
// shapes every user-visible string.

function reduceActivities(
  events: readonly AgentEvent[],
  h: Humanizer,
  cursor?: number,
): readonly Activity[] {
  const end = cursor === undefined ? events.length : Math.min(cursor + 1, events.length);
  const out: Activity[] = [];
  const toolIdxByCallId = new Map<string, number>();
  let llmIdx: number | null = null;

  for (let i = 0; i < end; i++) {
    const e = events[i];
    switch (e.type) {
      case 'llm_start': {
        out.push({
          id: `llm-${e.iteration}-${i}`,
          label: humanize(h.describeLLMStart, defaultLLMStart, e),
          done: false,
          kind: 'llm',
          runtimeStageId: e.runtimeStageId,
          iterationIndex: e.iteration,
        });
        llmIdx = out.length - 1;
        break;
      }
      case 'llm_end': {
        if (llmIdx !== null) {
          out[llmIdx] = {
            ...out[llmIdx],
            done: true,
            meta: humanize(h.describeLLMEnd, defaultLLMEnd, e),
          };
          llmIdx = null;
        }
        break;
      }
      case 'tool_start': {
        out.push({
          id: e.toolCallId || `tool-${i}`,
          label: humanize(h.describeToolStart, defaultToolStart, e),
          done: false,
          kind: 'tool',
          runtimeStageId: e.runtimeStageId,
        });
        toolIdxByCallId.set(e.toolCallId || `tool-${i}`, out.length - 1);
        break;
      }
      case 'tool_end': {
        const idx = toolIdxByCallId.get(e.toolCallId);
        if (idx !== undefined) {
          const prev = out[idx];
          // Look up the tool name from the matching start event for the humanizer.
          const toolName = findToolNameForCallId(events, e.toolCallId) ?? '';
          out[idx] = {
            ...prev,
            done: true,
            meta: humanize(h.describeToolEnd, defaultToolEnd, {
              toolName,
              result: e.result,
              ...(e.error !== undefined ? { error: e.error } : {}),
            }),
          };
          toolIdxByCallId.delete(e.toolCallId);
        }
        break;
      }
      case 'turn_start':
      case 'turn_end':
      case 'context_injection':
      default:
        break;
    }
  }
  return out;
}

function findToolNameForCallId(events: readonly AgentEvent[], toolCallId: string): string | undefined {
  for (const e of events) {
    if (e.type === 'tool_start' && e.toolCallId === toolCallId) return e.toolName;
  }
  return undefined;
}

// ── Status one-liner ──────────────────────────────────────────────────

function deriveStatus(
  events: readonly AgentEvent[],
  h: Humanizer,
  cursor?: number,
): StatusLine {
  const end = cursor === undefined ? events.length - 1 : Math.min(cursor, events.length - 1);
  if (end < 0) {
    return { text: humanize(h.describeTurnStart, defaultTurnStart, { userMessage: '' }), kind: 'idle', eventIndex: -1 };
  }
  const e = events[end];
  switch (e.type) {
    case 'turn_start':
      return { text: humanize(h.describeTurnStart, defaultTurnStart, e), kind: 'turn', eventIndex: end };
    case 'turn_end':
      return { text: humanize(h.describeTurnEnd, defaultTurnEnd, e), kind: 'turn', eventIndex: end };
    case 'llm_start':
      return { text: humanize(h.describeLLMStart, defaultLLMStart, e), kind: 'llm', eventIndex: end };
    case 'llm_end':
      return { text: humanize(h.describeLLMEnd, defaultLLMEnd, e), kind: 'llm', eventIndex: end };
    case 'tool_start':
      return { text: humanize(h.describeToolStart, defaultToolStart, e), kind: 'tool', eventIndex: end };
    case 'tool_end': {
      const toolName = findToolNameForCallId(events, e.toolCallId) ?? '';
      return {
        text: humanize(h.describeToolEnd, defaultToolEnd, {
          toolName,
          result: e.result,
          ...(e.error !== undefined ? { error: e.error } : {}),
        }),
        kind: 'tool',
        eventIndex: end,
      };
    }
    default:
      return { text: '', kind: 'idle', eventIndex: end };
  }
}

// ── Commentary builder — one narrative line per event ─────────────────

function buildCommentary(
  events: readonly AgentEvent[],
  h: Humanizer,
  cursor?: number,
): readonly CommentaryLine[] {
  const end = cursor === undefined ? events.length : Math.min(cursor + 1, events.length);
  const out: CommentaryLine[] = [];
  for (let i = 0; i < end; i++) {
    const e = events[i];
    let text = '';
    let kind: CommentaryLine['kind'] = 'llm';
    switch (e.type) {
      case 'turn_start':
        text = humanize(h.describeTurnStart, defaultTurnStart, e);
        kind = 'turn';
        break;
      case 'turn_end':
        text = humanize(h.describeTurnEnd, defaultTurnEnd, e);
        kind = 'turn';
        break;
      case 'llm_start':
        text = humanize(h.describeLLMStart, defaultLLMStart, e);
        kind = 'llm';
        break;
      case 'llm_end':
        text = humanize(h.describeLLMEnd, defaultLLMEnd, e);
        kind = 'llm';
        break;
      case 'tool_start':
        text = humanize(h.describeToolStart, defaultToolStart, e);
        kind = 'tool';
        break;
      case 'tool_end': {
        const toolName = findToolNameForCallId(events, e.toolCallId) ?? '';
        text = humanize(h.describeToolEnd, defaultToolEnd, {
          toolName,
          result: e.result,
          ...(e.error !== undefined ? { error: e.error } : {}),
        });
        kind = 'tool';
        break;
      }
      case 'context_injection':
        text = humanize(h.describeContextInjection, defaultContextInjection, e);
        kind = 'context';
        break;
    }
    if (text === '') continue;
    out.push({
      text,
      kind,
      ...(e.runtimeStageId !== undefined ? { runtimeStageId: e.runtimeStageId } : {}),
      timestamp: e.timestamp,
    });
  }
  return out;
}

// ── Run summary totals ────────────────────────────────────────────────

function computeRunSummary(events: readonly AgentEvent[]): RunSummary {
  let turnCount = 0;
  let iterationCount = 0;
  let toolCallCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalDurationMs = 0;
  const toolUsage = new Map<string, { count: number; totalDurationMs: number }>();
  const skillsActivated = new Set<string>();
  const toolStarts = new Map<string, string>(); // toolCallId → toolName

  for (const e of events) {
    switch (e.type) {
      case 'turn_start':
        turnCount++;
        break;
      case 'llm_start':
        iterationCount++;
        break;
      case 'llm_end':
        if (e.inputTokens !== undefined) inputTokens += e.inputTokens;
        if (e.outputTokens !== undefined) outputTokens += e.outputTokens;
        if (e.durationMs !== undefined) totalDurationMs += e.durationMs;
        break;
      case 'tool_start':
        toolCallCount++;
        toolStarts.set(e.toolCallId, e.toolName);
        if (e.toolName === 'read_skill' && typeof e.args.id === 'string') {
          skillsActivated.add(e.args.id);
        }
        break;
      case 'tool_end': {
        const name = toolStarts.get(e.toolCallId);
        if (!name) break;
        const prev = toolUsage.get(name) ?? { count: 0, totalDurationMs: 0 };
        toolUsage.set(name, {
          count: prev.count + 1,
          totalDurationMs: prev.totalDurationMs + (e.durationMs ?? 0),
        });
        break;
      }
    }
  }

  return {
    turnCount,
    iterationCount,
    toolCallCount,
    inputTokens,
    outputTokens,
    totalDurationMs,
    toolUsage: Object.fromEntries(toolUsage),
    skillsActivated: [...skillsActivated],
  };
}

// ── Context-engineering summary ───────────────────────────────────────

function computeContextBySource(events: readonly AgentEvent[], cursor?: number): ContextBySource {
  const end = cursor === undefined ? events.length : Math.min(cursor + 1, events.length);
  const slotOrder: Array<ContextSlotSummary['slot']> = ['system-prompt', 'messages', 'tools'];
  const slotBuckets = new Map<
    ContextSlotSummary['slot'],
    Map<string, { count: number; deltaCount: Record<string, number | boolean>; labels: string[] }>
  >();
  const aggregatedLedger: Record<string, number | boolean> = {};

  for (const slot of slotOrder) slotBuckets.set(slot, new Map());

  for (let i = 0; i < end; i++) {
    const e = events[i];
    if (e.type !== 'context_injection') continue;
    const slot = e.slot;
    const bucket = slotBuckets.get(slot);
    if (!bucket) continue;
    const group = bucket.get(e.source) ?? { count: 0, deltaCount: {}, labels: [] };
    group.count += 1;
    group.labels.push(e.label);
    if (e.deltaCount) {
      for (const [k, v] of Object.entries(e.deltaCount)) {
        if (typeof v === 'number') {
          group.deltaCount[k] = ((group.deltaCount[k] as number | undefined) ?? 0) + v;
          aggregatedLedger[k] = ((aggregatedLedger[k] as number | undefined) ?? 0) + v;
        } else if (typeof v === 'boolean') {
          // Boolean flags: true wins (indicates feature was active at least once).
          group.deltaCount[k] = (group.deltaCount[k] as boolean | undefined) || v;
          aggregatedLedger[k] = (aggregatedLedger[k] as boolean | undefined) || v;
        }
      }
    }
    bucket.set(e.source, group);
  }

  const slots: ContextSlotSummary[] = slotOrder.map((slot) => {
    const bucket = slotBuckets.get(slot)!;
    const sources: ContextSourceSummary[] = [];
    let totalInjections = 0;
    for (const [source, group] of bucket) {
      sources.push({ source, count: group.count, deltaCount: group.deltaCount, labels: group.labels });
      totalInjections += group.count;
    }
    return { slot, sources, totalInjections };
  });

  return { slots, aggregatedLedger };
}

// ── Iteration ↔ event-stream range index ──────────────────────────────

function computeIterationRanges(events: readonly AgentEvent[]): IterationRangeIndex {
  const iterations: IterationRange[] = [];
  const byEventIndex: number[] = [];
  let turnIndex = -1;
  let currentIterStart = -1;
  let currentIter: number | null = null;

  const flushCurrent = (endIdx: number) => {
    if (currentIter === null || currentIterStart < 0) return;
    iterations.push({
      turnIndex,
      iterationIndex: currentIter,
      firstEventIndex: currentIterStart,
      lastEventIndex: endIdx,
      ...(events[currentIterStart]?.runtimeStageId !== undefined
        ? { runtimeStageId: events[currentIterStart].runtimeStageId }
        : {}),
    });
    for (let i = currentIterStart; i <= endIdx; i++) byEventIndex[i] = iterations.length - 1;
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'turn_start') {
      flushCurrent(i - 1);
      currentIter = null;
      currentIterStart = -1;
      turnIndex++;
      byEventIndex[i] = iterations.length; // belongs to the next iteration slot
      continue;
    }
    if (e.type === 'llm_start') {
      flushCurrent(i - 1);
      currentIter = e.iteration;
      currentIterStart = i;
    }
    byEventIndex[i] = iterations.length; // pending iteration
  }
  flushCurrent(events.length - 1);

  return { iterations, byEventIndex };
}
