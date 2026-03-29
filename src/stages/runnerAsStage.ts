/**
 * runnerAsStage — wraps any RunnerLike as a flowchart stage function.
 *
 * This is the core primitive for multi-agent composition. Any runner
 * (Agent, RAG, LLMCall, or user-built) can become a stage in a pipeline.
 */

import type { ScopeFacade } from 'footprintjs/advanced';
import type { AgentStageConfig } from '../types';
import { AgentScope } from '../scope';
import { MULTI_AGENT_PATHS } from '../scope/AgentScope';

/**
 * Creates a stage function that executes a runner and writes its result to scope.
 *
 * Default behavior:
 * - Input: reads previous agent's output (or pipelineInput for first agent)
 * - Output: writes to 'result' and records agent entry in agentResults
 */
export function runnerAsStage(config: AgentStageConfig) {
  return async (scope: ScopeFacade): Promise<void> => {
    const state = buildStateSnapshot(scope);
    // Default: prefer previous agent's result, fall back to pipeline input
    const input = config.inputMapper
      ? config.inputMapper(state)
      : (state[MULTI_AGENT_PATHS.RESULT] as string) ??
        (state[MULTI_AGENT_PATHS.PIPELINE_INPUT] as string) ??
        '';

    const startTime = Date.now();

    const signal = scope.getValue(MULTI_AGENT_PATHS.SIGNAL) as AbortSignal | undefined;
    const timeoutMs = scope.getValue(MULTI_AGENT_PATHS.TIMEOUT_MS) as number | undefined;

    const output = await config.runner.run(input, { signal, timeoutMs });
    const latencyMs = Date.now() - startTime;

    // Apply output mapper or default write
    if (config.outputMapper) {
      const mapped = config.outputMapper(output, state);
      for (const [key, value] of Object.entries(mapped)) {
        scope.setValue(key, value);
      }
    } else {
      AgentScope.setResult(scope, output.content);
    }

    // Record agent result entry
    const entry = {
      id: config.id,
      name: config.name,
      content: output.content,
      latencyMs,
      narrative: config.runner.getNarrative?.() ?? undefined,
    };

    const existing = (scope.getValue(MULTI_AGENT_PATHS.AGENT_RESULTS) as unknown[]) ?? [];
    scope.setValue(MULTI_AGENT_PATHS.AGENT_RESULTS, [...existing, entry]);
  };
}

/** Build a plain object snapshot of scope state for mappers. */
function buildStateSnapshot(scope: ScopeFacade): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // Read well-known keys that mappers might need
  for (const key of [
    MULTI_AGENT_PATHS.PIPELINE_INPUT,
    MULTI_AGENT_PATHS.RESULT,
    MULTI_AGENT_PATHS.AGENT_RESULTS,
    'messages',
    'systemPrompt',
  ]) {
    const val = scope.getValue(key);
    if (val !== undefined) result[key] = val;
  }
  return result;
}
