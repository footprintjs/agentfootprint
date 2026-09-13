/** Typed input collection (9.97.0). Mock only: no API key or external data. */
import { Agent, defineTool, isInputPause, requestInput } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/70-typed-input',
  title: 'Collect typed inputs without losing the request',
  group: 'features',
  description:
    'A partial reply updates the checkpoint without a model call; the full reply resumes the original collection tool.',
  defaultInput: 'Inspect the requested window.',
  providerSlots: [],
  tags: ['features', 'pause', 'resume', 'input'],
};

export async function run(input: string): Promise<unknown> {
  let modelCalls = 0;
  let collections = 0;
  const provider = mock({
    respond(request) {
      modelCalls++;
      if (modelCalls === 1)
        return { toolCalls: [{ id: 'collect-1', name: 'collect_window', args: {} }] };
      const result = request.messages.find((message) => message.role === 'tool');
      const received = JSON.parse(result?.content ?? '{}') as {
        status: string;
        values: { year: number; timezone: string };
      };
      if (
        received.status !== 'input_received' ||
        received.values.year !== 2026 ||
        received.values.timezone !== 'UTC'
      )
        throw new Error('The collected values did not reach the original tool result.');
      return 'The inputs are ready for the query.';
    },
  });
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(
      defineTool({
        name: 'collect_window',
        description: 'Collect the missing year and timezone.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => {
          collections++;
          return requestInput({
            id: 'query-window',
            question: 'Which year and timezone?',
            fields: [
              { id: 'year', type: 'number' },
              { id: 'timezone', type: 'string', description: 'An IANA timezone or UTC.' },
            ],
            context: { operation: 'query_records' },
          });
        },
      }),
    )
    .build();
  const first = await agent.run({ message: input });
  if (!isInputPause(first)) throw new Error('Expected a typed input pause.');
  const partial = await agent.resume(first.checkpoint, {
    requestId: first.awaitingInput.requestId,
    values: { year: 2026 },
  });
  if (
    !isInputPause(partial) ||
    modelCalls !== 1 ||
    partial.awaitingInput.missing.join(',') !== 'timezone'
  )
    throw new Error('Partial input must stay paused without calling the model.');
  const answer = await agent.resume(partial.checkpoint, {
    requestId: partial.awaitingInput.requestId,
    values: { timezone: 'UTC' },
  });
  if (Number(modelCalls) !== 2 || collections !== 1)
    throw new Error('The collecting tool must run once.');
  return {
    answer,
    modelCalls,
    collections,
    originalRequest: partial.awaitingInput.origin.originalRequest,
  };
}

if (isCliEntry(import.meta.url))
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
