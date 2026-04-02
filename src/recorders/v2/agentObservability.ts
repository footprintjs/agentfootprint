/**
 * agentObservability() — one-call preset for full agent observability.
 *
 * Bundles TokenRecorder, ToolUsageRecorder, and CostRecorder into a single
 * CompositeRecorder. The consumer attaches one recorder and gets token tracking,
 * tool usage stats, and cost estimation without knowing the individual types.
 *
 * Stage-level timing is auto-attached by the runners (MetricRecorder on the
 * executor) — this preset covers the agent-level concerns only.
 *
 * @example
 * ```typescript
 * import { Agent, agentObservability } from 'agentfootprint';
 *
 * // One call — tokens, tools, and cost tracking
 * const obs = agentObservability();
 * const agent = Agent.create({ provider })
 *   .recorder(obs)
 *   .build();
 *
 * await agent.run('hello');
 *
 * // Access stats
 * console.log(obs.tokens());     // { totalCalls: 2, totalInputTokens: 150, ... }
 * console.log(obs.tools());      // { totalCalls: 1, byTool: { search: { calls: 1, ... } } }
 * console.log(obs.cost());       // 0.0042
 * ```
 *
 * @example
 * ```typescript
 * // With cost estimation
 * const obs = agentObservability({
 *   pricing: {
 *     'claude-sonnet-4-20250514': { input: 3, output: 15 },
 *     'gpt-4o': { input: 2.5, output: 10 },
 *   },
 * });
 * ```
 */

import type { ModelPricing, CostEntry } from './CostRecorder';
import type { TokenStats } from './TokenRecorder';
import type { ToolUsageStats } from './ToolUsageRecorder';
import { CompositeRecorder } from './CompositeRecorder';
import { CostRecorder } from './CostRecorder';
import { TokenRecorder } from './TokenRecorder';
import { ToolUsageRecorder } from './ToolUsageRecorder';

export interface AgentObservabilityOptions {
  /** Custom ID for the composite recorder. Default: 'agent-observability'. */
  id?: string;
  /** Pricing table for cost estimation (per 1M tokens). Models not listed get $0. */
  pricing?: Record<string, ModelPricing>;
}

/** Return type of agentObservability() with convenience accessors. */
export interface AgentObservabilityRecorder extends CompositeRecorder {
  /** Token usage stats across all LLM calls. */
  tokens(): TokenStats;
  /** Tool usage stats — calls, errors, latency by tool name. */
  tools(): ToolUsageStats;
  /** Total estimated USD cost. */
  cost(): number;
  /** Per-call cost breakdown. */
  costEntries(): CostEntry[];
}

/**
 * Create a bundled agent observability recorder.
 *
 * Tracks tokens, tool usage, and cost in a single `.recorder()` call.
 * Stage timing is handled separately by MetricRecorder (auto-attached by runners).
 */
export function agentObservability(options?: AgentObservabilityOptions): AgentObservabilityRecorder {
  const tokenRec = new TokenRecorder();
  const toolRec = new ToolUsageRecorder();
  const costRec = new CostRecorder(
    options?.pricing ? { pricingTable: options.pricing } : undefined,
  );

  const composite = new CompositeRecorder(
    [tokenRec, toolRec, costRec],
    options?.id ?? 'agent-observability',
  ) as AgentObservabilityRecorder;

  // Convenience accessors — no need to dig into children
  composite.tokens = () => tokenRec.getStats();
  composite.tools = () => toolRec.getStats();
  composite.cost = () => costRec.getTotalCost();
  composite.costEntries = () => costRec.getEntries();

  return composite;
}
