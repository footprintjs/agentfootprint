/**
 * FactExtractor — interface for distilling stable claims out of a turn.
 *
 * Complements `BeatExtractor`: a beat summarizes what happened, a
 * fact captures what's *currently true*. Different extractors produce
 * different levels of structure (pattern-based for quick identity /
 * contact info; LLM-based for rich open-ended extraction).
 *
 * Built-in extractors:
 *   - `patternFactExtractor()` — zero-dep regex heuristics for
 *     common identity / location / contact patterns.
 *   - `llmFactExtractor({ provider })` — one LLM call per turn for
 *     open-ended extraction. Opt-in.
 */
import type { Message } from '../../types/messages';
import type { Fact } from './types';

export interface FactExtractArgs {
  /** New-turn messages. */
  readonly messages: readonly Message[];

  /** Current turn number. Useful for extractors that want it in a source tag. */
  readonly turnNumber: number;

  /**
   * Facts already in the store (if caller has a cheap way to fetch).
   * Passed to extractors that merge / dedupe at extraction time.
   * May be empty even when facts exist — not every pipeline pre-loads.
   */
  readonly existing?: readonly Fact[];

  /** Optional abort signal for LLM-based extractors. */
  readonly signal?: AbortSignal;
}

export interface FactExtractor {
  extract(args: FactExtractArgs): Promise<readonly Fact[]>;
}
