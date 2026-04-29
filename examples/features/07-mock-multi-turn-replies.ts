/**
 * 07 — Mock provider with scripted multi-turn replies for $0 testing.
 *
 * `mock({ replies })` lets you script EXACT agent behavior — iteration
 * 1 calls a tool, iteration 2 returns the final answer. The mock
 * advances through the array on each `complete()` call. When the
 * script is exhausted, it throws loud (so a misnumbered script fails
 * the test instead of silently looping).
 *
 * Use this for:
 *   - Testing tool-using ReAct loops without API cost
 *   - Snapshotting deterministic agent runs in CI
 *   - Demoing agent flows where the LLM behavior must be exact
 */

import { Agent, defineTool, mock, type LLMProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/07-mock-multi-turn-replies',
  title: 'Mock — scripted multi-turn replies (deterministic ReAct)',
  group: 'features',
  description:
    'mock({ replies: [...] }) drives a tool-using ReAct loop with exact, ' +
    'deterministic LLM responses. Zero API cost, fully reproducible.',
  defaultInput: 'How long do refunds take?',
  providerSlots: ['default'],
  tags: ['mock', 'testing', 'react', 'tool-use', 'deterministic'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  let lookupCalls = 0;

  const lookup = defineTool<{ topic: string }, string>({
    name: 'lookup',
    description: 'Look up a fact in the docs corpus.',
    inputSchema: {
      type: 'object',
      properties: { topic: { type: 'string' } },
      required: ['topic'],
    },
    execute: async ({ topic }) => {
      lookupCalls++;
      return topic === 'refunds'
        ? 'Refunds are processed within 3 business days.'
        : 'No data.';
    },
  });

  // Scripted LLM behavior:
  //   iteration 1 — decide to call `lookup` with { topic: 'refunds' }
  //   iteration 2 — produce the final answer using the tool result
  const scriptedProvider =
    provider ??
    mock({
      replies: [
        {
          toolCalls: [
            {
              id: 'call-1',
              name: 'lookup',
              args: { topic: 'refunds' } as Record<string, unknown>,
            },
          ],
        },
        { content: 'Refunds take 3 business days.' },
      ],
    });

  const agent = Agent.create({
    provider: scriptedProvider,
    model: 'mock',
    maxIterations: 5,
  })
    .system('Answer questions using the lookup tool.')
    .tool(lookup)
    .build();

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  // Sanity proof: the tool was actually invoked (script ran end-to-end).
  if (lookupCalls === 0) {
    throw new Error('Mock script did not trigger the tool — check the replies array.');
  }
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
