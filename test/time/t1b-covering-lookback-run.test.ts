/**
 * T1b · a confirmed look-back for a source that takes only a length of time,
 * and the model's own different look-back — through ordinary `Agent.run` /
 * `resume` with the ruler tool and a frozen clock.
 *
 * The ruler names each row for its own UTC minute, so every case asserts what
 * was SENT and the first and last row names that came back — never prose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  isInputPause,
  isPaused,
  type PeriodForm,
  type TimeReader,
  type ToolPeriod,
} from '../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';
import { rulerBounds, rulerTool } from './fixtures/rulerTool.js';

const now = '2026-11-13T20:00:00Z';
const nowMs = Date.parse(now);
const phrase = 'last 2 hours';
const minutes = { kind: 'lookback', argument: 'window', signed: false, units: 'm' } as const;
const hours = { kind: 'lookback', argument: 'window', signed: false, units: 'h' } as const;
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
  period: ToolPeriod | readonly PeriodForm[],
  raw: Record<string, unknown> = {},
  kind: TimeReader['kind'] = 'model',
  sourceNow?: () => string,
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
  const declared: ToolPeriod = Array.isArray(period)
    ? { forms: period as readonly PeriodForm[], granularity: '1m' }
    : (period as ToolPeriod);
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
    .time({ zone: 'America/Los_Angeles', reader: { ...reader, kind } })
    .tool(
      rulerTool({
        period: declared,
        onCall: (args) => calls.push(args),
        ...(sourceNow !== undefined && { sourceNow }),
      }),
    )
    .build();
  const toolMessage = (): string => {
    const result = requests[1]?.messages.find((message) => message.role === 'tool');
    if (typeof result?.content !== 'string') throw new Error('Expected a ruler tool result');
    return result.content;
  };
  return {
    agent,
    calls,
    toolMessage,
    rows: (): string[] => JSON.parse(toolMessage().split('\n', 1)[0] as string) as string[],
    row: (kind: string) =>
      (agent.findings() as readonly { kind: string }[]).filter((entry) => entry.kind === kind),
  };
}

describe('a confirmed look-back for a length-only source', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lengthens the look-back at dispatch to still reach the window start', async () => {
    vi.setSystemTime(nowMs + 61_000);
    const f = fixture([minutes]);
    expect(isPaused(await f.agent.run({ message: phrase, time: { now } }))).toBe(false);
    // 2 h + 61 s from the dispatch moment, rounded up to the form's minute.
    expect(f.calls).toEqual([{ window: '122m' }]);
    const rows = f.rows();
    // The asked rows are 18:00 … 19:59; the read adds the two minutes after the cutoff.
    expect([rows[0], rows.at(-1)]).toEqual(['R-2026-11-13T18:00Z', 'R-2026-11-13T20:01Z']);
    expect(f.row('call-window')).toEqual([
      expect.objectContaining({
        how: 'filled',
        form: 0,
        asked: { from: '2026-11-13T18:00:00Z', to: now },
        coversAtDispatch: true,
        person: expect.not.objectContaining({ frozenLookback: true }),
      }),
    ]);
    const [call] = f.row('call') as unknown as {
      drift: { byMs: number; outcome: string; form: number; sent: { from: string; to: string } };
    }[];
    expect(call?.drift).toMatchObject({ byMs: 61_000, outcome: 'covered', form: 0 });
    expect(Date.parse(call!.drift.sent.from)).toBe(nowMs + 61_000 - 122 * 60_000);
    expect(Date.parse(call!.drift.sent.to)).toBe(nowMs + 61_000 + 1);
  });

  it('tells the model the value that ran, that it reads wider, and whose clock decided it', async () => {
    vi.setSystemTime(nowMs + 61_000);
    const f = fixture([minutes]);
    await f.agent.run({ message: phrase, time: { now } });
    const note = f.toolMessage().split('\n\n').at(-1);
    expect(note).toContain('the call ran with "122m"');
    expect(note).toContain('counted back from its own clock');
    expect(note).toContain("its exact bounds decided by the source's clock");
    // The record says what the read adds on each side of the asked window.
    expect(f.row('period')).toEqual([
      expect.objectContaining({
        differs: expect.objectContaining({
          source: 'sent',
          missing: [],
          extra: [
            { from: '2026-11-13T17:59:01Z', to: '2026-11-13T18:00:00Z' },
            { from: now, to: '2026-11-13T20:01:01.001Z' },
          ],
        }),
      }),
    ]);
  });

  it('sends the window’s own length when the clock has not moved', async () => {
    vi.setSystemTime(nowMs);
    const f = fixture([minutes]);
    await f.agent.run({ message: phrase, time: { now } });
    expect(f.calls).toEqual([{ window: '120m' }]);
    const rows = f.rows();
    // A look-back reads both ends, so the cutoff minute itself comes back: it is said, not hidden.
    expect([rows[0], rows.at(-1)]).toEqual(['R-2026-11-13T18:00Z', 'R-2026-11-13T20:00Z']);
    expect(f.row('call')).toEqual([
      expect.objectContaining({ drift: expect.objectContaining({ byMs: 0, outcome: 'covered' }) }),
    ]);
  });

  it('rounds up to the form’s own unit', async () => {
    vi.setSystemTime(nowMs + 61_000);
    const f = fixture([hours]);
    await f.agent.run({ message: phrase, time: { now } });
    expect(f.calls).toEqual([{ window: '3h' }]);
    expect(f.rows()[0]).toBe('R-2026-11-13T17:02Z');
  });

  it('covers from the resume moment after the person confirms', async () => {
    vi.setSystemTime(nowMs + 1_000);
    const f = fixture([minutes], {}, 'rule');
    const paused = await f.agent.run({ message: phrase, time: { now } });
    if (!isInputPause(paused)) throw new Error('Expected a window confirmation');
    expect(f.calls).toEqual([]);
    const { requestId, fields } = paused.awaitingInput;
    const choice = fields[0]!;
    // The click took ten minutes; the confirmed window did not move.
    vi.setSystemTime(nowMs + 10 * 60_000);
    await f.agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), {
      requestId,
      values: { [choice.id]: choice.enum![0] },
    });
    expect(f.calls).toEqual([{ window: '130m' }]);
    const rows = f.rows();
    expect([rows[0], rows.at(-1)]).toEqual(['R-2026-11-13T18:00Z', 'R-2026-11-13T20:10Z']);
    expect(f.row('time-answer')).toEqual([
      expect.objectContaining({ from: '2026-11-13T18:00:00Z', to: now }),
    ]);
  });

  it('prefers frozen absolute bounds whatever the declared order', async () => {
    vi.setSystemTime(nowMs + 61_000);
    for (const forms of [
      [minutes, rulerBounds],
      [rulerBounds, minutes],
    ]) {
      const f = fixture(forms);
      await f.agent.run({ message: phrase, time: { now } });
      expect(f.calls).toEqual([{ from: '2026-11-13T18:00:00Z', to: now }]);
    }
  });

  it('falls to the look-back when the absolute form’s own cap is too small', async () => {
    vi.setSystemTime(nowMs + 61_000);
    const f = fixture([{ ...rulerBounds, maxRange: '1h' }, minutes]);
    await f.agent.run({ message: phrase, time: { now } });
    expect(f.calls).toEqual([{ window: '122m' }]);
    expect(f.row('call-window')).toEqual([
      expect.objectContaining({ how: 'filled', form: 1, coversAtDispatch: true }),
    ]);
  });

  it('runs at the exact cap and does not run one unit past it', async () => {
    const capped = { ...minutes, maxRange: '2h' } as const;
    vi.setSystemTime(nowMs);
    const exact = fixture([capped]);
    await exact.agent.run({ message: phrase, time: { now } });
    expect(exact.calls).toEqual([{ window: '120m' }]);

    vi.setSystemTime(nowMs + 61_000);
    const over = fixture([capped]);
    await over.agent.run({ message: phrase, time: { now } });
    expect(over.calls).toEqual([]);
    expect(over.toolMessage()).toContain('took a longer look-back than the tool reads');
    expect(over.row('call')).toEqual([]);
  });

  it('does not run while the confirmed window is still running', async () => {
    // The app's clock is ahead of the dispatch moment: a look-back ends at now and cannot reach it.
    vi.setSystemTime(nowMs - 60_000);
    const f = fixture([minutes]);
    await f.agent.run({ message: phrase, time: { now } });
    expect(f.calls).toEqual([]);
    expect(f.toolMessage()).toContain('had not ended when the call was handed over');
  });

  it('marks a tool that trims its rows to the asked window', async () => {
    vi.setSystemTime(nowMs + 61_000);
    const f = fixture({ forms: [minutes], granularity: '1m', filtersToAsked: true });
    await f.agent.run({ message: phrase, time: { now } });
    expect(f.calls).toEqual([{ window: '122m' }]);
    expect(f.row('call-window')).toEqual([
      expect.objectContaining({ coversAtDispatch: true, trimmedByTool: true }),
    ]);
    expect(f.toolMessage()).toContain('drops the rows outside the asked window');
    expect(f.row('period')).toEqual([expect.not.objectContaining({ differs: expect.anything() })]);
  });

  it('covers a confirmed past range from the dispatch moment, not the frozen clock', async () => {
    // The person set 17:00–18:00 in the app; the call is handed over ten minutes after `now`.
    vi.setSystemTime(nowMs + 10 * 60_000);
    const f = fixture([minutes]);
    const window = { from: '2026-11-13T17:00:00Z', to: '2026-11-13T18:00:00Z' };
    await f.agent.run({ message: 'depth', time: { now, window } });
    expect(f.calls).toEqual([{ window: '190m' }]);
    expect(f.rows()[0]).toBe('R-2026-11-13T17:00Z');
    expect(f.row('call-window')).toEqual([
      expect.objectContaining({ how: 'filled', asked: window, coversAtDispatch: true }),
    ]);
    expect(f.row('call')).toEqual([
      expect.objectContaining({
        drift: expect.objectContaining({ byMs: 600_000, outcome: 'covered' }),
      }),
    ]);
  });

  it('lengthens an equivalent look-back the model wrote itself', async () => {
    vi.setSystemTime(nowMs + 61_000);
    const f = fixture([minutes], { window: '120m' });
    await f.agent.run({ message: phrase, time: { now } });
    expect(f.calls).toEqual([{ window: '122m' }]);
  });
});

describe('the model’s own different look-back beside a confirmed one', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(nowMs);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const relative = { kind: 'lookback', argument: 'window', signed: false } as const;

  it.each([
    { name: 'a look-back alone', raw: { window: '3h' } },
    {
      name: 'a look-back and bounds naming the same window',
      raw: { window: '3h', from: '2026-11-13T17:00:00Z', to: now },
    },
  ])('runs as sent and is recorded model-chosen: $name', async ({ raw }) => {
    const f = fixture([relative, rulerBounds], raw);
    expect(isPaused(await f.agent.run({ message: phrase, time: { now } }))).toBe(false);
    expect(f.calls).toEqual([raw]);
    expect(f.rows()[0]).toBe('R-2026-11-13T17:00Z');
    expect(f.row('call-window')).toEqual([
      expect.objectContaining({
        how: 'model-chosen',
        form: 0,
        person: expect.objectContaining({ from: '2026-11-13T18:00:00Z', to: now }),
      }),
    ]);
  });

  it('keeps the interval the model named when the clock moved and the tool takes bounds', async () => {
    vi.setSystemTime(nowMs + 10 * 60_000);
    const f = fixture([relative, rulerBounds], { window: '3h' });
    await f.agent.run({ message: phrase, time: { now } });
    // `3h` on the frozen clock is 17:00 … 20:00 with both ends inside: sent as those bounds.
    expect(f.calls).toEqual([{ from: '2026-11-13T17:00:00Z', to: '2026-11-13T20:00:00.001Z' }]);
    const rows = f.rows();
    expect([rows[0], rows.at(-1)]).toEqual(['R-2026-11-13T17:00Z', 'R-2026-11-13T20:00Z']);
    expect(f.row('call-window')).toEqual([expect.objectContaining({ how: 'model-chosen' })]);
    expect(f.row('call')).toEqual([
      expect.objectContaining({ drift: { byMs: 600_000, outcome: 'redrawn', form: 1 } }),
    ]);
  });

  it('runs the model’s own look-back as sent on a length-only source, recorded shifted', async () => {
    vi.setSystemTime(nowMs + 10 * 60_000);
    const f = fixture([relative], { window: '3h' });
    await f.agent.run({ message: phrase, time: { now } });
    expect(f.calls).toEqual([{ window: '3h' }]);
    expect(f.rows()[0]).toBe('R-2026-11-13T17:10Z');
    expect(f.row('call-window')).toEqual([expect.objectContaining({ how: 'model-chosen' })]);
    expect(f.row('call')).toEqual([
      expect.objectContaining({ drift: { byMs: 600_000, outcome: 'shifted' } }),
    ]);
  });

  it.each([
    {
      name: 'forms naming different windows',
      raw: { window: '2h', from: '2026-11-13T17:00:00Z', to: now },
    },
    { name: 'a look-back no form reads', raw: { window: 'soon' } },
  ])('does not run a call whose own period is unreadable: $name', async ({ raw }) => {
    const f = fixture([relative, rulerBounds], raw);
    await f.agent.run({ message: phrase, time: { now } });
    expect(f.calls).toEqual([]);
    expect(f.row('call-window')).toEqual([
      expect.objectContaining({ how: 'refused', refused: 'no-form-holds' }),
    ]);
  });
});
