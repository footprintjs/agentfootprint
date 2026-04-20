/**
 * FlowChart — sequential pipeline. Runners chained one after another,
 * each consuming the previous one's output.
 *
 *   classify → analyze → respond
 */

import { FlowChart, LLMCall, mock } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'concepts/04-flowchart',
  title: 'FlowChart — sequential pipeline',
  group: 'concepts',
  description: 'Runners chained sequentially; each stage feeds into the next.',
  defaultInput: 'I was overcharged $50 on my bill.',
  providerSlots: ['default'],
  tags: ['FlowChart', 'composition', 'pipeline'],
};

const defaultMock = (): LLMProvider =>
  mock([
    { content: 'Category: billing' },
    { content: 'Analysis: Customer needs refund for overcharge.' },
    { content: 'Dear customer, we have processed your refund of $50.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const obs = agentObservability();
  const p = provider ?? defaultMock();

  const classify = LLMCall.create({ provider: p }).system('Classify this request:').build();
  const analyze = LLMCall.create({ provider: p }).system('Analyze the classified request:').build();
  const respond = LLMCall.create({ provider: p }).system('Generate a customer response:').build();

  const runner = FlowChart.create()
    .agent('classify', 'Classify Request', classify)
    .agent('analyze', 'Analyze Request', analyze)
    .agent('respond', 'Generate Response', respond)
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
