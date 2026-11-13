import type { Tool, ToolRegistryEntry } from '../../../../tools/tools.js';
import type { RecipeSource } from '../../../../recipes/provenance.js';

export interface ToolRegistrationPort {
  readonly registry: ToolRegistryEntry[];
  readonly toolSources: Map<string, RecipeSource>;
  duplicateRefusal(
    what: 'tool name' | 'injection id',
    name: string,
    sources: ReadonlyMap<string, RecipeSource>,
    callSite: string,
  ): string;
  currentSource(): RecipeSource;
}

export function registerTool<TArgs, TResult>(
  self: ToolRegistrationPort,
  tool: Tool<TArgs, TResult>,
  original: object,
): object {
  const name = tool.schema.name;
  if (self.registry.some((e) => e.name === name)) {
    throw new Error(self.duplicateRefusal('tool name', name, self.toolSources, 'Agent.tool()'));
  }
  self.registry.push({ name, tool: tool as unknown as Tool });
  self.toolSources.set(name, self.currentSource());
  return original;
}
