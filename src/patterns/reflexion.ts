/**
 * reflexion — Solve → Critique → Improve (single-pass).
 *
 * Three runners chained sequentially: a solver produces a draft, a critic
 * reviews it, an improver integrates the critique. Shinn et al. 2023's
 * Reflexion pattern has a quality-gated loop; this is the simplest form —
 * one reflection pass. For multi-iteration Reflexion, wrap this pattern
 * inside `Conditional` to rerun while a quality predicate fails.
 *
 * Why: a single self-review pass catches a surprising number of errors in
 * reasoning / code / plans. Exposing the three runners individually lets
 * users pick cheap models for critic/improver while keeping a strong solver.
 *
 * Under the hood:
 *   FlowChart[ solver, critic, improver ]
 *
 * Each runner receives the previous runner's output as its input message.
 *
 * @example
 * ```ts
 * import { Agent, anthropic } from 'agentfootprint';
 * import { reflexion } from 'agentfootprint/patterns';
 *
 * const provider = anthropic('claude-sonnet-4');
 *
 * const reviewer = reflexion({
 *   solver: Agent.create({ provider }).system('Draft an answer.').build(),
 *   critic: Agent.create({ provider }).system('List weaknesses in the draft.').build(),
 *   improver: Agent.create({ provider })
 *     .system('Apply the critique to improve the draft.')
 *     .build(),
 * });
 *
 * const result = await reviewer.run('Explain monads in plain English.');
 * ```
 *
 * For multi-iteration Reflexion (loop until quality gate passes), compose
 * with `Conditional`:
 * ```ts
 * import { Conditional } from 'agentfootprint';
 * const iterative = Conditional.create()
 *   .when((s) => qualityOf(s) < 0.8, reviewer)
 *   .otherwise(doneRunner)
 *   .build();
 * ```
 */

import { FlowChart, type FlowChartRunner } from '../concepts/FlowChart';
import type { RunnerLike } from '../types';

export interface ReflexionOptions {
  /** Produces the first draft. */
  readonly solver: RunnerLike;
  /** Reviews the draft, outputs critique. */
  readonly critic: RunnerLike;
  /** Integrates the critique to produce the final answer. */
  readonly improver: RunnerLike;
  /** Stage names for narrative (defaults: `'Solve'`, `'Critique'`, `'Improve'`). */
  readonly solveName?: string;
  readonly critiqueName?: string;
  readonly improveName?: string;
}

/**
 * Build a Solve → Critique → Improve pipeline. Returns a `FlowChartRunner`.
 */
export function reflexion(options: ReflexionOptions): FlowChartRunner {
  return FlowChart.create()
    .agent('solve', options.solveName ?? 'Solve', options.solver)
    .agent('critique', options.critiqueName ?? 'Critique', options.critic)
    .agent('improve', options.improveName ?? 'Improve', options.improver)
    .build();
}
