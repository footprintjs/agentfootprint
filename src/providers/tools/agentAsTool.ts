/**
 * agentAsTool — wraps a RunnerLike as a ToolDefinition.
 *
 * Turns any agent (or runner) into a callable tool. The LLM can invoke it
 * like any other tool, passing a message. The runner executes and returns
 * the result as tool output.
 *
 * This is the primitive for delegation patterns: an orchestrator agent
 * can call specialist agents as tools (Swarm handoff, hierarchy, etc.).
 *
 * Usage:
 *   const researchTool = agentAsTool({
 *     id: 'research',
 *     description: 'Research a topic in depth.',
 *     runner: researchAgent,
 *   });
 *   const orchestrator = Agent.create({ provider })
 *     .tool(researchTool)
 *     .build();
 */

import type { ToolDefinition, ToolResult } from '../../types/tools';
import type { RunnerLike } from '../../types/multiAgent';

export interface AgentAsToolConfig {
  /** Tool ID (sent to the LLM). */
  readonly id: string;
  /** Tool description (sent to the LLM). */
  readonly description: string;
  /** The runner to delegate to. */
  readonly runner: RunnerLike;
  /** Input schema override. Defaults to `{ message: string }`. */
  readonly inputSchema?: Record<string, unknown>;
  /** Extract the message from tool input. Defaults to `input.message`. */
  readonly inputMapper?: (input: Record<string, unknown>) => string;
  /** AbortSignal propagation. */
  readonly signal?: AbortSignal;
  /** Timeout for the runner. */
  readonly timeoutMs?: number;
}

const DEFAULT_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'The message to send to the agent.' },
  },
  required: ['message'],
};

export function agentAsTool(config: AgentAsToolConfig): ToolDefinition {
  const {
    id,
    description,
    runner,
    inputSchema = DEFAULT_INPUT_SCHEMA,
    inputMapper = (input) => (input.message as string) ?? '',
    signal,
    timeoutMs,
  } = config;

  return {
    id,
    description,
    inputSchema,
    handler: async (input: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const message = inputMapper(input);
        const result = await runner.run(message, { signal, timeoutMs });
        return { content: result.content };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Agent error: ${msg}`, error: true };
      }
    },
  };
}
