/**
 * A form's own `maxRange` (time follow-ups, packet "gaps"): a period could
 * declare ONE `maxRange` for all its forms, so a tool that caps its bounds at
 * a day while its look-back reads any length could not say so.
 *
 * Law: any form may declare its own `maxRange`; it overrides the period's for
 * THAT form only (`periodForm.ts` · `formMaxRange`, the one owner). Before a
 * form is chosen (the person's window to fill, the time ask's choices) the
 * tool is held to the widest any form reads — none when one form has no cap
 * (`toolFacts`) — so a window is refused `over-max-range` only when no form
 * can read it; once a window was SENT in one form, it is held to that form's
 * cap (`formFacts`). A tool whose forms declare none reads exactly as before.
 *
 * Test types:
 *   unit        — `formMaxRange`, `formFacts`, `toolFacts`;
 *   boundary    — a 48 h window: the capped bounds form is skipped and the uncapped look-back
 *                 reads it; capped everywhere → `over-max-range`; exactly the form's cap is read;
 *   functional  — `defineTool` takes a form's `maxRange` and refuses one that is no duration;
 *   integration — a `.time()` agent: the model's 48 h bounds are refused naming the bounds' cap,
 *                 its `window: '2d'` look-back runs;
 *   byte identity — forms that declare none: `convertForTool` answers exactly as the period's
 *                 `maxRange` alone did.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Agent, defineTool, type PeriodForm } from '../../../src/index.js';
import { convertForTool } from '../../../src/doors/time.js';
import { formFacts, formMaxRange, toolFacts } from '../../../src/core/time/periodForm.js';
import { lookbackRange } from '../../../src/core/time/range.js';

const NOW = '2026-10-09T15:40:00Z';
const NOW_MS = Date.parse(NOW);
const CTX = { now: NOW, zone: 'America/Los_Angeles', granularityMs: 60_000 } as const;
const BOUNDS_24H: PeriodForm = {
  kind: 'bounds',
  from: { argument: 'from', as: 'iso' },
  to: { argument: 'to', as: 'iso', edge: 'exclusive' },
  maxRange: '24h',
};
const LOOKBACK: PeriodForm = { kind: 'lookback', argument: 'window', signed: false };

describe('unit — one owner of a form’s cap', () => {
  it('a form’s own maxRange wins; else the period’s; the tool’s is the widest, none if one is uncapped', () => {
    expect(formMaxRange(BOUNDS_24H, { maxRange: '7d' })).toBe('24h');
    expect(formMaxRange(LOOKBACK, { maxRange: '7d' })).toBe('7d');
    expect(formMaxRange(LOOKBACK, {})).toBeUndefined();
    expect(formFacts(BOUNDS_24H, { direction: 'past' })).toEqual({
      direction: 'past',
      maxRange: '24h',
    });
    expect(formFacts(LOOKBACK, { direction: 'past' })).toEqual({ direction: 'past' });
    expect(toolFacts([BOUNDS_24H, LOOKBACK], { direction: 'past' })).toEqual({ direction: 'past' });
    expect(toolFacts([BOUNDS_24H, LOOKBACK], { maxRange: '7d' })).toEqual({ maxRange: '7d' });
    expect(toolFacts([BOUNDS_24H, { ...LOOKBACK, maxRange: '2d' }], {})).toEqual({
      maxRange: '2d',
    });
    // No form declares one: the period's facts, as declared.
    const facts = { maxRange: '24h' } as const;
    expect(toolFacts([LOOKBACK], facts)).toBe(facts);
  });
});

describe('boundary — the conversion holds each form to its own cap', () => {
  const twoDays = { range: lookbackRange(NOW, '48h', 'smhdw'), lookback: '48h' } as const;

  it('48 h: the bounds form (cap 24h) is skipped, the uncapped look-back reads it', () => {
    expect(convertForTool(twoDays, [BOUNDS_24H, LOOKBACK], {}, CTX)).toEqual({
      conversion: { form: 1, values: { window: '2d' } },
    });
  });

  it('exactly the form’s cap is read by that form', () => {
    const day = { range: lookbackRange(NOW, '24h', 'smhdw'), lookback: '24h' } as const;
    expect(convertForTool(day, [BOUNDS_24H, LOOKBACK], {}, CTX)).toEqual({
      conversion: { form: 0, values: { from: '2026-10-08T15:40:00Z', to: NOW } },
    });
  });

  it('every form capped below the window → over-max-range (the widest cap is the tool’s)', () => {
    const capped = [BOUNDS_24H, { ...LOOKBACK, maxRange: '36h' } as PeriodForm];
    expect(convertForTool(twoDays, capped, {}, CTX)).toEqual({ refused: 'over-max-range' });
  });

  it('byte identity — no form declares one: the period’s maxRange answers as before', () => {
    const plain = [{ ...BOUNDS_24H, maxRange: undefined } as PeriodForm, LOOKBACK].map((f) => {
      const { maxRange: _m, ...rest } = f as PeriodForm & { maxRange?: string };
      void _m;
      return rest as PeriodForm;
    });
    expect(convertForTool(twoDays, plain, { maxRange: '24h' }, CTX)).toEqual({
      refused: 'over-max-range',
    });
    expect(convertForTool(twoDays, plain, {}, CTX)).toEqual({
      conversion: {
        form: 0,
        values: { from: '2026-10-07T15:40:00Z', to: NOW },
      },
    });
  });
});

describe('functional — defineTool reads a form’s maxRange', () => {
  const tool = (maxRange: unknown) =>
    defineTool({
      name: 'flows',
      description: 'Network flows.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          window: { type: 'string' },
        },
      },
      askOrAssume: { from: { ask: 'From?' }, to: { ask: 'To?' }, window: { assume: '1h' } },
      period: { forms: [{ ...BOUNDS_24H, maxRange }, LOOKBACK] } as never,
      execute: () => 'ok',
    });

  it('a duration is taken; anything else is refused at definition', () => {
    expect(() => tool('24h')).not.toThrow();
    expect(() => tool('a day')).toThrow(/maxRange "a day" is not a duration/);
    expect(() => tool(24)).toThrow(/maxRange 24 is not a duration/);
  });
});

describe('integration — a sent window is held to the cap of the form it was sent in', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS + 5_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function run(args: Record<string, unknown>) {
    const seen: Record<string, unknown>[] = [];
    const requests: { messages: { role: string; content: unknown }[] }[] = [];
    let n = 0;
    const provider = {
      name: 'form-cap-mock',
      complete: async (req: { messages: { role: string; content: unknown }[] }) => {
        requests.push(req);
        n += 1;
        return n === 1
          ? {
              content: '',
              toolCalls: [{ id: 'c1', name: 'flows', args }],
              usage: { input: 0, output: 0 },
            }
          : { content: 'done', toolCalls: [], usage: { input: 0, output: 0 } };
      },
    };
    const agent = Agent.create({ provider: provider as never, model: 'mock', maxIterations: 4 })
      .tool(
        defineTool({
          name: 'flows',
          description: 'Network flows.',
          inputSchema: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              window: { type: 'string' },
            },
          },
          askOrAssume: { from: { ask: 'From?' }, to: { ask: 'To?' }, window: { assume: '1h' } },
          period: { forms: [BOUNDS_24H, LOOKBACK], direction: 'past' },
          execute: (a) => {
            seen.push({ ...a });
            return 'ok';
          },
        }),
      )
      .time({ zone: 'America/Los_Angeles' })
      .build();
    return { agent, seen, requests };
  }

  it('48 h of bounds is refused naming the bounds’ cap; a 2d look-back runs', async () => {
    const bounds = run({ from: '2026-10-07T15:40:00Z', to: NOW });
    await bounds.agent.run({ message: 'flows over two days', time: { now: NOW } });
    expect(bounds.seen).toEqual([]);
    const rows =
      (bounds.agent.findings() as { kind: string; how?: string; refused?: string }[]) ?? [];
    expect(rows.find((r) => r.kind === 'call-window')).toMatchObject({
      how: 'refused',
      refused: 'over-max-range',
    });
    const result = bounds.requests[1]!.messages.find((m) => m.role === 'tool')!;
    expect(result.content as string).toContain('maxRange 24h');

    const lookback = run({ window: '2d' });
    await lookback.agent.run({ message: 'flows over two days', time: { now: NOW } });
    expect(lookback.seen).toEqual([{ window: '2d' }]);
  });
});
