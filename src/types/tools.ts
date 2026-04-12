/**
 * Tool definitions for agent function calling.
 */

export interface ToolDefinition {
  /** Unique tool identifier. */
  readonly id: string;
  /** Human-readable description (sent to LLM). */
  readonly description: string;
  /** JSON Schema for tool input (plain object or Zod schema). */
  readonly inputSchema: Record<string, unknown>;
  /** Handler function. Receives parsed LLM arguments. */
  readonly handler: ToolHandler;
}

/**
 * Tool handler function.
 *
 * Input is typed as `any` to allow destructured typed parameters
 * in tool definitions. The runtime input is always a parsed JSON object
 * from the LLM's tool call arguments.
 *
 * @example
 * ```typescript
 * // Destructure directly — the common pattern:
 * handler: async ({ query }: { query: string }) => ({ content: `Results for: ${query}` })
 *
 * // Or use the raw input:
 * handler: async (input) => ({ content: `${input.query}` })
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolHandler = (input: any) => Promise<ToolResult> | ToolResult;

export interface ToolResult {
  readonly content: string;
  readonly error?: boolean;
}
