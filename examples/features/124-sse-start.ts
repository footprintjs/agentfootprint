/**
 * 123 — Keep an SSE stream open through both steps of a Sequence.
 * Run: npm run example examples/features/124-sse-start.ts
 */

import { Agent, Sequence } from '../../src/index.js';
import { toSSE } from '../../src/doors/observe.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/124-sse-start',
  title: 'Bind a stream to one invocation',
  group: 'features',
  description: 'Stream the tokens of both Sequence steps and keep the final answer separately.',
  defaultInput: 'Prepare the report.',
  providerSlots: [],
  tags: ['features', 'streaming', 'composition'],
};

function mockAgent(reply: string): Agent {
  return Agent.create({ provider: mock({ reply, chunkDelayMs: 0 }), model: 'mock' }).build();
}

export async function run(message: string) {
  // #region start-stream
  const runner = Sequence.create()
    .step('draft', mockAgent('The draft is ready. '))
    .step('review', mockAgent('The report is ready.'))
    .build();

  let outcome!: ReturnType<typeof runner.run>;
  let transcript = '';
  for await (const token of toSSE(runner, {
    format: 'text',
    start() {
      outcome = runner.run({ message });
      return outcome;
    },
  })) {
    transcript += token;
  }
  const answer = await outcome;
  // #endregion start-stream
  return { transcript, answer };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
