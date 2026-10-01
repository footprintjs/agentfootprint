/**
 * `maxRange` is an inclusive ceiling, judged by the instants a window holds —
 * never by how it was spelled (fix: a look-back exactly `maxRange` long was
 * refused `over-max-range`, its inclusive end counted one millisecond past it).
 *
 * Law: a window is over a tool's `maxRange` only when its last instant lies
 * further than `maxRange` after its first (`range.ts` · `reachMs`). A look-back
 * `[now − L, now]` reaches `L`; the same instants written as bounds reach the
 * same; one more step is refused.
 *
 * Test types:
 *   unit        — `reachMs` on a look-back and on a whole day;
 *   boundary    — look-back AND bounds forms: exactly `maxRange` read, `maxRange` + 1 step
 *                 refused, through `periodFactProblem` and `convertForTool` (the public door
 *                 `agentfootprint/time`); the covering (widened) look-back keeps the same edge;
 *   property    — seeded: the verdict depends on the instants only (a look-back and its bounds
 *                 spelling agree), and is `over-max-range` exactly when the reach exceeds it;
 *   integration — a `.time()` agent with a scripted provider: the model's `window: '24h'` runs on
 *                 a `maxRange: '24h'` tool, `1441m` is refused; the person's "last 24 hours" is
 *                 asked and then read, never refused.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Agent, defineTool, isInputPause, type TimeReader } from '../../../src/index.js';
import { convertForTool, periodFactProblem } from '../../../src/doors/time.js';
import { lookbackRange, reachMs } from '../../../src/core/time/range.js';

const NOW = '2026-10-09T15:40:00Z';
const NOW_MS = Date.parse(NOW);
const HOUR = 3_600_000;
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const CTX = { now: NOW, zone: 'America/Los_Angeles', granularityMs: MIN } as const;
const LOOKBACK = { kind: 'lookback', argument: 'window', signed: false } as const;
const BOUNDS = {
  kind: 'bounds',
  from: { argument: 'from', as: 'iso' },
  to: { argument: 'to', as: 'iso', edge: 'exclusive' },
} as const;
const CAP = { maxRange: '24h' } as const;

describe('unit — reachMs is first instant to last', () => {
  it('a look-back reaches its length; a whole day one millisecond less', () => {
    const lb = lookbackRange(NOW, '24h', 'smhdw');
    expect(lb).toEqual({ from: '2026-10-08T15:40:00Z', to: '2026-10-09T15:40:00.001Z' });
    expect(reachMs(Date.parse(lb.from), Date.parse(lb.to))).toBe(24 * HOUR);
    expect(reachMs(Date.parse('2026-10-08T00:00:00Z'), Date.parse('2026-10-09T00:00:00Z'))).toBe(
      24 * HOUR - 1,
    );
  });
});

describe('boundary — the look-back form', () => {
  it('exactly maxRange is read; one minute more is refused', () => {
    const exactly = lookbackRange(NOW, '24h', 'smhdw');
    const over = lookbackRange(NOW, '1441m', 'smhdw');
    expect(periodFactProblem(exactly, CAP, NOW)).toBeUndefined();
    expect(periodFactProblem(over, CAP, NOW)).toBe('over-max-range');
    expect(convertForTool({ range: exactly, lookback: '24h' }, [LOOKBACK], CAP, CTX)).toEqual({
      conversion: { form: 0, values: { window: '1d' } },
    });
    expect(convertForTool({ range: over, lookback: '1441m' }, [LOOKBACK], CAP, CTX)).toEqual({
      refused: 'over-max-range',
    });
  });

  it('the said look-back reaches a bounds tool exactly at maxRange; one minute more is refused', () => {
    expect(
      convertForTool(
        { range: lookbackRange(NOW, '24h', 'smhdw'), lookback: '24h' },
        [BOUNDS],
        CAP,
        CTX,
      ),
    ).toEqual({ conversion: { form: 0, values: { from: '2026-10-08T15:40:00Z', to: NOW } } });
    expect(
      convertForTool(
        { range: lookbackRange(NOW, '1441m', 'smhdw'), lookback: '1441m' },
        [BOUNDS],
        CAP,
        CTX,
      ),
    ).toEqual({ refused: 'over-max-range' });
  });

  it('a covering (widened) look-back keeps the same edge', () => {
    // Ends one hour ago; the covering look-back from now is exactly 24h, then 24h + 1 min.
    const fits = { from: iso(NOW_MS - 24 * HOUR), to: iso(NOW_MS - HOUR) };
    const over = { from: iso(NOW_MS - 24 * HOUR - MIN), to: iso(NOW_MS - HOUR) };
    expect(convertForTool({ range: fits }, [LOOKBACK], CAP, CTX)).toMatchObject({
      conversion: { form: 0, values: { window: '1d' } },
    });
    expect(convertForTool({ range: over }, [LOOKBACK], CAP, CTX)).toEqual({
      refused: 'no-form-holds',
    });
  });
});

describe('boundary — the bounds form', () => {
  const end = NOW_MS - 2 * HOUR;
  it('a past range exactly maxRange long is read; one minute more is refused', () => {
    const exactly = { from: iso(end - 24 * HOUR), to: iso(end) };
    const over = { from: iso(end - 24 * HOUR - MIN), to: iso(end) };
    expect(periodFactProblem(exactly, CAP, NOW)).toBeUndefined();
    expect(periodFactProblem(over, CAP, NOW)).toBe('over-max-range');
    expect(convertForTool({ range: exactly }, [BOUNDS], CAP, CTX)).toEqual({
      conversion: { form: 0, values: { from: '2026-10-08T13:40:00Z', to: '2026-10-09T13:40:00Z' } },
    });
    expect(convertForTool({ range: over }, [BOUNDS], CAP, CTX)).toEqual({
      refused: 'over-max-range',
    });
  });

  it('the instants of a 24h look-back, spelled as bounds, are judged alike; one ms more is not', () => {
    const same = { from: iso(end - 24 * HOUR), to: iso(end + 1) };
    const more = { from: iso(end - 24 * HOUR), to: iso(end + 2) };
    expect(periodFactProblem(same, CAP, NOW)).toBeUndefined();
    expect(periodFactProblem(more, CAP, NOW)).toBe('over-max-range');
  });
});

/** A small seeded generator (mulberry32) — the same windows every run. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property — the verdict reads the instants, never the spelling', () => {
  it('a look-back and its bounds spelling agree, and refuse exactly past maxRange', () => {
    const rand = seeded(20261009);
    for (let i = 0; i < 500; i++) {
      const capHours = 1 + Math.floor(rand() * 72);
      // A quarter each: one step under the cap, exactly at it, one step over, anywhere.
      const pick = Math.floor(rand() * 4);
      const minutes =
        pick < 3 ? capHours * 60 + pick - 1 : 1 + Math.floor(rand() * (capHours * 60 + 120));
      const facts = { maxRange: `${capHours}h` } as const;
      const lb = lookbackRange(NOW, `${minutes}m`, 'smhdw');
      const asBounds = { from: iso(NOW_MS - minutes * MIN), to: iso(NOW_MS + 1) };
      const expected = minutes * MIN > capHours * HOUR ? 'over-max-range' : undefined;
      expect(periodFactProblem(lb, facts, NOW)).toBe(expected);
      expect(periodFactProblem(asBounds, facts, NOW)).toBe(expected);
      // A past half-open range of the same length: over exactly when it holds one minute more.
      const end = NOW_MS - (1 + Math.floor(rand() * 48)) * HOUR;
      const past = { from: iso(end - minutes * MIN), to: iso(end) };
      expect(periodFactProblem(past, facts, NOW)).toBe(expected);
    }
  });
});

// ─── through a real agent ─────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  return {
    name: 'max-range-mock',
    complete: async () => {
      const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
      i += 1;
      return {
        content: reply.content,
        toolCalls: reply.toolCalls ?? [],
        usage: { input: 0, output: 0 },
      };
    },
  };
}

/** "the last 24 hours" — a look-back of 24 hours. */
const last24h: TimeReader = {
  id: 'fixture/rule',
  version: '1.0.0',
  locale: 'en-US',
  kind: 'rule',
  read: (text) =>
    text.includes('last 24 hours')
      ? {
          mentions: [
            { quote: 'last 24 hours', parses: [{ relative: { unit: 'hour', count: 24 } }] },
          ],
        }
      : { mentions: [] },
};

function agentWith(args: object, seen: Record<string, unknown>[]) {
  const tool = defineTool({
    name: 'search_logs',
    description: 'Error lines over a look-back window.',
    inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
    askOrAssume: { window: { assume: '1h' } },
    period: { argument: 'window', spelling: 'lookback', maxRange: '24h' } as never,
    execute: (a) => {
      seen.push({ ...a });
      return 'no errors';
    },
  });
  const provider = scripted([
    { content: '', toolCalls: [{ id: 'c0', name: 'search_logs', args }] },
    { content: 'none' },
  ]);
  return Agent.create({ provider: provider as never, model: 'mock', maxIterations: 6 })
    .tools([tool])
    .time({ zone: 'America/Los_Angeles', reader: last24h })
    .build();
}

type Row = { kind: string } & Record<string, unknown>;
const callWindow = (agent: { findings(): unknown }) =>
  ((agent.findings() as Row[] | undefined) ?? []).filter((r) => r.kind === 'call-window').pop();

describe('integration — a .time() agent, a look-back tool declaring maxRange 24h', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS + 5_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the model's window '24h' runs; '1441m' is refused over-max-range", async () => {
    const seen: Record<string, unknown>[] = [];
    const agent = agentWith({ window: '24h' }, seen);
    await agent.run({ message: 'any errors in the last 24 hours?', time: { now: NOW } });
    expect(seen).toEqual([{ window: '24h' }]);
    expect(callWindow(agent)).toMatchObject({ how: 'model', form: 0 });

    const seenOver: Record<string, unknown>[] = [];
    const over = agentWith({ window: '1441m' }, seenOver);
    await over.run({ message: 'any errors in the last 24 hours?', time: { now: NOW } });
    expect(seenOver).toEqual([]);
    expect(callWindow(over)).toMatchObject({ how: 'refused', refused: 'over-max-range' });
  });

  it("the person's 'last 24 hours' is asked, then read — never refused", async () => {
    const seen: Record<string, unknown>[] = [];
    const agent = agentWith({}, seen);
    const first = await agent.run({
      message: 'any errors in the last 24 hours?',
      time: { now: NOW },
    });
    expect(isInputPause(first)).toBe(true);
    const p = first as never as {
      checkpoint: unknown;
      awaitingInput: { requestId: string; fields: readonly { id: string; enum?: string[] }[] };
    };
    const field = p.awaitingInput.fields[0]!;
    await agent.resume(
      p.checkpoint as never,
      { requestId: p.awaitingInput.requestId, values: { [field.id]: field.enum![0] } } as never,
    );
    expect(seen).toEqual([{ window: '1d' }]);
    expect(callWindow(agent)).toMatchObject({ how: 'filled', form: 0 });
  });
});
