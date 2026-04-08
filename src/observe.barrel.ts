/**
 * agentfootprint/observe — Monitor agent execution.
 *
 * Track tokens, cost, tool usage, quality, guardrails. Attach via `.recorder()`.
 *
 * @example
 * ```typescript
 * import { agentObservability } from 'agentfootprint/observe';
 *
 * const obs = agentObservability({ pricing: { 'claude-sonnet': { input: 3, output: 15 } } });
 * const agent = Agent.create({ provider }).recorder(obs).build();
 * await agent.run('hello');
 * console.log(obs.tokens()); // { totalCalls, totalInputTokens, ... }
 * ```
 */

export {
  TokenRecorder,
  CostRecorder,
  TurnRecorder,
  ToolUsageRecorder,
  QualityRecorder,
  GuardrailRecorder,
  PermissionRecorder,
  CompositeRecorder,
  agentObservability,
} from './recorders';

export { OTelRecorder } from './recorders/OTelRecorder';
export type { OTelTracer, OTelRecorderOptions } from './recorders/OTelRecorder';

export type {
  TokenStats,
  LLMCallEntry,
  CostEntry,
  CostRecorderOptions,
  TurnEntry,
  ToolUsageStats,
  ToolStats,
  QualityScore,
  QualityJudge,
  Violation,
  GuardrailCheck,
  PermissionEvent,
  AgentObservabilityOptions,
  AgentObservabilityRecorder,
} from './recorders';

export type { AgentRecorder } from './core';
