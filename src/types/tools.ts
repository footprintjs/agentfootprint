/**
 * Tool definitions for agent function calling.
 */

/**
 * Duck-typed shape for a Zod schema. Kept minimal so consumers can pass a
 * Zod v3 schema without a type-level zod dependency. `defineTool()` detects
 * Zod at runtime via `_def` + `safeParse` and auto-converts to JSON Schema
 * via `zodToJsonSchema()` before returning.
 */
export interface ZodSchemaLike {
  readonly _def: unknown;
  readonly safeParse: (input: unknown) => unknown;
}

export interface ToolDefinition {
  /** Unique tool identifier. */
  readonly id: string;
  /** Human-readable description (sent to LLM). */
  readonly description: string;
  /**
   * JSON Schema for tool input. Always a plain object by the time a
   * `ToolDefinition` flows through the library; Zod is accepted only at
   * `defineTool()` construction time and converted eagerly.
   */
  readonly inputSchema: Record<string, unknown>;
  /** Handler function. Receives parsed LLM arguments. */
  readonly handler: ToolHandler;
}

/**
 * Shape accepted by `defineTool()` — like `ToolDefinition` but `inputSchema`
 * may additionally be a Zod schema. Separate from `ToolDefinition` so types
 * downstream of `defineTool()` stay narrow.
 */
export interface ToolDefinitionInput {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown> | ZodSchemaLike;
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
