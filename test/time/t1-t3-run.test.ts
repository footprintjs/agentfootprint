import { describe, expect, it } from 'vitest';

import {
  Agent,
  isInputPause,
  isPaused,
  type PeriodForm,
  type TimeReader,
} from '../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';
import { rulerBounds, rulerTool } from './fixtures/rulerTool.js';

const now = '2026-11-13T20:00:00Z';
const phrase = 'last 2 hours';
const relative = { kind: 'lookback', argument: 'window', signed: false } as const;
const reader: TimeReader = {
  id: 'ruler-clock-fixture',
  version: '1',
  kind: 'model',
  locale: 'en-US',
  read: () => ({
    mentions: [{ quote: phrase, parses: [{ relative: { unit: 'hour', count: 2 } }] }],
  }),
};

function fixture(
  forms: readonly PeriodForm[],
  raw: Record<string, unknown> = {},
  readTime: boolean | TimeReader['kind'] = true,
  commitValues: 'full' | 'delta' = 'delta',
) {
  const calls: Readonly<Record<string, unknown>>[] = [];
  const requests: LLMRequest[] = [];
  const provider = {
    name: 'ruler-script',
    async complete(request: LLMRequest): Promise<LLMResponse> {
      requests.push(request);
      return {
        content: requests.length === 1 ? '' : 'done',
        toolCalls: requests.length === 1 ? [{ id: 'call', name: 'ruler', args: raw }] : [],
        usage: { input: 0, output: 0 },
      };
    },
  };
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 4, commitValues })
    .time({
      zone: 'America/Los_Angeles',
      ...(readTime && {
        reader: { ...reader, kind: typeof readTime === 'string' ? readTime : reader.kind },
      }),
    })
    .tool(rulerTool({ period: { forms, granularity: '1m' }, onCall: (args) => calls.push(args) }))
    .build();
  return {
    agent,
    calls,
    rows(): string[] {
      const result = requests[1]?.messages.find((message) => message.role === 'tool');
      if (typeof result?.content !== 'string') throw new Error('Expected a ruler tool result');
      return JSON.parse(result.content.split('\n', 1)[0]) as string[];
    },
  };
}

describe('the native time path with a frozen clock and the ruler tool', () => {
  const absolute = { from: '2026-11-13T18:00:00Z', to: now };
  it.each([
    { forms: [relative, rulerBounds], raw: {} },
    { forms: [rulerBounds, relative], raw: {} },
    { forms: [relative, rulerBounds], raw: { window: '2h' } },
  ])('dispatches only frozen absolute bounds', async ({ forms, raw }) => {
    const f = fixture(forms, raw);
    expect(isPaused(await f.agent.run({ message: phrase, time: { now } }))).toBe(false);
    expect(f.calls).toEqual([absolute]);
    const rows = f.rows();
    expect([rows[0], rows.at(-1)]).toEqual(['R-2026-11-13T18:00Z', 'R-2026-11-13T19:59Z']);
  });

  it.each([
    { forms: [relative], raw: {} },
    { forms: [relative, rulerBounds], raw: { window: '3h' } },
    {
      forms: [relative, rulerBounds],
      raw: { window: '2h', from: '2026-11-13T17:00:00Z', to: now },
    },
  ])('does not dispatch unsupported durations', async ({ forms, raw }) => {
    const f = fixture(forms, raw);
    expect(isPaused(await f.agent.run({ message: phrase, time: { now } }))).toBe(false);
    expect(f.calls).toEqual([]);
    expect(f.agent.findings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'call-window', refused: 'no-form-holds' }),
      ]),
    );
  });

  it.each(['full', 'delta'] as const)(
    'keeps the frozen window through %s checkpoint save and resume',
    async (encoding) => {
      const f = fixture([relative, rulerBounds], {}, 'rule', encoding);
      const paused = await f.agent.run({ message: phrase, time: { now } });
      expect(isInputPause(paused)).toBe(true);
      expect(f.calls).toEqual([]);
      if (!isInputPause(paused)) throw new Error('Expected a window confirmation');
      const { requestId, fields } = paused.awaitingInput;
      const choice = fields[0];
      await f.agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), {
        requestId,
        values: { [choice.id]: choice.enum![0] },
      });
      expect(f.calls).toEqual([absolute]);
      const rows = f.rows();
      expect([rows[0], rows.at(-1)]).toEqual(['R-2026-11-13T18:00Z', 'R-2026-11-13T19:59Z']);
      const saved = JSON.parse(JSON.stringify(f.agent.getSnapshot()));
      expect(saved.commitValues).toBe(encoding);
      expect(saved.sharedState.findingsLedger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'time-answer',
            from: absolute.from,
            to: now,
            endpoint: { cutoff: now, end: 'exclusive', precision: 'second' },
          }),
        ]),
      );
    },
  );

  it.each([
    { end: 'exclusive' as const, sent: '2026-11-13T18:45:00Z', last: 'R-2026-11-13T18:44Z' },
    {
      end: 'inclusive' as const,
      sent: '2026-11-13T18:45:00.000000001Z',
      last: 'R-2026-11-13T18:45Z',
    },
  ])('preserves a control cutoff with $end membership', async ({ end, sent, last }) => {
    const f = fixture([rulerBounds], {}, false);
    const cutoff = '2026-11-13T18:45:00Z';
    expect(
      isPaused(
        await f.agent.run({
          message: 'Read the selected window',
          time: { now, window: { from: absolute.from, to: cutoff, end, precision: 'minute' } },
        }),
      ),
    ).toBe(false);
    expect(f.calls).toEqual([{ from: absolute.from, to: sent }]);
    const rows = f.rows();
    expect([rows[0], rows.at(-1)]).toEqual(['R-2026-11-13T18:00Z', last]);
    expect(f.agent.findings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'clock',
          window: expect.objectContaining({
            endpoint: { cutoff, end, precision: 'minute' },
          }),
        }),
      ]),
    );
  });
});
