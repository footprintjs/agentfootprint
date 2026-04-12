/**
 * Sample 06: Tool Strategies
 *
 * ToolRegistry + defineTool — register, list, and retrieve tools.
 */
import { defineTool, ToolRegistry } from 'agentfootprint';

export async function run(_input: string) {
  const registry = new ToolRegistry();

  registry.register(defineTool({
    id: 'calculator',
    description: 'Evaluate math expressions',
    inputSchema: { type: 'object', properties: { expr: { type: 'string' } } },
    handler: async ({ expr }: { expr: string }) => ({ content: 'calculated: ' + expr }),
  }));

  registry.register(defineTool({
    id: 'weather',
    description: 'Get current weather',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
    handler: async ({ city }: { city: string }) => ({ content: `72°F sunny in ${city}` }),
  }));

  return {
    tools: registry.all().map(t => t.id),
    count: registry.all().length,
    hasCalculator: registry.get('calculator') !== undefined,
  };
}

if (process.argv[1] === import.meta.filename) {
  run('').then(console.log);
}
