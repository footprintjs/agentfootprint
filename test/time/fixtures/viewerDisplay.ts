import {
  Agent,
  absent,
  defineTool,
  englishTimeReader,
  pauseHere,
  type AgentInput,
} from '../../../src/index.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';

export const from = '2026-11-13T11:00:00Z';
export const to = '2026-11-13T13:00:00Z';
export const LA = 'America/Los_Angeles';
export const NY = 'America/New_York';
export const args = { from, to };
export type Mode = 'classic' | 'dynamic' | 'dynamic-grouped';

export function fixture(
  mode: Mode = 'dynamic',
  armed = true,
  options: {
    pause?: boolean;
    resume?: boolean;
    reader?: boolean;
    unknownZone?: boolean;
    missingArgs?: boolean;
    failAfterTool?: boolean;
  } = {},
) {
  const requests: LLMRequest[] = [];
  const calls: unknown[] = [];
  const tool = defineTool({
    name: 'read_window',
    description: 'Read the exact UTC window.',
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
    },
    askOrAssume: { from: { ask: 'From when?' }, to: { ask: 'Until when?' } },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'from', as: 'iso' },
          to: { argument: 'to', as: 'iso', edge: 'exclusive' },
        },
      ],
    },
    execute(value) {
      calls.push({ ...value });
      if (options.pause) return pauseHere({ question: 'Continue the fixture?' });
      return absent({
        what: 'matching rows',
        checked: ['synthetic fixture'],
        period: {
          queried: { from, to },
          held: { from, to },
          readAt: '2026-11-13T14:00:00Z',
        },
      });
    },
  });
  let builder = Agent.create({
    model: 'mock',
    reactMode: mode,
    provider: {
      name: 'viewer-display-fixture',
      async complete(request) {
        requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
        if (options.failAfterTool && requests.length === 2)
          throw Error('synthetic provider failure');
        return {
          content: !options.resume && requests.length === 1 ? '' : 'Done.',
          toolCalls:
            !options.resume && requests.length === 1
              ? [{ id: 'read', name: 'read_window', args: options.missingArgs ? {} : args }]
              : [],
          usage: { input: 0, output: 0 },
        };
      },
    },
  })
    .tool(tool)
    .limitsTravelWithTheAnswer();
  if (armed)
    builder = builder.time({
      ...(!options.unknownZone && { zone: LA }),
      ...(options.reader && { reader: englishTimeReader() }),
    });
  return { agent: builder.build(), requests, calls };
}
export function input(timeDisplay?: unknown): AgentInput {
  return {
    message: 'Read the selected window.',
    time: {
      now: '2026-11-13T14:00:00Z',
      window: { from, to, end: 'exclusive', precision: 'minute' },
    },
    ...(timeDisplay !== undefined && { timeDisplay }),
  } as AgentInput;
}
