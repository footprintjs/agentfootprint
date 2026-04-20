/**
 * ToolProvider — register, list, and retrieve tools via ToolRegistry.
 *
 * The registry is independent of any agent — the same tool definitions
 * can be passed to staticTools, dynamicTools, agentAsTool, or your own
 * custom ToolProvider implementation.
 */

import { defineTool, ToolRegistry } from 'agentfootprint';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'providers/03-tool',
  title: 'ToolProvider — registry pattern',
  group: 'providers',
  description: 'Register, list, and retrieve tools via ToolRegistry.',
  defaultInput: '',
  providerSlots: [],
  tags: ['ToolProvider', 'providers', 'defineTool'],
};

export async function run(_input: string, _provider?: LLMProvider) {
  const registry = new ToolRegistry();

  registry.register(
    defineTool({
      id: 'calculator',
      description: 'Evaluate math expressions',
      inputSchema: { type: 'object', properties: { expr: { type: 'string' } } },
      handler: async ({ expr }: { expr: string }) => ({ content: `calculated: ${expr}` }),
    }),
  );

  registry.register(
    defineTool({
      id: 'weather',
      description: 'Get current weather',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      handler: async ({ city }: { city: string }) => ({ content: `72°F sunny in ${city}` }),
    }),
  );

  return {
    tools: registry.all().map((t) => t.id),
    count: registry.all().length,
    hasCalculator: registry.get('calculator') !== undefined,
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
