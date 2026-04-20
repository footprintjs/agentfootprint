/**
 * LLMCall — the simplest concept. One prompt in, one response out.
 *
 * No tools, no loop. This is the rung your mental model starts on; every
 * other concept in the ladder adds something to this shape.
 */

import { LLMCall, mock } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'concepts/01-llm-call',
  title: 'LLMCall — single invocation',
  group: 'concepts',
  description: 'The simplest concept: one prompt in, one response out. No tools, no loop.',
  defaultInput: 'Explain AI safety in one sentence.',
  providerSlots: ['default'],
  tags: ['LLMCall', 'concepts', 'getting-started'],
};

const defaultMock = (): LLMProvider =>
  mock([{ content: 'This text discusses AI safety and alignment challenges.' }]);

export async function run(input: string, provider?: LLMProvider) {
  const obs = agentObservability();

  const runner = LLMCall.create({ provider: provider ?? defaultMock() })
    .system('Summarize the following text concisely:')
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
