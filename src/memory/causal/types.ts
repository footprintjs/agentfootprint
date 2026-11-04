/** Version2 causal snapshots: answer facts plus explicit component-leg evidence. */
import type { LLMMessage } from '../../provider-contract/types.js';
import type { Observation, SnapshotCoverage } from './observation.js';

export type SnapshotEntry = {
  readonly schemaVersion: 2;
  readonly query: string;
  readonly finalContent: string;
  readonly narrative?: string;
  readonly evalScore?: number;
} & Observation<SnapshotCoverage>;

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
