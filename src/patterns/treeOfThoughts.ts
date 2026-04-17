/**
 * treeOfThoughts — N parallel thinkers → one judge picks best.
 *
 * Fan out N parallel thinkers (each a runner, typically same prompt + higher
 * temperature variance), format their outputs as context, then hand to a
 * judge runner that picks or synthesizes the best answer.
 *
 * Why: for problems where one-shot answers are often wrong, generating
 * multiple independent attempts and judging them catches errors that a
 * single chain-of-thought would miss. Tree-of-Thoughts (Yao et al. 2023)
 * formalized this pattern.
 *
 * Under the hood:
 *   FlowChart[ Parallel({ t0, t1, ..., tN-1, merge: labelled-concat }),
 *              judge ]
 *
 * The merge step concatenates each thinker's output under its id so the
 * judge sees them as labeled candidates. The judge receives that
 * concatenation as its input string.
 *
 * @example
 * ```ts
 * import { Agent, LLMCall, anthropic } from 'agentfootprint';
 * import { treeOfThoughts } from 'agentfootprint/patterns';
 *
 * const provider = anthropic('claude-sonnet-4');
 *
 * const tot = treeOfThoughts({
 *   provider,
 *   branches: 3,
 *   thinker: (i) =>
 *     LLMCall.create({ provider }).system(`Thinker ${i + 1}: propose a different solution.`).build(),
 *   judge: Agent.create({ provider })
 *     .system('Pick the single best answer and explain why.')
 *     .build(),
 * });
 *
 * const result = await tot.run('What is the fastest sort for nearly-sorted data?');
 * ```
 */

import { FlowChart, type FlowChartRunner } from '../concepts/FlowChart';
import { Parallel, type BranchResult } from '../concepts/Parallel';
import type { RunnerLike, LLMProvider } from '../types';

export interface TreeOfThoughtsOptions {
  /** Provider for the Parallel merge step. */
  readonly provider: LLMProvider;
  /** Number of parallel thinkers (2–10). */
  readonly branches: number;
  /**
   * Factory producing one thinker per index. Called once per branch at
   * build time; each should return a built Runner.
   */
  readonly thinker: (index: number) => RunnerLike;
  /** Judge runner — receives all thinker outputs labeled by id, returns the best answer. */
  readonly judge: RunnerLike;
  /** Narrative name (default `'treeOfThoughts'`). */
  readonly name?: string;
}

/**
 * Build a Tree-of-Thoughts pipeline. Returns a `FlowChartRunner`.
 *
 * Throws if `branches < 2` — use a single runner directly when you don't need
 * multiple candidates. Throws if `branches > 10` (Parallel's cap).
 */
export function treeOfThoughts(options: TreeOfThoughtsOptions): FlowChartRunner {
  if (options.branches < 2) {
    throw new Error(
      `treeOfThoughts requires at least 2 branches (got ${options.branches}). Use a single runner for 1-candidate flows.`,
    );
  }

  const parallel = Parallel.create({
    provider: options.provider,
    name: `${options.name ?? 'treeOfThoughts'}:thinkers`,
  });
  for (let i = 0; i < options.branches; i++) {
    parallel.agent(`thinker-${i}`, options.thinker(i), `Thinker ${i + 1}`);
  }
  // Merge: label each thought so the judge can reference them by id.
  // Kept as a pure function so the merge itself uses no LLM call — the judge
  // is the only decision-maker and should be budgeted as such.
  parallel.merge((results: Record<string, BranchResult>) =>
    Object.entries(results)
      .map(([id, r]) => `=== ${id} ===\n${r.content}`)
      .join('\n\n'),
  );

  return FlowChart.create()
    .agent('thinkers', 'Think', parallel.build())
    .agent('judge', 'Judge', options.judge)
    .build();
}
