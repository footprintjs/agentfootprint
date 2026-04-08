/**
 * agentfootprint/explain — Understand agent decisions.
 *
 * ExplainRecorder collects grounding data during traversal — sources (tool results),
 * claims (LLM outputs), and decisions (tool calls). No post-processing.
 *
 * @example
 * ```typescript
 * import { ExplainRecorder } from 'agentfootprint/explain';
 *
 * const explain = new ExplainRecorder();
 * agent.recorder(explain);
 * await agent.run('Check order');
 *
 * const report = explain.explain();
 * console.log(report.sources);   // what tools returned
 * console.log(report.claims);    // what the LLM said
 * console.log(report.decisions); // what the LLM chose to do
 * ```
 */

export { createAgentRenderer } from './lib/narrative';
export type { AgentRendererOptions } from './lib/narrative';

// ExplainRecorder — collect grounding data during traversal (no post-processing)
export { ExplainRecorder } from './recorders/v2/ExplainRecorder';
export type {
  ToolSource,
  LLMClaim,
  AgentDecision,
  LLMContext,
  Explanation,
} from './recorders/v2/ExplainRecorder';
