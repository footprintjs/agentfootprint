/**
 * Swarm — LLM-driven routing between specialists. An orchestrator agent
 * reads each request and delegates to the right specialist via tool-calling.
 *
 * Differs from Conditional (static predicates) — the LLM decides routing
 * at runtime by calling a specialist-as-tool.
 */

import { Swarm, LLMCall, mock } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'concepts/07-swarm',
  title: 'Swarm — LLM-routed specialists',
  group: 'concepts',
  description: 'An orchestrator agent delegates to specialist runners via tool-calling.',
  defaultInput: 'I need a refund for my last bill.',
  providerSlots: ['default'],
  tags: ['Swarm', 'multi-agent', 'routing'],
};

const defaultMock = (): LLMProvider =>
  mock([
    {
      content: 'Routing to billing.',
      toolCalls: [
        {
          id: 'tc1',
          name: 'delegate_billing',
          arguments: { task: 'Process refund request' },
        },
      ],
    },
    { content: 'The billing team has processed your refund.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const obs = agentObservability();
  const p = provider ?? defaultMock();

  const billing = LLMCall.create({
    provider: mock([
      { content: 'Your refund of $50 has been processed. It will appear in 3-5 business days.' },
    ]),
  })
    .system('Handle billing inquiries.')
    .build();

  const technical = LLMCall.create({
    provider: mock([{ content: 'Please try restarting your router.' }]),
  })
    .system('Handle technical issues.')
    .build();

  const runner = Swarm.create({ provider: p, name: 'support-swarm' })
    .system('Route customer requests to the appropriate specialist.')
    .specialist('billing', 'Handles billing and payment issues', billing)
    .specialist('technical', 'Handles technical support', technical)
    .recorder(obs)
    .build();

  const result = await runner.run(input);
  return {
    content: result.content,
    tokens: obs.tokens(),
    tools: obs.tools(),
    cost: obs.cost(),
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
