/**
 * Tool definitions for agent function calling.
 */

export interface ToolDefinition {
  /** Unique tool identifier. */
  readonly id: string;
  /** Human-readable description (sent to LLM). */
  readonly description: string;
  /** JSON Schema for tool input. */
  readonly inputSchema: Record<string, unknown>;
  /** Handler function. Returns string result. */
  readonly handler: ToolHandler;
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult> | ToolResult;

export interface ToolResult {
  readonly content: string;
  readonly error?: boolean;
}
