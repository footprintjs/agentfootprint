/**
 * MemoryState — shared scope for every stage in a memory pipeline.
 *
 * Each stage reads some fields and writes others; the pipeline's narrative
 * shows who wrote what. Fields are added as layers need them — this is the
 * minimal shape for Layer 2 (load + write stages). Layer 3 will add
 * `candidates`, `selected`, `formatted`; Layer 8 will add summarization
 * fields. Every field is optional so pipelines can mix stages freely.
 *
 * Shape design: fields cluster by pipeline direction.
 *   - `identity` / `turnNumber` / `contextTokensRemaining` are INPUTS
 *     set by the wire layer before the pipeline runs.
 *   - `loaded` is the READ-SIDE output.
 *   - `newMessages` is the WRITE-SIDE input.
 *   - (later layers: `candidates`, `selected`, `formatted`, `saveBatch`)
 */
import type { MemoryIdentity } from '../identity';
import type { MemoryEntry } from '../entry';
import type { LLMMessage as Message } from '../../adapters/types';

export interface MemoryState {
  /**
   * Scoping for every storage call this pipeline makes. Wire layer
   * populates this before the pipeline runs; stages MUST NOT mutate it.
   */
  readonly identity: MemoryIdentity;

  /**
   * Run-local turn counter — 1 for the first `agent.run`, 2 for the second,
   * and so on within the same conversationId. Written into `MemoryEntry.source`
   * by write-side stages for provenance.
   */
  readonly turnNumber: number;

  /**
   * Context-window pressure signal (MemGPT-reviewer ask). Populated by the
   * wire layer with `model.contextWindow - tokensUsedSoFar`. Picker stages
   * (Layer 3) use this to decide how much memory to inject.
   *
   * 0 or negative values should be treated by consumers as "no headroom" —
   * stages typically skip or truncate memory injection in that case.
   */
  readonly contextTokensRemaining: number;

  /**
   * Read-side output: entries loaded from the store this turn. Stages
   * typically APPEND rather than replace so multiple load stages can
   * contribute (e.g. recent-messages + semantic-retrieval + facts).
   */
  loaded: MemoryEntry<Message>[];

  /**
   * Picker output — the subset of `loaded` that fits the context budget,
   * in chronological order (oldest first). Format stages consume this.
   * Empty array when the picker decided NOT to inject memory (budget
   * below minimum, or no entries loaded).
   */
  selected: MemoryEntry<Message>[];

  /**
   * Formatter output — the `Message[]` that will be injected into the
   * LLM's prompt this turn. The wire layer merges this into the agent's
   * messages array (typically as `system` messages before the user turn).
   */
  formatted: Message[];

  /**
   * Write-side input: messages to persist at the end of this turn. The
   * wire layer populates from the agent's final message state;
   * `writeMessages` wraps each as a `MemoryEntry` and calls `store.put`.
   */
  newMessages: Message[];

  /** Escape hatch for pipeline-specific fields. Typed per-pipeline as needed. */
  [key: string]: unknown;
}
