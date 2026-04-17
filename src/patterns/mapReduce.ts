/**
 * mapReduce — fan-out map over N pre-bound mappers, then reduce.
 *
 * Each mapper is a runner with its own input already bound (prepare them with
 * the slice they should process). `Parallel.mergeWithLLM` or a custom reduce
 * function combines the results. Under the hood: a single `Parallel` with N
 * branches and one merge strategy.
 *
 * Why: map-reduce is a common shape — summarize N documents, compare N
 * candidates, evaluate a prompt against N rubrics. Keeping it as a named
 * pattern teaches the shape; each mapper / reducer is still a regular runner.
 *
 * @example
 * ```ts
 * import { LLMCall, anthropic } from 'agentfootprint';
 * import { mapReduce } from 'agentfootprint/patterns';
 *
 * const documents = [doc1, doc2, doc3];
 * const provider = anthropic('claude-sonnet-4');
 *
 * const pipeline = mapReduce({
 *   provider,
 *   mappers: documents.map((doc, i) => ({
 *     id: `doc-${i}`,
 *     description: `Summarize doc ${i}`,
 *     runner: LLMCall.create({ provider })
 *       .system(`Summarize this document:\n\n${doc}`)
 *       .build(),
 *   })),
 *   reduce: { mode: 'llm', prompt: 'Combine the summaries into a single report.' },
 * });
 *
 * const result = await pipeline.run('Produce the report');
 * ```
 */

import { Parallel, type ParallelRunner, type BranchResult } from '../concepts/Parallel';
import type { RunnerLike, LLMProvider } from '../types';

export interface MapReduceMapper {
  readonly id: string;
  readonly description: string;
  readonly runner: RunnerLike;
}

export type MapReduceReduceConfig =
  | { readonly mode: 'llm'; readonly prompt: string }
  | { readonly mode: 'fn'; readonly fn: (results: Record<string, BranchResult>) => string };

export interface MapReduceOptions {
  /** Provider used for the reduce step (only needed when `reduce.mode === 'llm'`). */
  readonly provider: LLMProvider;
  /** Pre-bound mappers — each runner already has its slice of work baked in. */
  readonly mappers: readonly MapReduceMapper[];
  /** Reduce strategy — LLM-synthesized or custom function. */
  readonly reduce: MapReduceReduceConfig;
  /** Name in narrative (default `'mapReduce'`). */
  readonly name?: string;
}

/**
 * Build a map-reduce pipeline. Returns a `ParallelRunner` — plug it into
 * `FlowChart`, `Conditional`, or `Agent.route()` like any other runner.
 */
export function mapReduce(options: MapReduceOptions): ParallelRunner {
  if (options.mappers.length < 2) {
    throw new Error(
      'mapReduce requires at least 2 mappers. Use a single runner directly if you only have one.',
    );
  }
  const builder = Parallel.create({
    provider: options.provider,
    name: options.name ?? 'mapReduce',
  });
  for (const m of options.mappers) {
    builder.agent(m.id, m.runner, m.description);
  }
  if (options.reduce.mode === 'llm') {
    builder.mergeWithLLM(options.reduce.prompt);
  } else {
    builder.merge(options.reduce.fn);
  }
  return builder.build();
}
