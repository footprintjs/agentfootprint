/**
 * ToolRegistry — register, lookup, and format tools for LLM function calling.
 */

import type { ToolDefinition, LLMToolDescription } from '../types';
import { zodToJsonSchema, isZodSchema } from './zodToJsonSchema';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  /** Register a tool. Throws if ID already registered. */
  register(tool: ToolDefinition): this {
    if (this.tools.has(tool.id)) {
      throw new Error(`ToolRegistry: tool '${tool.id}' already registered`);
    }
    this.tools.set(tool.id, tool);
    return this;
  }

  /**
   * Remove a tool by ID. Silently no-ops when the tool isn't registered
   * so callers can call safely before a re-registration.
   *
   * Intended for builder-layer idempotent replace flows (e.g.
   * `AgentBuilder.skills(registry)` re-mounting skill tools) — NOT for
   * runtime tool hot-removal, which would require coordinating with the
   * LLM's recency window.
   */
  unregister(id: string): this {
    this.tools.delete(id);
    return this;
  }

  /** Get a tool by ID. */
  get(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  /** Check if a tool is registered. */
  has(id: string): boolean {
    return this.tools.has(id);
  }

  /** Get all registered tool IDs. */
  ids(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Get all registered tools. */
  all(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Format tools for LLM function calling (OpenAI-compatible schema). */
  formatForLLM(toolIds?: string[]): LLMToolDescription[] {
    const tools = toolIds
      ? toolIds.map((id) => {
          const tool = this.tools.get(id);
          if (!tool) throw new Error(`ToolRegistry: tool '${id}' not found`);
          return tool;
        })
      : this.all();

    return tools.map((tool) => ({
      name: tool.id,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /** Number of registered tools. */
  get size(): number {
    return this.tools.size;
  }
}

/**
 * Define a tool inline. Accepts JSON Schema or Zod schema for `inputSchema`.
 *
 * @example JSON Schema
 * ```typescript
 * defineTool({
 *   id: 'search',
 *   description: 'Search the web',
 *   inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
 *   handler: async ({ query }) => ({ content: `Results for: ${query}` }),
 * });
 * ```
 *
 * @example Zod schema (auto-converted, no zod dependency in core)
 * ```typescript
 * import { z } from 'zod';
 * defineTool({
 *   id: 'search',
 *   description: 'Search the web',
 *   inputSchema: z.object({ query: z.string().describe('Search query') }),
 *   handler: async ({ query }) => ({ content: `Results for: ${query}` }),
 * });
 * ```
 */
export function defineTool(tool: ToolDefinition): ToolDefinition {
  const schema = tool.inputSchema;

  // Duck-type Zod detection: Zod schemas have ._def and .safeParse
  if (isZodSchema(schema)) {
    return { ...tool, inputSchema: zodToJsonSchema(schema as any) };
  }

  return tool;
}
