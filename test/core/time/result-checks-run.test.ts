/**
 * The result checks through real agents (time design § 9.2, § 9.4, § 9.6,
 * § 10.2, step T8). A scripted provider, a UI window (`time.window`) or the
 * model's own window, and the wall clock pinned with fake `Date` — no English
 * is read and no model is called.
 *
 * Law: what a call READ is compared with what it ASKED (for a window the model
 * chose, with the person's): asked-but-not-read is `missing`, read-but-not-asked
 * is `extra`, and either folds "not sure" (TQ8: a wider read too, unless the
 * result declares it read exactly what was asked); a window older than the
 * source keeps folds "not sure"; a wall-clock source is named, never compared
 * by its offset.
 *
 * Test types:
 *   functional  — a tool clamping 30 days to 7 (`missing`); a covering look-back (`extra`); a
 *                 look-back after a 30-minute pause (both, `shifted`); an inclusive
 *                 `queried.to == asked.to − 1 step` reads as covered, `queried.to == asked.to`
 *                 one step wider; `filtersToAsked` with a declared exact read clears it; a
 *                 drill-down the model chose is judged against the person's window; wholly beyond
 *                 retention → `period-beyond-retention`; the limits block's lines;
 *   integration — the `source-clock` rows and the `Clocks` lines; `Z` vs `-07:00` periods raise
 *                 no `clocks-differ`; the rows cross the checkpoint door (a forged one refused);
 *                 the `findings.period` event carries the checks' names, never a range;
 *   byte identity — without `.time()` the period row, the event and the limits block are the
 *                 bytes they were, and no `source-clock` row is filed.
 * Unit, property, security, boundary, performance: check.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  checkInApproved,
  defineTool,
  describedResult,
  inMemoryArtifacts,
  isPaused,
  type Tool,
  type ToolExecutionContext,
} from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { validateCheckpoint } from '../../../src/core/runCheckpoint.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  return {
    name: 'time-checks-mock',
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
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

const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
const answer = (content: string): Reply => ({ content });

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const NOW_MS = Date.parse(NOW);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

type Row = { kind: string } & Record<string, unknown>;
const ofKind = (agent: { findings(): unknown }, kind: string): Row[] =>
  ((agent.findings() as Row[] | undefined) ?? []).filter((r) => r.kind === kind);

type Declare = (args: Record<string, unknown>, ctx: ToolExecutionContext) => unknown;

/** Two epoch-ms arguments (and, optionally, a look-back); the result declares `declare`'s period. */
function epochTool(
  o: {
    facts?: Record<string, unknown>;
    lookback?: boolean;
    checkIn?: boolean;
    declare?: Declare;
    name?: string;
  } = {},
) {
  return defineTool({
    name: o.name ?? 'client_activity',
    ...(o.checkIn === true && { checkIn: 'always' as const }),
    description: 'Client operations over a window.',
    inputSchema: {
      type: 'object',
      properties: {
        ...(o.lookback === true && { window: { type: 'string' } }),
        start_time: { type: 'integer' },
        end_time: { type: 'integer' },
      },
    },
    askOrAssume: {
      ...(o.lookback === true && { window: { assume: '1h' } }),
      start_time: { ask: 'From when?' },
      end_time: { ask: 'Until when?' },
    },
    period: {
      forms: [
        ...(o.lookback === true ? [{ kind: 'lookback', argument: 'window', signed: false }] : []),
        {
          kind: 'bounds',
          from: { argument: 'start_time', as: 'epoch-ms' },
          to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
        },
      ],
      ...o.facts,
    } as never,
    execute: (args, ctx: ToolExecutionContext) => {
      const period = o.declare?.(args, ctx);
      return period === undefined
        ? '{"ops":42}'
        : describedResult({
            facts: [{ entity: 'client', ops: 42 }],
            provenance: { measuredAt: NOW, source: 'activity log' },
            period: period as never,
          });
    },
  });
}

/** A look-back-only search, as today's `{ argument, spelling }` sugar declares it. */
function lookbackTool(facts: Record<string, unknown> = {}, declare?: Declare) {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines over a look-back window.',
    inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
    askOrAssume: { window: { assume: '1h' } },
    period: { argument: 'window', spelling: 'lookback', ...facts } as never,
    execute: (args, ctx: ToolExecutionContext) => {
      const period = declare?.(args, ctx);
      return period === undefined
        ? 'no errors'
        : describedResult({
            facts: [{ entity: 'logs', errors: 0 }],
            provenance: { measuredAt: NOW, source: 'log store' },
            period: period as never,
          });
    },
  });
}

async function build(
  script: readonly Reply[],
  tools: readonly Tool[],
  arm: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  withStore = false,
) {
  const agent = arm(
    Agent.create({
      provider: scripted(script) as never,
      model: 'mock',
      maxIterations: 6,
      ...(withStore && { artifacts: { store: inMemoryArtifacts() } }),
    }).tools(tools),
  ).build();
  const periodEvents: Record<string, unknown>[] = [];
  agent.on('agentfootprint.findings.period', (e) =>
    periodEvents.push(e.payload as Record<string, unknown>),
  );
  return { agent, periodEvents };
}

const timeArm = (b: ReturnType<typeof Agent.create>) =>
  b.time({ zone: LA }).limitsTravelWithTheAnswer();
const reasonsOf = async (agent: { assessment(): Promise<unknown> }) =>
  (
    ((await agent.assessment()) as { reasons: { reason: string }[] } | undefined)?.reasons ?? []
  ).map((r) => r.reason);
const finalOf = (out: unknown) => (typeof out === 'string' ? out : String(out));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS + 5_000);
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── differs from asked ──────────────────────────────────────────────

describe('period-differs-from-asked — what was read against what was asked', () => {
  const THIRTY_DAYS = { from: iso(NOW_MS - 30 * DAY), to: NOW };

  it('a tool clamping 30 days to 7 → `missing` (the front 23 days), "not sure"', async () => {
    const clamp: Declare = () => ({
      queried: { from: iso(NOW_MS - 7 * DAY), to: iso(NOW_MS - 1) },
      held: { from: iso(NOW_MS - 90 * DAY), to: NOW },
    });
    const { agent, periodEvents } = await build(
      [call('c1', 'client_activity'), answer('42 operations.')],
      [epochTool({ declare: clamp })],
      timeArm,
    );
    const out = await agent.run({ message: 'activity', time: { now: NOW, window: THIRTY_DAYS } });
    const [row] = ofKind(agent, 'period');
    expect(row).toMatchObject({
      verdict: 'covered',
      differs: {
        against: 'asked',
        source: 'declared',
        stepMs: 1,
        missing: [{ from: '2026-09-09T15:40:00Z', to: '2026-10-02T15:40:00Z' }],
        extra: [],
      },
    });
    expect(await reasonsOf(agent)).toContain('period-differs-from-asked');
    expect(periodEvents).toEqual([
      expect.objectContaining({ verdict: 'covered', timeChecks: ['period-differs-from-asked'] }),
    ]);
    expect(JSON.stringify(periodEvents)).not.toContain('2026-');
    expect(finalOf(out)).toContain(
      '- client_activity read less than was asked — asked: 2026-09-09 08:40:00 – 2026-10-09 08:39:59 America/Los_Angeles (UTC-07:00); read: 2026-10-02 08:40:00 – 2026-10-09 08:39:59 America/Los_Angeles (UTC-07:00)',
    );
  });

  it('a covering look-back (a whole past day to a look-back-only tool) → `extra`, from the fill', async () => {
    const yesterday = { from: '2026-10-08T07:00:00Z', to: '2026-10-09T07:00:00Z' };
    const { agent } = await build(
      [call('c1', 'search_logs'), answer('none')],
      [lookbackTool()],
      timeArm,
    );
    await agent.run({ message: 'errors', time: { now: NOW, window: yesterday } });
    const [row] = ofKind(agent, 'period');
    expect(row).toMatchObject({
      verdict: 'undeclared',
      differs: {
        against: 'asked',
        source: 'sent',
        missing: [],
        extra: [{ from: '2026-10-09T07:00:00Z', to: '2026-10-09T15:40:00.001Z' }],
      },
    });
    expect(row).not.toHaveProperty('differs.stepMs');
    // TQ8: `extra` alone is "not sure" by default.
    expect(await reasonsOf(agent)).toContain('period-differs-from-asked');
  });

  it('`filtersToAsked` and a result declaring exactly the asked range → cleared (TQ8)', async () => {
    const yesterday = { from: '2026-10-08T07:00:00Z', to: '2026-10-09T07:00:00Z' };
    const exact: Declare = (_a, ctx) => ({
      queried: { from: ctx.time!.asked!.from, to: iso(Date.parse(ctx.time!.asked!.to) - 1) },
      held: 'unknown',
    });
    const { agent } = await build(
      [call('c1', 'search_logs'), answer('none')],
      [lookbackTool({ filtersToAsked: true }, exact)],
      timeArm,
    );
    await agent.run({ message: 'errors', time: { now: NOW, window: yesterday } });
    const [row] = ofKind(agent, 'period');
    expect(row).not.toHaveProperty('differs');
    expect(await reasonsOf(agent)).not.toContain('period-differs-from-asked');
  });

  it('a look-back after a 30-minute check-in pause → both `missing` and `extra`, `shifted`', async () => {
    const { agent } = await build(
      [call('c1', 'client_activity', { window: '1h' }), answer('x')],
      [epochTool({ lookback: true, checkIn: true })],
      timeArm,
    );
    const paused = await agent.run({ message: 'activity', time: { now: NOW } });
    expect(isPaused(paused)).toBe(true);
    vi.setSystemTime(NOW_MS + 30 * 60_000);
    const out = await agent.resume(
      (paused as { checkpoint: never }).checkpoint,
      checkInApproved({ by: 'ops' }),
    );
    const [row] = ofKind(agent, 'period');
    expect(row).toMatchObject({
      shifted: { byMs: 30 * 60_000 },
      differs: {
        source: 'shifted',
        missing: [{ from: '2026-10-09T14:40:00Z', to: '2026-10-09T15:10:00Z' }],
        extra: [{ from: '2026-10-09T15:40:00.001Z', to: '2026-10-09T16:10:00.001Z' }],
      },
    });
    expect(await reasonsOf(agent)).toContain('period-differs-from-asked');
    expect(finalOf(out)).toContain('- client_activity read a shifted window — asked: ');
  });

  it('an inclusive `queried.to == asked.to − 1 step` reads as covered; `== asked.to` one step wider', async () => {
    const window = { from: '2026-10-09T14:00:00Z', to: '2026-10-09T15:00:00Z' };
    const declaring =
      (to: string): Declare =>
      () => ({
        queried: { from: window.from, to },
        held: 'unknown',
      });
    for (const [to, differs] of [
      ['2026-10-09T14:59:00Z', false],
      ['2026-10-09T15:00:00Z', true],
    ] as const) {
      const { agent } = await build(
        [call('c1', 'client_activity'), answer('x')],
        [epochTool({ facts: { granularity: '1m' }, declare: declaring(to) })],
        timeArm,
      );
      await agent.run({ message: 'activity', time: { now: NOW, window } });
      const [row] = ofKind(agent, 'period');
      if (differs) {
        expect(row).toMatchObject({
          differs: {
            stepMs: 60_000,
            missing: [],
            extra: [{ from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:01:00Z' }],
          },
        });
      } else {
        expect(row).not.toHaveProperty('differs');
      }
    }
  });

  it('a drill-down the model chose is judged against the person’s window', async () => {
    const hour = { from: '2026-10-09T14:00:00Z', to: '2026-10-09T15:00:00Z' };
    const drill = { start_time: Date.parse('2026-10-09T14:30:00Z'), end_time: Date.parse(hour.to) };
    const { agent } = await build(
      [call('c1', 'client_activity', drill), answer('x')],
      [epochTool()],
      timeArm,
    );
    await agent.run({ message: 'activity', time: { now: NOW, window: hour } });
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({ how: 'model-chosen' });
    expect(ofKind(agent, 'period')[0]).toMatchObject({
      differs: {
        against: 'person',
        asked: hour,
        missing: [{ from: '2026-10-09T14:00:00Z', to: '2026-10-09T14:30:00Z' }],
        extra: [],
      },
    });
    expect(await reasonsOf(agent)).toContain('period-differs-from-asked');
  });

  it('a call filled exactly and read exactly adds nothing to its row', async () => {
    const hour = { from: '2026-10-09T14:00:00Z', to: '2026-10-09T15:00:00Z' };
    const { agent } = await build(
      [call('c1', 'client_activity'), answer('x')],
      [epochTool()],
      timeArm,
    );
    await agent.run({ message: 'activity', time: { now: NOW, window: hour } });
    expect(ofKind(agent, 'period')).toEqual([
      {
        kind: 'period',
        turn: 1,
        toolCallId: 'c1',
        toolName: 'client_activity',
        iteration: 1,
        verdict: 'undeclared',
        argument: 'start_time',
      },
    ]);
  });
});

// ─── retention ───────────────────────────────────────────────────────

describe('period-beyond-retention', () => {
  it('a window wholly older than the source keeps → refused, and the answer is "not sure"', async () => {
    const old = { start_time: NOW_MS - 40 * DAY, end_time: NOW_MS - 35 * DAY };
    const { agent } = await build(
      [call('c1', 'client_activity', old), answer('Nothing happened then.')],
      [epochTool({ facts: { retention: '30d' } })],
      timeArm,
    );
    const out = await agent.run({ message: 'activity', time: { now: NOW } });
    expect(ofKind(agent, 'period')[0]).toMatchObject({ beyondRetention: true });
    expect(await reasonsOf(agent)).toContain('period-beyond-retention');
    expect(finalOf(out)).toContain(
      '- client_activity: the time asked about is older than the oldest data the tool declares its source keeps',
    );
  });

  it('a read half inside retention is marked partly beyond it — its verdict decides', async () => {
    const half = { start_time: NOW_MS - 31 * DAY, end_time: NOW_MS - 29 * DAY };
    const { agent } = await build(
      [call('c1', 'client_activity', half), answer('x')],
      [epochTool({ facts: { retention: '30d' } })],
      timeArm,
    );
    await agent.run({ message: 'activity', time: { now: NOW } });
    const [row] = ofKind(agent, 'period');
    expect(row).toMatchObject({ partlyBeyondRetention: true });
    expect(row).not.toHaveProperty('beyondRetention');
    expect(await reasonsOf(agent)).not.toContain('period-beyond-retention');
  });
});

// ─── clocks ──────────────────────────────────────────────────────────

/** A tool that mints one dataset whose axis declares `zone` (or none), and declares `period`. */
function datasetTool(name: string, zone: string | undefined, period?: unknown) {
  return defineTool({
    name,
    description: 'Rows over a window.',
    inputSchema: { type: 'object', properties: {} },
    execute: async (_args, ctx: ToolExecutionContext) => {
      await ctx.artifacts.put({
        kind: 'dataset/rows',
        mediaType: 'application/json',
        data: [{ at: '2026-10-09T08:00:00', n: 1 }],
        timeAxis: { column: 'at', unit: 'iso', ...(zone !== undefined && { zone }) },
      });
      return period === undefined
        ? 'rows'
        : describedResult({
            facts: [{ entity: name, rows: 1 }],
            provenance: { measuredAt: NOW, source: name },
            period: period as never,
          });
    },
  });
}

describe('clocks — declared wall-clock zones, a label only', () => {
  it('each wall-clock source is named; two zones say the clocks differ', async () => {
    const { agent } = await build(
      [
        {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'packet_records', args: {} },
            { id: 'c2', name: 'badge_log', args: {} },
          ],
        },
        answer('x'),
      ],
      [datasetTool('packet_records', LA), datasetTool('badge_log', 'Europe/London')],
      timeArm,
      true,
    );
    const out = await agent.run({ message: 'rows', time: { now: NOW } });
    expect(ofKind(agent, 'source-clock')).toMatchObject([
      { toolCallId: 'c1', toolName: 'packet_records', zone: LA },
      { toolCallId: 'c2', toolName: 'badge_log', zone: 'Europe/London' },
    ]);
    const text = finalOf(out);
    expect(text).toContain('Clocks:');
    expect(text).toContain(
      "- packet_records's rows are wall times in America/Los_Angeles (declared) — compared as instants",
    );
    expect(text).toContain(
      "- the sources' clocks differ (America/Los_Angeles, Europe/London) — compared as instants",
    );
    // A label only: no standing reason.
    expect((await reasonsOf(agent)).some((r) => r.includes('clock'))).toBe(false);
  });

  it('`Z` vs `-07:00` periods raise no clocks-differ — an offset is a spelling, not a clock', async () => {
    const z = {
      queried: { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:39:00Z' },
      held: 'unknown',
    };
    const offset = {
      queried: { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:39:00-07:00' },
      held: 'unknown',
    };
    const { agent } = await build(
      [
        {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'a_tool', args: {} },
            { id: 'c2', name: 'b_tool', args: {} },
          ],
        },
        answer('x'),
      ],
      [datasetTool('a_tool', undefined, z), datasetTool('b_tool', undefined, offset)],
      timeArm,
      true,
    );
    const out = await agent.run({ message: 'rows', time: { now: NOW } });
    expect(ofKind(agent, 'source-clock')).toEqual([]);
    expect(finalOf(out)).not.toContain('Clocks:');
    expect(finalOf(out)).not.toContain('differ');
  });
});

// ─── the checkpoint door ─────────────────────────────────────────────

describe('the rows cross the checkpoint door', () => {
  it('a period row with its checks and a source-clock row validate; forged ones are refused', async () => {
    const clamp: Declare = () => ({
      queried: { from: iso(NOW_MS - 7 * DAY), to: iso(NOW_MS - 1) },
      held: 'unknown',
    });
    const { agent } = await build(
      [
        {
          content: '',
          toolCalls: [
            { id: 'c1', name: 'client_activity', args: {} },
            { id: 'c2', name: 'packet_records', args: {} },
          ],
        },
        answer('x'),
      ],
      [epochTool({ declare: clamp }), datasetTool('packet_records', LA)],
      timeArm,
      true,
    );
    await agent.run({
      message: 'activity',
      time: { now: NOW, window: { from: iso(NOW_MS - 30 * DAY), to: NOW } },
    });
    const text = JSON.stringify(agent.checkpoint());
    const cp = JSON.parse(text) as Record<string, unknown>;
    expect(() => validateCheckpoint(cp)).not.toThrow();
    expect(text).toContain('"source":"declared"');
    expect(text).toContain('"kind":"source-clock"');
    for (const [from, to] of [
      ['"source":"declared"', '"source":"guessed"'],
      [
        '"toolName":"packet_records","zone":"America/Los_Angeles"',
        '"toolName":"packet_records","zone":"PST"',
      ],
    ]) {
      expect(text).toContain(from);
      expect(() => validateCheckpoint(JSON.parse(text.replace(from, to)))).toThrow();
    }
    const noLists = JSON.parse(text.replace('"extra":[]', '"extra":"none"'));
    expect(() => validateCheckpoint(noLists)).toThrow();
  });
});

// ─── byte identity ───────────────────────────────────────────────────

describe('off: without .time() nothing is checked, filed or printed', () => {
  it('the period row, the event and the limits block are the bytes they were', async () => {
    const clamp: Declare = () => ({
      queried: { from: iso(NOW_MS - 7 * DAY), to: iso(NOW_MS - 1) },
      held: { from: iso(NOW_MS - 90 * DAY), to: NOW },
    });
    const { agent, periodEvents } = await build(
      [
        {
          content: '',
          toolCalls: [
            {
              id: 'c1',
              name: 'client_activity',
              args: { start_time: NOW_MS - 30 * DAY, end_time: NOW_MS },
            },
            { id: 'c2', name: 'packet_records', args: {} },
          ],
        },
        answer('42 operations.'),
      ],
      [epochTool({ declare: clamp }), datasetTool('packet_records', LA)],
      (b) => b.limitsTravelWithTheAnswer(),
      true,
    );
    const out = await agent.run({ message: 'activity' });
    // The dataset tool declares no period, so only the clamping call is judged.
    expect(ofKind(agent, 'period')).toEqual([
      {
        kind: 'period',
        turn: 1,
        toolCallId: 'c1',
        toolName: 'client_activity',
        iteration: 1,
        verdict: 'covered',
        argument: 'start_time',
      },
    ]);
    expect(periodEvents).toEqual([
      { toolCallId: 'c1', toolName: 'client_activity', iteration: 1, turn: 1, verdict: 'covered' },
    ]);
    expect(ofKind(agent, 'source-clock')).toEqual([]);
    const text = finalOf(out);
    expect(text).toContain('- client_activity queried ');
    expect(text).not.toContain('read less than');
    expect(text).not.toContain('Clocks:');
  });
});
