/**
 * askHuman — Built-in tool that pauses the agent loop for human input.
 *
 * When the LLM calls this tool, the agent loop pauses and creates a checkpoint.
 * The human's response is provided via agent.resume(), which continues the loop
 * with the answer as the tool result.
 *
 * @example
 * ```typescript
 * const agent = Agent.create({ provider })
 *   .system('You are helpful. Use ask_human when you need clarification.')
 *   .tool(askHuman())
 *   .build();
 *
 * const result = await agent.run('Process my refund');
 * if (result.paused) {
 *   console.log(result.pauseData.question); // "What is your order ID?"
 *   const final = await agent.resume('ORD-123');
 * }
 * ```
 */

import type { ToolDefinition, ToolResult } from '../types/tools';

/** Marker on ToolResult indicating this is an ask_human pause. Not globally reachable — only importable from this module. */
export const ASK_HUMAN_MARKER = Symbol('askHuman');

export interface AskHumanResult extends ToolResult {
  /** @internal Marker for pause detection in tool execution stage. */
  readonly [ASK_HUMAN_MARKER]: true;
  /** The question asked by the LLM. */
  readonly question: string;
}

/** Check if a tool result is an ask_human pause. */
export function isAskHumanResult(result: ToolResult): result is AskHumanResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    Object.getOwnPropertySymbols(result).includes(ASK_HUMAN_MARKER) &&
    (result as unknown as Record<symbol, unknown>)[ASK_HUMAN_MARKER] === true
  );
}

/**
 * Create the ask_human tool definition.
 *
 * @param description - Custom description for the LLM (optional).
 */
export function askHuman(description?: string): ToolDefinition {
  return {
    id: 'ask_human',
    description:
      description ??
      'Ask the human user a question. Use this when you need clarification, approval, or any input from the user before proceeding.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the human.',
        },
      },
      required: ['question'],
    },
    handler: async (input: Record<string, unknown>): Promise<AskHumanResult> => {
      const question = String(input.question ?? '');
      // Return a marked result — the tool execution stage detects this and pauses.
      // The content is a placeholder; it gets replaced with the human's actual response on resume.
      return {
        content: `[Waiting for human response to: "${question}"]`,
        question,
        [ASK_HUMAN_MARKER]: true,
      };
    },
  };
}
