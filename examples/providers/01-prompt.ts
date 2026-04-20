/**
 * PromptProvider — system prompt strategies. Different prompts per
 * runner, same input, different behavior.
 */

import { LLMCall, mock } from 'agentfootprint';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'providers/01-prompt',
  title: 'PromptProvider strategies',
  group: 'providers',
  description: 'Different system prompts per runner — same input, different behavior.',
  defaultInput: 'AI is transforming the world.',
  providerSlots: ['default'],
  tags: ['PromptProvider', 'providers'],
};

const defaultMock = (): LLMProvider =>
  mock([
    { content: 'This is a concise summary of the input.' },
    { content: 'Ceci est une traduction en francais.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const p = provider ?? defaultMock();

  const summarizer = LLMCall.create({ provider: p })
    .system('You are a summarizer. Be concise.')
    .build();

  const translator = LLMCall.create({ provider: p })
    .system('You are a translator. Translate to French.')
    .build();

  const r1 = await summarizer.run(input);
  const r2 = await translator.run(input);

  return { summary: r1.content, translation: r2.content };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
