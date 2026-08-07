/**
 * topK — the retrieval strategy agentfootprint has always used, now
 * written down as one.
 *
 * Pattern: Strategy (one of {@link RetrievalStrategy}).
 * Role:    memory/ layer. Extracted in 8.8.0 from the two numbers that
 *          used to live loose on `defineRAG` (`topK`, `threshold`), so
 *          that a different rule can be written without touching a stage.
 * Emits:   N/A — the stage that calls it does the emitting.
 *
 * Behaviour is byte-for-byte what 8.7.0 did: take the highest-scoring
 * candidates that clear `threshold`, at most `k` of them, and inject
 * nothing at all when none clear it.
 *
 * **The threshold is strict, and strict means silent-by-design becomes
 * loud-by-record.** When nothing clears the floor, no context is
 * injected — a weak match in the prompt makes a confident wrong answer
 * more likely, not less. What 8.8.0 changes is that the near-misses are
 * now IN the record with their scores, so "the agent answered from
 * nothing" is a readable outcome instead of an absence.
 */
import type { RetrievalStrategy, RetrievalVerdict, ScoredCandidate } from './types.js';

export interface TopKOptions {
  /**
   * How many chunks may reach the prompt. Default 3 — enough for more
   * than one perspective, few enough that the middle of a long context
   * does not swallow the answer.
   */
  readonly k?: number;
  /**
   * Minimum similarity to admit, in the store's score space ([-1, 1]
   * cosine for every shipped store). Default 0.7.
   *
   * 0.7 is a high bar for some embedders. Sentence-transformer relatives
   * (`all-MiniLM-L6-v2` and family, which `localEmbedder` uses by
   * default) often score 0.4–0.6 on genuinely relevant chunks; OpenAI
   * `text-embedding-3-*` sits comfortably at 0.7. If retrievals come back
   * empty, read the `agentfootprint.memory.retrieved` event: it now
   * carries the rejected candidates and their scores, so the right
   * threshold is a number you can see rather than one you guess.
   *
   * Pass `null` for no floor — every candidate up to `k` is admitted.
   */
  readonly threshold?: number | null;
  /**
   * How many extra candidates to pull past `k` so that rejected ones can
   * be reported. Default 10. Raising it costs one larger read and shows
   * more near-misses; it can never change which candidates are admitted.
   */
  readonly rejectWindow?: number;
}

/**
 * Build the top-K strategy.
 *
 * @example
 * ```ts
 * import { defineRAG } from 'agentfootprint';
 * import { topK } from 'agentfootprint/memory';
 *
 * const docs = defineRAG({
 *   id: 'product-docs',
 *   store, embedder,
 *   retrieval: topK({ k: 5, threshold: 0.55 }),
 * });
 * ```
 */
export function topK(options: TopKOptions = {}): RetrievalStrategy {
  const k = options.k ?? 3;
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`topK: \`k\` must be a positive integer — received ${String(options.k)}.`);
  }
  const rejectWindow = options.rejectWindow ?? 10;
  if (!Number.isInteger(rejectWindow) || rejectWindow < 0) {
    throw new Error(
      `topK: \`rejectWindow\` must be a non-negative integer — received ${String(
        options.rejectWindow,
      )}.`,
    );
  }
  const threshold = options.threshold === null ? undefined : options.threshold ?? 0.7;
  if (threshold !== undefined && !Number.isFinite(threshold)) {
    throw new Error(
      `topK: \`threshold\` must be a finite number or null — received ${String(
        options.threshold,
      )}.`,
    );
  }

  return {
    name: 'topK',
    k,
    ...(threshold !== undefined && { threshold }),
    rejectWindow,
    select(pool: readonly ScoredCandidate[]): readonly RetrievalVerdict[] {
      const verdicts: RetrievalVerdict[] = [];
      let admitted = 0;
      for (const candidate of pool) {
        if (threshold !== undefined && candidate.score < threshold) {
          verdicts.push({ admitted: false, reason: 'below-threshold' });
          continue;
        }
        if (admitted >= k) {
          verdicts.push({ admitted: false, reason: 'over-max-entries' });
          continue;
        }
        admitted += 1;
        verdicts.push({ admitted: true });
      }
      return verdicts;
    },
  };
}
