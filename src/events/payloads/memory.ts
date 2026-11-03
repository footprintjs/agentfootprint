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
