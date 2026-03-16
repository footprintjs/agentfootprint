/**
 * ToolRegistry — register, lookup, and format tools for LLM function calling.
 */

import type { ToolDefinition, LLMToolDescription } from '../types';

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
 * Convenience: define a tool inline.
 *
 *   const searchTool = defineTool({
 *     id: 'search',
 *     description: 'Search the web',
 *     inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
 *     handler: async ({ query }) => ({ content: `Results for: ${query}` }),
 *   });
 */
export function defineTool(tool: ToolDefinition): ToolDefinition {
  return tool;
}
