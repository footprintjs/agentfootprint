/**
 * 01 — LLMCall: the one-shot LLM primitive.
 *
 * `LLMCall` is the atomic "ask the model once" primitive. It composes
 * into any Sequence/Parallel/Conditional/Loop and emits the same
 * `agentfootprint.stream.llm_start` / `llm_end` events an Agent does.
 */

import {
  LLMCall,
  MockProvider,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'core/01-llm-call',
  title: 'LLMCall — one-shot LLM primitive',
  group: 'core',
  description:
    'The atomic "ask the model once" primitive — composes into every ' +
    'Sequence/Parallel/Conditional/Loop and emits stream.llm_* events.',
  defaultInput: 'Weather in SF?',
  providerSlots: ['default'],
  tags: ['primitive', 'LLMCall', 'stream'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // #region build
  const llm = LLMCall.create({
    provider: provider ?? exampleProvider('core', { reply: "It's sunny in San Francisco." }),
    model: 'mock-weather',
    temperature: 0.2,
  })
    .system('You are a terse weather assistant. One sentence answers.')
    .build();
  // #endregion build

  llm.on('agentfootprint.stream.llm_start', (e) =>
    console.log(`→ calling ${e.payload.provider}/${e.payload.model}`),
  );
  llm.on('agentfootprint.stream.llm_end', (e) =>
    console.log(
      `← ${e.payload.usage.input + e.payload.usage.output} tokens in ${e.payload.durationMs}ms`,
    ),
  );

  const result = await llm.run({ message: input });
  if (typeof result !== 'string') {
    throw new Error('LLMCall paused unexpectedly — pause is for Agent tools.');
  }
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
