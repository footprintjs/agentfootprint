/**
 * Causal memory — types.
 *
 * A `SnapshotEntry` is the value stored in a Causal `MemoryStore`. It
 * captures one agent run's "what happened and why" so future turns can
 * answer follow-up questions ("why did you reject this?") with EXACT
 * past facts instead of LLM reconstruction.
 *
 * Differentiator: footprintjs's `decide()`/`select()` already capture
 * decision evidence as first-class events during traversal — we just
 * persist them. Other libraries can't do this without rebuilding their
 * core to surface decision evidence.
 *
 * Stored as `MemoryEntry<SnapshotEntry>` so the existing store layer
 * (`MemoryStore`, `InMemoryStore`, future Redis/Dynamo/Postgres
 * adapters) handles persistence + identity isolation + TTL + vector
 * search out of the box.
 */

import type { LLMMessage } from '../../adapters/types.js';

/**
 * One stored agent run — the unit of causal memory.
 *
 * Decisions, tool calls, iterations, and token usage are harvested DURING the run
 * by `causalEvidenceRecorder` (the evidence bridge) and persisted here — the Agent
 * attaches it automatically whenever a CAUSAL memory is mounted. Still deferred: the
 * FULL `commitLog` + narrative entries with depth/path, which land only when an
 * out-of-band recorder integrates `executor.getSnapshot()` directly. Consequence: a
 * persisted snapshot answers "why?" from the recorded DOMAIN evidence (decisions /
 * tool calls), but cannot yet rehydrate the trace-toolpack tools for cross-restart
 * step-by-step navigation — use `.selfExplain()` for in-conversation deep traces.
 */
export interface SnapshotEntry {
  /**
   * The user's message at the time of the run. THIS IS WHAT GETS
   * EMBEDDED for retrieval — new queries are matched by cosine
   * similarity against past queries.
   */
  readonly query: string;

  /**
   * The agent's final answer for the run. Pairs with `query` to form
   * the (prompt, completion) pair RL/SFT exports project on.
   */
  readonly finalContent: string;

  /**
   * Iteration count — how many ReAct loop turns the agent used to
   * produce `finalContent`. Useful for ranking "decisive" runs vs
   * "thrashy" ones.
   */
  readonly iterations: number;

  /**
   * Decision records collected via `decide()`/`select()` (and skill-graph routing)
   * during the run — harvested live by `causalEvidenceRecorder` (the evidence
   * bridge) and persisted here. Empty only when the run used no decision primitives.
   * THE killer field (by design): each entry carries the rule that matched + the
   * evidence values that satisfied it.
   */
  readonly decisions: ReadonlyArray<DecisionRecord>;

  /**
   * Tool calls made during the run. Each entry: tool name, args,
   * result (truncated). Surfaces the agent's tool-use trajectory for
   * RL training of tool-use policies.
   */
  readonly toolCalls: ReadonlyArray<ToolCallRecord>;

  /**
   * Optional rendered narrative — when an out-of-band recorder
   * captures `executor.getNarrative()` at write time, the full
   * human-readable trace lands here.
   */
  readonly narrative?: string;

  /**
   * Wall-clock duration of the run in milliseconds.
   */
  readonly durationMs: number;

  /**
   * Cumulative token usage at end of run. Used to skip expensive
   * snapshots from training-data exports under cost caps.
   */
  readonly tokenUsage: {
    readonly input: number;
    readonly output: number;
  };

  /**
   * Optional eval score attached by an `evalRecorder`. When present,
   * exports can filter to high-quality runs for SFT or rank for DPO.
   */
  readonly evalScore?: number;
}

export interface DecisionRecord {
  /** Stage id where the decision happened (`'classify-risk'`). */
  readonly stageId: string;
  /** Branch chosen (`'rejected'`, `'manual-review'`). */
  readonly chosen: string;
  /** Optional human label of the rule that matched. */
  readonly rule?: string;
  /** Evidence values that led to the choice (key→value). */
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface ToolCallRecord {
  /** Tool name as registered on the agent. */
  readonly name: string;
  /** Arguments passed to the tool. */
  readonly args: Readonly<Record<string, unknown>>;
  /** Result returned by the tool — TRUNCATED to keep snapshots small. */
  readonly resultPreview: string;
  /** True when the tool threw and the result is the error message. */
  readonly errored: boolean;
}

/**
 * Default truncation when serializing tool results into the snapshot.
 * Keeps snapshot entries small enough to fit many in context during
 * retrieval. Override per-call via `writeSnapshot` config.
 */
export const DEFAULT_TOOL_RESULT_PREVIEW_LEN = 500;

/**
 * What `loadSnapshot` returns to the formatter — the projection slice
 * the consumer asked for via `defineMemory({ projection })`. Each
 * projection produces a different `LLMMessage` content layout.
 */
export interface ProjectedSnapshot {
  readonly query: string;
  readonly content: string;
  readonly source: { readonly entryId: string; readonly score: number };
}

/**
 * The shape of a single message produced from a projected snapshot.
 * Always `system` role so the LLM treats it as authoritative context
 * about a past run.
 */
export type SnapshotMessage = LLMMessage & { readonly role: 'system' };
