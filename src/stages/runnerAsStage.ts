/**
 * runnerAsStage — wraps any RunnerLike as a flowchart stage function.
 *
 * This is the core primitive for multi-agent composition. Any runner
 * (Agent, RAG, LLMCall, or user-built) can become a stage in a pipeline.
 */

import type { TypedScope } from 'footprintjs';
import type { AgentStageConfig, AgentResultEntry } from '../types';
import type { MultiAgentState } from '../scope/types';

/**
 * Creates a stage function that executes a runner and writes its result to scope.
 *
 * Default behavior:
 * - Input: reads previous agent's output (or pipelineInput for first agent)
 * - Output: writes to 'result' and records agent entry in agentResults
 */
export function runnerAsStage(config: AgentStageConfig) {
  return async (scope: TypedScope<MultiAgentState>): Promise<void> => {
    const state = buildStateSnapshot(scope);
    // Default: prefer previous agent's result, fall back to pipeline input
    const input = config.inputMapper
      ? config.inputMapper(state)
      : (state.result as string) ?? (state.pipelineInput as string) ?? '';

    const startTime = Date.now();

    const env = scope.$getEnv();
    const signal = env?.signal;
    const timeoutMs = env?.timeoutMs;

    const output = await config.runner.run(input, { signal, timeoutMs });
    const latencyMs = Date.now() - startTime;

    // Apply output mapper or default write
    if (config.outputMapper) {
      const mapped = config.outputMapper(output, state);
      for (const [key, value] of Object.entries(mapped)) {
        scope.$setValue(key, value);
      }
    } else {
      scope.result = output.content;
    }

    // Record agent result entry
    const entry: AgentResultEntry = {
      id: config.id,
      name: config.name,
      content: output.content,
      latencyMs,
      narrative: config.runner.getNarrativeEntries?.().map((e) => e.text) ?? undefined,
    };

    const existing = scope.agentResults ?? [];
    scope.agentResults = [...existing, entry];
  };
}

/** Build a plain object snapshot of scope state for mappers. */
function buildStateSnapshot(scope: TypedScope<MultiAgentState>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // Read well-known keys that mappers might need
  for (const key of [
    'pipelineInput',
    'result',
    'agentResults',
    'messages',
    'systemPrompt',
  ] as const) {
    const val = scope.$getValue(key);
    if (val !== undefined) result[key] = val;
  }
  return result;
}
