/**
 * planExecute — Planner → Executor composition.
 *
 * Two runners chained sequentially: the planner takes the user request and
 * produces a plan; the executor takes that plan (as the planner's output) and
 * carries it out. Pure composition over `FlowChart` — no new primitives,
 * readable as a teaching example.
 *
 * Why: separating planning from execution is often cheaper (small model
 * plans, capable model executes) and safer (plan visible in narrative before
 * any tool fires).
 *
 * @example
 * ```ts
 * import { Agent, anthropic } from 'agentfootprint';
 * import { planExecute } from 'agentfootprint/patterns';
 *
 * const planner = Agent.create({ provider: anthropic('claude-haiku-4-5') })
 *   .system('Produce a numbered plan. Do not execute.')
 *   .build();
 *
 * const executor = Agent.create({ provider: anthropic('claude-sonnet-4') })
 *   .system('Execute the given plan step by step.')
 *   .tools([...])
 *   .build();
 *
 * const runner = planExecute({ planner, executor });
 * const result = await runner.run('Research competitors and draft a brief.');
 * ```
 */

import { FlowChart, type FlowChartRunner } from '../concepts/FlowChart';
import type { RunnerLike } from '../types';

export interface PlanExecuteOptions {
  /** Runner that produces a plan from the user's request. */
  readonly planner: RunnerLike;
  /** Runner that executes the plan produced by `planner`. */
  readonly executor: RunnerLike;
  /** Stage name for the planner step in narrative (default `'Plan'`). */
  readonly planName?: string;
  /** Stage name for the executor step in narrative (default `'Execute'`). */
  readonly executeName?: string;
}

/**
 * Build a planner → executor pipeline. Returns a `FlowChartRunner` — plug it
 * into `Parallel`, `FlowChart`, `Conditional`, or `Agent.route()` like any
 * other runner.
 */
export function planExecute(options: PlanExecuteOptions): FlowChartRunner {
  return FlowChart.create()
    .agent('plan', options.planName ?? 'Plan', options.planner)
    .agent('execute', options.executeName ?? 'Execute', options.executor)
    .build();
}
