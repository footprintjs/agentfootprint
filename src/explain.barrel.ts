/**
 * agentfootprint/explain — Understand agent decisions.
 *
 * Extract grounding sources (tool results) and LLM claims for hallucination detection.
 * Verbose narrative mode for full values. AgentScopeKey enum for type-safe queries.
 *
 * @example
 * ```typescript
 * import { getGroundingSources, getLLMClaims } from 'agentfootprint/explain';
 *
 * const entries = agent.getNarrativeEntries();
 * const sources = getGroundingSources(entries);  // what tools returned
 * const claims = getLLMClaims(entries);           // what the LLM said
 * ```
 */

export { getGroundingSources, getLLMClaims, getFullLLMContext, createAgentRenderer } from './lib/narrative';
export type { GroundingSource, LLMClaim, LLMContextSnapshot, AgentRendererOptions } from './lib/narrative';

// ExplainRecorder — collect grounding data during traversal (no post-processing)
export { ExplainRecorder } from './recorders/v2/ExplainRecorder';
export type { ToolSource, AgentDecision, Explanation } from './recorders/v2/ExplainRecorder';
