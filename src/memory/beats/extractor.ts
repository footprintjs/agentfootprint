/**
 * BeatExtractor — interface for compressing turn messages into narrative beats.
 *
 * The write-side `extractBeats` stage calls a BeatExtractor to turn
 * raw turn messages into zero or more `NarrativeBeat`s. The stage
 * persists the beats via the ordinary `MemoryStore` interface — beats
 * are a payload type, not a storage concern.
 *
 * Built-in extractors:
 *   - `heuristicExtractor()` — zero-dep, zero-cost. Extracts simple
 *     "User said X / Assistant answered Y" beats from the raw text.
 *     Default for out-of-the-box narrativePipeline().
 *   - `llmExtractor({ provider, importance? })` — uses a provider
 *     (typically a cheap model like Haiku) to produce high-quality
 *     beats with importance scores and categories. Opt-in.
 *
 * Consumers can implement their own BeatExtractor — e.g. a
 * rules-based extractor for a specific domain, or a hybrid that
 * combines heuristics with LLM rescoring.
 */
import type { Message } from '../../types/messages';
import type { NarrativeBeat } from './types';

export interface ExtractArgs {
  /**
   * New-turn messages (user / assistant / tool). Extractors should
   * produce beats that summarize these — NOT prior-turn messages,
   * which were already compacted at their own turn boundary.
   */
  readonly messages: readonly Message[];

  /**
   * Current turn number. Useful for extractors that want to include
   * the turn index in beat refs (e.g., `"turn-5-msg-2"`).
   */
  readonly turnNumber: number;

  /**
   * Optional abort signal — extractors that make LLM calls should
   * thread this through to the provider to respect run-level timeouts.
   */
  readonly signal?: AbortSignal;
}

/**
 * A BeatExtractor compresses a turn's messages into beats. Returning
 * an empty array is valid (not every turn produces a salient beat).
 */
export interface BeatExtractor {
  extract(args: ExtractArgs): Promise<readonly NarrativeBeat[]>;
}
