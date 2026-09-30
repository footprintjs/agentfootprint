/**
 * Widening, the clock at dispatch and the pre-dispatch refusals through real
 * agents (time design § 7.2, § 7.4, step T5b). A scripted provider, a FIXTURE
 * reader or a UI window (`time.window`), and the wall clock pinned with fake
 * `Date` — no English is read and no model is called.
 *
 * Law: when no form holds the person's window exactly the library reads MORE
 * and says so (the row and the note); a call whose window the tool cannot
 * honestly read is refused before dispatch, with the reason, and never runs;
 * after drift only the library's own look-back fill is redrawn — the model's
 * look-back runs as sent and is recorded shifted.
 *
 * Test types:
 *   functional  — "yesterday" to a look-back-only tool → the covering look-back, `differs.extra`,
 *                 the note says wider; `filtersToAsked` → `trimmedByTool`; a UI window inside one
 *                 day to a `day` tool → that day; a future window to a `past` tool is refused with
 *                 the reason (filled or sent); wholly beyond retention, over maxRange, a two-day
 *                 window to a `day`-only tool and a skipped wall time are refused; a range half
 *                 inside retention dispatches, marked;
 *   integration — the clock at dispatch: 30 minutes after the turn's `now` the library's look-back
 *                 fill is redrawn into the tool's absolute form (the tool runs with it, `ctx.time`
 *                 unchanged), the model's own look-back runs as sent and is recorded shifted; the
 *                 same redraw after a check-in pause, at the resume door; the rows cross the
 *                 checkpoint door;
 *   byte identity — without `.time()` a tool's facts refuse nothing and nothing is filed.
 * Unit, property, security, boundary, performance: widen.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  checkInApproved,
  defineTool,
  isPaused,
  type TimeReader,
  type Tool,
  type ToolExecutionContext,
} from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { validateCheckpoint } from '../../../src/core/runCheckpoint.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'time-widen-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
        };
      },
    },
  };
}

const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
const answer = (content: string): Reply => ({ content });

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const NOW_MS = Date.parse(NOW);
const MORNING = { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:41:00Z' };
const TOMORROW = { from: '2026-10-10T15:00:00Z', to: '2026-10-10T15:41:00Z' };

/** "yesterday" — the whole of 8 October in Los Angeles. */
const yesterdayReader: TimeReader = {
  id: 'fixture/rule',
  version: '1.0.0',
  locale: 'en-US',
  kind: 'rule',
  read: (text) =>
    text.includes('yesterday')
      ? { mentions: [{ quote: 'yesterday', parses: [{ relative: { unit: 'day', offset: -1 } }] }] }
      : { mentions: [] },
};

type Row = { kind: string } & Record<string, unknown>;
const rows = (agent: { findings(): unknown }): Row[] =>
  ((agent.findings() as Row[] | undefined) ?? []).map((r) => ({ ...r }));
const ofKind = (agent: { findings(): unknown }, kind: string) =>
  rows(agent).filter((r) => r.kind === kind);

async function build(
  script: readonly Reply[],
  tools: readonly Tool[],
  arm: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
) {
  const s = scripted(script);
  const agent = arm(
    Agent.create({ provider: s.provider as never, model: 'mock', maxIterations: 6 }).tools(tools),
  ).build();
  return { agent, requests: s.requests };
}

/** The `role: 'tool'` message the model read on its second request. */
const toolMessage = (requests: readonly LLMRequest[]) =>
  requests[1]!.messages.find((m) => m.role === 'tool')!.content as string;

/** A look-back-only search, as today's `{ argument, spelling }` sugar declares it. */
function lookbackTool(facts: Record<string, unknown> = {}, seen: Record<string, unknown>[] = []) {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines over a look-back window.',
    inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
    askOrAssume: { window: { assume: '1h' } },
    period: { argument: 'window', spelling: 'lookback', ...facts } as never,
    execute: (args) => {
      seen.push(args);
      return 'no errors';
    },
  });
}

/** Two epoch-ms arguments — an absolute form. */
function epochTool(
  facts: Record<string, unknown> = {},
  seen: Record<string, unknown>[] = [],
  withLookback = false,
  checkIn = false,
) {
  return defineTool({
    name: 'client_activity',
    ...(checkIn && { checkIn: 'always' as const }),
    description: 'Client operations over a window.',
    inputSchema: {
      type: 'object',
      properties: {
        ...(withLookback && { window: { type: 'string' } }),
        start_time: { type: 'integer' },
        end_time: { type: 'integer' },
      },
    },
    askOrAssume: {
      ...(withLookback && { window: { assume: '1h' } }),
      start_time: { ask: 'From when?' },
      end_time: { ask: 'Until when?' },
    },
    period: {
      forms: [
        ...(withLookback ? [{ kind: 'lookback', argument: 'window', signed: false }] : []),
        {
          kind: 'bounds',
          from: { argument: 'start_time', as: 'epoch-ms' },
          to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
        },
      ],
      ...facts,
    } as never,
    execute: (args, ctx: ToolExecutionContext) => {
      seen.push({ ...args, ...(ctx.time !== undefined && { time: ctx.time }) });
      return '{"ops":42}';
    },
  });
}

/** One calendar day per call, its zone an argument. */
function dayTool(seen: Record<string, unknown>[] = []) {
  return defineTool({
    name: 'daily_report',
    description: 'The report for one day.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string' }, tz: { type: 'string' } },
    },
    askOrAssume: { date: { ask: 'Which day?' }, tz: { assume: LA } },
    period: { forms: [{ kind: 'day', argument: 'date', zone: { argument: 'tz' } }] } as never,
    execute: (args) => {
      seen.push(args);
      return 'report';
    },
  });
}

// The wall clock sits five seconds after the turn's `now` unless a test moves it.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS + 5_000);
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── the inexact rows ────────────────────────────────────────────────

describe('wider than asked — the covering look-back and the day', () => {
  it('"yesterday" to a look-back-only tool → the covering look-back from now, recorded wider', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = await build(
      [call('c1', 'search_logs', {}), answer('none')],
      [lookbackTool({}, seen)],
      (b) => b.time({ zone: LA, reader: yesterdayReader }),
    );
    await agent.run({ message: 'any errors yesterday?', time: { now: NOW } });
    // 8 Oct 00:00 PDT (07:00Z) to now is 32h40m — the smallest covering length in minutes.
    expect(seen[0]).toEqual({ window: '1960m' });
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({
      how: 'filled',
      form: 0,
      asked: { from: '2026-10-08T00:00:00-07:00', to: '2026-10-09T00:00:00-07:00' },
      sent: { from: '2026-10-08T07:00:00Z', to: '2026-10-09T15:40:00.001Z' },
      differs: { extra: [{ from: '2026-10-09T07:00:00Z', to: '2026-10-09T15:40:00.001Z' }] },
    });
    expect(ofKind(agent, 'argument')).toMatchObject([
      { argument: 'window', source: 'said', matched: 'mention', value: '1960m' },
    ]);
    expect(toolMessage(requests)).toContain(
      "[window was not in the search_logs call this result answers; the call ran with \"1960m\", from the window the person's own words gave — recorded as the person's; the tool's form could not hold that window exactly, so the value reads a wider one — recorded as wider than asked.]",
    );
    // Within the tool's step of now: no drift on the call row.
    expect(ofKind(agent, 'call')[0]).not.toHaveProperty('drift');
  });

  it('a tool that trims its rows to the asked window (`filtersToAsked`) — converted, trimmed by the tool', async () => {
    const { agent, requests } = await build(
      [call('c1', 'search_logs', {}), answer('none')],
      [lookbackTool({ filtersToAsked: true })],
      (b) => b.time({ zone: LA, reader: yesterdayReader }),
    );
    await agent.run({ message: 'any errors yesterday?', time: { now: NOW } });
    const row = ofKind(agent, 'call-window')[0]!;
    expect(row).toMatchObject({ how: 'filled', trimmedByTool: true });
    expect(row).not.toHaveProperty('differs');
    expect(toolMessage(requests)).toContain(
      'and the tool declares that it drops the rows outside the asked window.]',
    );
  });

  it('a UI window inside one day to a `day` tool → that day, both edges recorded as extra', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = await build(
      [call('c1', 'daily_report', {}), answer('ok')],
      [dayTool(seen)],
      (b) => b.time({ zone: LA }),
    );
    await agent.run({ message: 'the report', time: { now: NOW, window: MORNING } });
    expect(seen[0]).toEqual({ date: '2026-10-09', tz: LA });
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({
      how: 'filled',
      sent: { from: '2026-10-09T07:00:00Z', to: '2026-10-10T07:00:00Z' },
      differs: {
        extra: [
          { from: '2026-10-09T07:00:00Z', to: '2026-10-09T15:00:00Z' },
          { from: '2026-10-09T15:41:00Z', to: '2026-10-10T07:00:00Z' },
        ],
      },
    });
  });
});

// ─── the refusals ────────────────────────────────────────────────────

describe('refused before dispatch — the tool never runs, the model reads why', () => {
  it('a future window to a `past` tool is refused with the reason — filled from the person’s', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = await build(
      [call('c1', 'client_activity', {}), answer('cannot')],
      [epochTool({ direction: 'past' }, seen)],
      (b) => b.time({ zone: LA }),
    );
    await agent.run({ message: 'tomorrow?', time: { now: NOW, window: TOMORROW } });
    expect(seen).toEqual([]);
    expect(toolMessage(requests)).toContain(
      'client_activity was not run on that call: the window it asked for had not happened yet, ' +
        'and the tool declares that its source holds only the past.',
    );
    expect(ofKind(agent, 'call-window')).toMatchObject([
      { how: 'refused', refused: 'time-future', asked: TOMORROW, person: { source: 'control' } },
    ]);
    // Nothing was filled, asked or dispatched for it.
    expect(ofKind(agent, 'argument')).toEqual([]);
    expect(ofKind(agent, 'call')).toEqual([]);
  });

  it('…and sent by the model', async () => {
    const seen: Record<string, unknown>[] = [];
    const sent = { start_time: Date.parse(TOMORROW.from), end_time: Date.parse(TOMORROW.to) };
    const { agent, requests } = await build(
      [call('c1', 'client_activity', sent), answer('cannot')],
      [epochTool({ direction: 'past' }, seen)],
      (b) => b.time({ zone: LA }),
    );
    await agent.run({ message: 'tomorrow?', time: { now: NOW } });
    expect(seen).toEqual([]);
    expect(toolMessage(requests)).toContain('had not happened yet');
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({
      how: 'refused',
      refused: 'time-future',
      form: 0,
    });
  });

  it('wholly beyond retention and over maxRange are refused, the reason naming the fact', async () => {
    const old = {
      start_time: NOW_MS - 40 * 86_400_000,
      end_time: NOW_MS - 35 * 86_400_000,
    };
    const wide = { start_time: NOW_MS - 3 * 86_400_000, end_time: NOW_MS - 3_600_000 };
    const { agent, requests } = await build(
      [call('c1', 'client_activity', old), call('c2', 'client_activity', wide), answer('x')],
      [epochTool({ retention: '30d', maxRange: '24h' })],
      (b) => b.time({ zone: LA }),
    );
    await agent.run({ message: 'activity', time: { now: NOW } });
    expect(toolMessage(requests)).toContain(
      'the window it asked for was wholly older than the oldest data the tool declares its source keeps (30d).',
    );
    const second = requests[2]!.messages.filter((m) => m.role === 'tool').at(-1)!.content;
    expect(second).toContain('was wider than the tool declares it reads at once (maxRange 24h)');
    expect(ofKind(agent, 'call-window').map((r) => r.refused)).toEqual([
      'beyond-retention',
      'over-max-range',
    ]);
  });

  it('a range half inside retention dispatches, marked partly beyond it', async () => {
    const seen: Record<string, unknown>[] = [];
    const half = { start_time: NOW_MS - 31 * 86_400_000, end_time: NOW_MS - 29 * 86_400_000 };
    const { agent } = await build(
      [call('c1', 'client_activity', half), answer('x')],
      [epochTool({ retention: '30d' }, seen)],
      (b) => b.time({ zone: LA }),
    );
    await agent.run({ message: 'activity', time: { now: NOW } });
    expect(seen[0]).toMatchObject(half);
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({
      how: 'model',
      partlyBeyondRetention: true,
    });
  });

  it('a two-day window to a `day`-only tool is refused — one call per day is the model’s choice', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = await build(
      [call('c1', 'daily_report', {}), answer('x')],
      [dayTool(seen)],
      (b) => b.time({ zone: LA }),
    );
    const twoDays = { from: '2026-10-08T15:00:00Z', to: MORNING.to };
    await agent.run({ message: 'the report', time: { now: NOW, window: twoDays } });
    expect(seen).toEqual([]);
    expect(toolMessage(requests)).toContain(
      'spanned more than one calendar day, and the tool reads one day per call; one call per day may be proposed instead.',
    );
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({ how: 'refused', refused: 'multi-day' });
  });

  it('a wall time the zone skips is refused, naming the argument', async () => {
    const seen: Record<string, unknown>[] = [];
    const wall = defineTool({
      name: 'badge_swipes',
      description: 'Badge swipes between two local times.',
      inputSchema: {
        type: 'object',
        properties: { start: { type: 'string' }, end: { type: 'string' }, tz: { type: 'string' } },
      },
      askOrAssume: { start: { ask: 'From?' }, end: { ask: 'Until?' }, tz: { assume: LA } },
      period: {
        forms: [
          {
            kind: 'bounds',
            from: { argument: 'start', as: 'wall' },
            to: { argument: 'end', as: 'wall', edge: 'exclusive' },
            zone: { argument: 'tz' },
          },
        ],
      } as never,
      execute: (args) => {
        seen.push(args);
        return 'swipes';
      },
    });
    const { agent, requests } = await build(
      [
        call('c1', 'badge_swipes', { start: '2026-03-08T02:30', end: '2026-03-08T04:00', tz: LA }),
        answer('x'),
      ],
      [wall],
      (b) => b.time({ zone: LA }),
    );
    await agent.run({ message: 'swipes that night', time: { now: NOW } });
    expect(seen).toEqual([]);
    expect(toolMessage(requests)).toContain(
      "the wall time sent for start does not exist in the tool's zone — the clocks skip it at a daylight-saving change.",
    );
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({
      how: 'refused',
      refused: 'dst-gap',
      argument: 'start',
    });
  });
});

// ─── the clock at dispatch ───────────────────────────────────────────

describe('the clock at dispatch (§ 7.4)', () => {
  const lastHour = { from: '2026-10-09T14:40:00Z', to: NOW };

  it('30 minutes after `now`, the library’s look-back fill is redrawn into the absolute form', async () => {
    vi.setSystemTime(NOW_MS + 30 * 60_000);
    const seen: Record<string, unknown>[] = [];
    const { agent } = await build(
      [call('c1', 'client_activity', {}), answer('x')],
      [epochTool({}, seen, true)],
      (b) => b.time({ zone: LA }),
    );
    await agent.run({ message: 'activity', time: { now: NOW, window: lastHour } });
    // Filled as `1h` (a range ending at now → the look-back form, first in order)…
    expect(ofKind(agent, 'argument')).toMatchObject([{ argument: 'window', value: '1h' }]);
    // …and handed to the tool as the asked range, because a look-back read now would be shifted.
    expect(seen[0]).toMatchObject({
      start_time: Date.parse(lastHour.from),
      end_time: NOW_MS,
      time: { asked: { ...lastHour, edge: 'exclusive' }, now: NOW },
    });
    expect(seen[0]).not.toHaveProperty('window');
    expect(ofKind(agent, 'call')[0]).toMatchObject({
      drift: { byMs: 30 * 60_000 + 0, outcome: 'redrawn', form: 1 },
    });
  });

  it('the model’s own look-back runs as sent and is recorded shifted', async () => {
    vi.setSystemTime(NOW_MS + 30 * 60_000);
    const seen: Record<string, unknown>[] = [];
    const { agent } = await build(
      [call('c1', 'client_activity', { window: '1h' }), answer('x')],
      [epochTool({}, seen, true)],
      (b) => b.time({ zone: LA }),
    );
    await agent.run({ message: 'activity', time: { now: NOW } });
    expect(seen[0]).toMatchObject({ window: '1h' });
    expect(ofKind(agent, 'call')[0]).toMatchObject({
      drift: { byMs: 30 * 60_000, outcome: 'shifted' },
    });
  });

  it('after a check-in pause, the resume door redraws the fill — the tool runs with what the row says', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = await build(
      [call('c1', 'client_activity', {}), answer('x')],
      [epochTool({}, seen, true, true)],
      (b) => b.time({ zone: LA }),
    );
    const paused = await agent.run({ message: 'activity', time: { now: NOW, window: lastHour } });
    expect(isPaused(paused)).toBe(true);
    expect(seen).toEqual([]);
    // The person approves half an hour later: the call is dispatched NOW.
    vi.setSystemTime(NOW_MS + 30 * 60_000);
    await agent.resume((paused as { checkpoint: never }).checkpoint, checkInApproved({ by: 'ops' }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ start_time: Date.parse(lastHour.from), end_time: NOW_MS });
    expect(seen[0]).not.toHaveProperty('window');
    expect(ofKind(agent, 'call').at(-1)).toMatchObject({
      drift: { outcome: 'redrawn', form: 1 },
    });
  });

  it('the rows cross the checkpoint door', async () => {
    vi.setSystemTime(NOW_MS + 30 * 60_000);
    const { agent } = await build(
      [call('c1', 'client_activity', {}), call('c2', 'search_logs', {}), answer('x')],
      [epochTool({}, [], true), lookbackTool({ direction: 'future' })],
      (b) => b.time({ zone: LA }),
    );
    await agent.run({ message: 'activity', time: { now: NOW, window: lastHour } });
    const cp = JSON.parse(JSON.stringify(agent.checkpoint())) as Record<string, unknown>;
    expect(() => validateCheckpoint(cp)).not.toThrow();
    const text = JSON.stringify(cp);
    expect(text).toContain('"outcome":"redrawn"');
    expect(text).toContain('"refused":"time-past"');
    const forged = JSON.parse(text.replace('"outcome":"redrawn"', '"outcome":"moved"'));
    expect(() => validateCheckpoint(forged)).toThrow();
  });
});

// ─── byte identity ───────────────────────────────────────────────────

describe('off: without .time() a tool’s facts refuse nothing', () => {
  it('a future window to a `past` tool runs as sent and files nothing', async () => {
    const seen: Record<string, unknown>[] = [];
    const sent = { start_time: Date.parse(TOMORROW.from), end_time: Date.parse(TOMORROW.to) };
    const { agent } = await build(
      [call('c1', 'client_activity', sent), answer('x')],
      [epochTool({ direction: 'past', retention: '30d' }, seen)],
      (b) => b,
    );
    await agent.run({ message: 'tomorrow?' });
    expect(seen).toEqual([sent]);
    expect(ofKind(agent, 'call-window')).toEqual([]);
    expect(ofKind(agent, 'call')).toEqual([]);
  });
});
