/**
 * SelfConsistency — sample N answers, pick the majority.
 *
 * Paper: "Self-Consistency Improves Chain of Thought Reasoning in
 * Language Models" — Wang et al., 2022 (https://arxiv.org/abs/2203.11171).
 *
 * Pattern: Factory (GoF) → produces a `Runner` that composes `Parallel`
 *          of N `LLMCall` branches with a majority-vote merge function.
 * Role:    patterns/ layer. Pure composition of core primitives +
 *          core-flow compositions — no new abstractions.
 * Emits:   Everything `Parallel` + `LLMCall` emit (stream / composition /
 *          context). No pattern-specific event domain needed; consumers
 *          observe via the standard typed listeners.
 */

import type { LLMProvider } from '../adapters/types.js';
import { LLMCall } from '../core/LLMCall.js';
import type { Runner } from '../core/runner.js';
import { Parallel } from '../core-flow/Parallel.js';

export interface SelfConsistencyOptions {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly systemPrompt: string;
  /** Number of parallel samples. 3 / 5 are typical; paper uses up to 40. */
  readonly samples: number;
  /** Sampling temperature. Defaults to a higher value (0.7) to get diverse samples. */
  readonly temperature?: number;
  readonly maxTokens?: number;
  /**
   * Consumer-provided extractor: given a full LLM response, return the
   * "vote token" (e.g., the final answer stripped of the chain-of-thought
   * preamble). Defaults to returning the trimmed string.
   */
  readonly extract?: (response: string) => string;
  readonly name?: string;
  readonly id?: string;
}

/**
 * Build a SelfConsistency Runner. Given a system prompt, the Runner
 * runs `samples` parallel LLMCalls with the same input, extracts each
 * response's vote token, then returns the most-frequent token. Ties
 * are broken by the first response's extract.
 */
export function selfConsistency(opts: SelfConsistencyOptions): Runner<{ message: string }, string> {
  if (opts.samples < 1) {
    throw new Error('SelfConsistency: samples must be >= 1');
  }
  if (opts.samples < 2) {
    throw new Error(
      'SelfConsistency: samples must be >= 2 to have anything to vote on (use LLMCall for 1 sample)',
    );
  }

  const extract = opts.extract ?? ((s: string) => s.trim());

  let builder = Parallel.create({
    name: opts.name ?? 'SelfConsistency',
    id: opts.id ?? 'self-consistency',
  });

  for (let i = 0; i < opts.samples; i++) {
    const branch = LLMCall.create({
      provider: opts.provider,
      model: opts.model,
      // Higher default temperature for sampling diversity — the whole
      // point of SelfConsistency is to get DIFFERENT samples.
      temperature: opts.temperature ?? 0.7,
      ...(opts.maxTokens !== undefined && { maxTokens: opts.maxTokens }),
    })
      .system(opts.systemPrompt)
      .build();
    builder = builder.branch(`sample-${i}`, branch);
  }

  return builder
    .mergeWithFn((results) => {
      const tallies = new Map<string, number>();
      const order: string[] = [];
      for (const id of Object.keys(results).sort()) {
        // Object.keys() guarantees the index hits, so results[id] is defined.
        const value = results[id];
        if (value === undefined) continue;
        const vote = extract(value);
        if (!tallies.has(vote)) order.push(vote);
        tallies.set(vote, (tallies.get(vote) ?? 0) + 1);
      }
      // SelfConsistency runs N branches and merges; if N === 0 there's
      // nothing to vote on. Throw rather than silently returning empty.
      if (order.length === 0) {
        throw new Error('SelfConsistency: no branch results to vote on');
      }
      let best = order[0];
      let bestCount = tallies.get(best) ?? 0;
      for (const vote of order) {
        const count = tallies.get(vote) ?? 0;
        if (count > bestCount) {
          best = vote;
          bestCount = count;
        }
      }
      return best;
    })
    .build();
}
