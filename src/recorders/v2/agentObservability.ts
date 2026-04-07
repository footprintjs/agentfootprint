/**
 * agentObservability() — one-call preset for full agent observability.
 *
 * Bundles TokenRecorder, ToolUsageRecorder, CostRecorder, and ExplainRecorder
 * into a single CompositeRecorder. One `.recorder()` call gives you token tracking,
 * tool usage, cost estimation, and grounding analysis (sources vs claims).
 *
 * Stage-level timing is auto-attached by the runners (MetricRecorder on the
 * executor) — this preset covers the agent-level concerns only.
 *
 * @example
 * ```typescript
 * import { Agent, agentObservability } from 'agentfootprint';
 *
 * const obs = agentObservability();
 * const agent = Agent.create({ provider })
 *   .recorder(obs)
 *   .build();
 *
 * await agent.run('hello');
 *
 * obs.tokens();   // { totalCalls: 2, totalInputTokens: 150, ... }
 * obs.tools();    // { totalCalls: 1, byTool: { search: { calls: 1, ... } } }
 * obs.cost();     // 0.0042
 * obs.explain();  // { sources, claims, decisions, summary }
 * ```
 */

import type { ModelPricing, CostEntry } from './CostRecorder';
import type { TokenStats } from './TokenRecorder';
import type { ToolUsageStats } from './ToolUsageRecorder';
import type { Explanation } from './ExplainRecorder';
import { CompositeRecorder } from './CompositeRecorder';
import { CostRecorder } from './CostRecorder';
import { ExplainRecorder } from './ExplainRecorder';
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
  /** Grounding analysis — sources (tool results) vs claims (LLM output). */
  explain(): Explanation;
}

/**
 * Create a bundled agent observability recorder.
 *
 * Tracks tokens, tool usage, cost, and grounding in a single `.recorder()` call.
 * Stage timing is handled separately by MetricRecorder (auto-attached by runners).
 */
export function agentObservability(
  options?: AgentObservabilityOptions,
): AgentObservabilityRecorder {
  const tokenRec = new TokenRecorder();
  const toolRec = new ToolUsageRecorder();
  const costRec = new CostRecorder(
    options?.pricing ? { pricingTable: options.pricing } : undefined,
  );
  const explainRec = new ExplainRecorder();

  const composite = new CompositeRecorder(
    [tokenRec, toolRec, costRec, explainRec],
    options?.id ?? 'agent-observability',
  ) as AgentObservabilityRecorder;

  // Convenience accessors — no need to dig into children
  composite.tokens = () => tokenRec.getStats();
  composite.tools = () => toolRec.getStats();
  composite.cost = () => costRec.getTotalCost();
  composite.costEntries = () => costRec.getEntries();
  composite.explain = () => explainRec.explain();

  return composite;
}
