/**
 * ExplainRecorder — per-iteration grounding evidence. Captures sources
 * (tool results), claims (LLM responses), and decisions (tool calls)
 * during traversal, indexed by runtimeStageId. No post-processing.
 *
 * This is the recorder the README pitches as the differentiator:
 * every LLM claim can be traced back to the tool result that supports it.
 */

import { Agent, mock, defineTool } from 'agentfootprint';
import { ExplainRecorder } from 'agentfootprint/observe';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'observability/02-explain',
  title: 'ExplainRecorder — grounding evidence',
  group: 'observability',
  description: 'Per-iteration sources, claims, decisions — the grounding audit trail.',
  defaultInput: 'Check order ORD-1003',
  providerSlots: ['default'],
  tags: ['observability', 'explain', 'grounding'],
};

const lookupOrder = defineTool({
  id: 'lookup_order',
  description: 'Look up an order by ID.',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
  handler: async (input) => ({
    content: JSON.stringify({
      orderId: (input as Record<string, string>).orderId,
      status: 'shipped',
      amount: 299,
    }),
  }),
});

const defaultMock = (): LLMProvider =>
  mock([
    { content: '', toolCalls: [{ id: 'tc1', name: 'lookup_order', arguments: { orderId: 'ORD-1003' } }] },
    { content: 'Your order ORD-1003 has shipped. Total: $299.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const explain = new ExplainRecorder();

  const agent = Agent.create({ provider: provider ?? defaultMock() })
    .system('You are a support agent.')
    .tool(lookupOrder)
    .recorder(explain)
    .build();

  await agent.run(input);

  const report = explain.explain();
  return {
    iterations: report.iterations.length,
    sources: report.sources.length,
    claims: report.claims.length,
    decisions: report.decisions.length,
    summary: report.summary,
    firstSource: report.sources[0],
    firstClaim: report.claims[0]?.content,
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
