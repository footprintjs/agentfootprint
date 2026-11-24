import { expect, it, vi } from 'vitest';
import {
  Agent,
  RunCheckpointError,
  checkInApproved,
  defineTool,
  isCheckInPause,
} from '../../src/index.js';
import { clockOf } from '../../src/time/rows.js';

const window = { from: '2026-11-13T10:00:00Z', to: '2026-11-13T12:00:00Z' };
const tools = ['north', 'south'];
const time = { now: '2026-11-13T15:00:00Z', window, comparison: { tools } };
const unavailable = /Resume requires \.time\(\) for the active comparison/;

function make(
  options: {
    readonly time?: boolean;
    readonly crashes?: boolean;
    readonly finishSouth?: boolean;
  } = {},
) {
  const execute = vi.fn((_args: Record<string, unknown>) => 'One row.');
  let completed = 0;
  const complete = vi.fn(
    async (request: import('../../src/provider-contract/types.js').LLMRequest) => {
      const hasResult = request.messages.some(({ role }) => role === 'tool');
      if (hasResult && options.crashes) throw new Error('Offline fixture interrupted');
      const south = options.finishSouth && completed === 0;
      completed += 1;
      const ask = south || !hasResult;
      return {
        content: ask ? '' : 'Done.',
        toolCalls: !ask
          ? []
          : [
              {
                id: south ? 'later-read' : 'read',
                name: south ? 'south' : 'north',
                args: south ? { ...window, to: '2026-11-13T11:00:00Z' } : { ...window },
              },
            ],
        usage: { input: 0, output: 0 },
      };
    },
  );
  const builder = Agent.create({
    model: 'mock',
    provider: { name: 'comparison-restore', complete },
  }).answerLayer(false);
  if (options.time) builder.time({ zone: 'UTC' });
  for (const name of tools) {
    builder.tool(
      defineTool({
        name,
        description: 'Read a synthetic directory.',
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
        ...(!options.crashes && !options.finishSouth && { checkIn: 'always' as const }),
        execute,
      }),
    );
  }
  return { agent: builder.build(), complete, execute };
}

async function crashedComparison(): Promise<RunCheckpointError['checkpoint']> {
  const original = make({ time: true, crashes: true });
  try {
    await original.agent.run({ message: 'Compare both sources.', time });
  } catch (error) {
    if (!(error instanceof RunCheckpointError)) throw error;
    expect(original.execute).toHaveBeenCalledTimes(1);
    return JSON.parse(JSON.stringify(error.checkpoint));
  }
  throw new Error('Expected a failed comparison checkpoint');
}

it('refuses a saved active comparison before a fresh runtime without time can use the answer', async () => {
  const original = make({ time: true });
  const paused = await original.agent.run({ message: 'Compare both sources.', time });
  if (!isCheckInPause(paused)) throw new Error('Expected a tool approval pause');
  const saved: typeof paused.checkpoint = JSON.parse(JSON.stringify(paused.checkpoint));
  const answer = checkInApproved({ request: paused.checkIn, by: 'person' });
  const withoutTime = make();
  await expect(withoutTime.agent.resume(saved, answer)).rejects.toThrow(unavailable);
  expect(withoutTime.complete).not.toHaveBeenCalled();
  expect(withoutTime.execute).not.toHaveBeenCalled();
  const withTime = make({ time: true });
  await expect(withTime.agent.resume(saved, answer)).resolves.toBe('Done.');
  expect(withTime.execute).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'keeps ordinary saved approvals usable on a fresh agent (time %s)',
  async (hadTime) => {
    const original = make({ time: hadTime });
    const paused = await original.agent.run({
      message: 'Read north.',
      ...(hadTime && { time: { now: time.now, window } }),
    });
    if (!isCheckInPause(paused)) throw new Error('Expected a tool approval pause');
    const saved: typeof paused.checkpoint = JSON.parse(JSON.stringify(paused.checkpoint));
    const fresh = make();
    await expect(
      fresh.agent.resume(saved, checkInApproved({ request: paused.checkIn, by: 'person' })),
    ).resolves.toBe('Done.');
    expect(fresh.execute).toHaveBeenCalledTimes(1);
  },
);

it('refuses crash recovery without time and permits a new turn from the same evidence', async () => {
  const saved = await crashedComparison();
  const recovered = make();
  await expect(recovered.agent.resumeOnError(saved)).rejects.toThrow(unavailable);
  expect(recovered.complete).not.toHaveBeenCalled();
  expect(recovered.execute).not.toHaveBeenCalled();
  await recovered.agent.run({ message: 'Start a new turn.', continueFrom: saved });
  expect(recovered.complete).toHaveBeenCalledTimes(1);
});

it('uses the original scope and exact bounds when a compatible runtime recovers the same turn', async () => {
  const saved = await crashedComparison();
  const before = clockOf(saved.findingsLedger);
  expect(before?.comparison).toEqual({ tools });
  const recovered = make({ time: true, finishSouth: true });
  const changedEnd = '2026-11-13T13:00:00Z';
  await expect(
    recovered.agent.resumeOnError(saved, {
      time: { ...time, window: { ...window, to: changedEnd } },
    }),
  ).resolves.toBe('Done.');
  expect(recovered.execute).toHaveBeenCalledTimes(1);
  expect(recovered.execute.mock.calls[0]?.[0]).toEqual(window);
  const after = clockOf(recovered.agent.getLastSnapshot()?.sharedState.findingsLedger);
  expect(after).toEqual(before);
});
