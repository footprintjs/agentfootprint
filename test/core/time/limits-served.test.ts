/**
 * The time limits, served to the MODEL late at the decision point (time step
 * T8's serving placement; `agent/arguments/serve.ts` · `timeLimitsSentence`).
 *
 * Law: once a call's read differs from what it asked (or the asked time is
 * older than the source keeps, or two sources' clocks differ), every later
 * request of the turn ends with ONE line — the library's conclusion, both
 * ranges in the person's zone, and what an answer states. A turn whose reads
 * match serves no limit; the first request (nothing read yet) serves none. A
 * window set in the app's time control is named on its own sentence first.
 * The model reads the same lines the person reads in the limits block
 * (`coverage/timeLimits.ts` · `timeLimitLinesOf`), with "the person's window"
 * for "your window".
 *
 * Test types:
 *   functional  — a clamp (30 days asked, 7 read) serves the line on the answer call only;
 *                 a matching read serves nothing; beyond retention serves its clause;
 *   unit        — the composition: nothing → no line; clocks alone → the label alone;
 *   byte identity — without `.time()` no request carries a line.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  checkInApproved,
  defineTool,
  describedResult,
  isPaused,
  type Tool,
} from '../../../src/index.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import {
  TIME_LINE_SOURCE,
  timeLimitsSentence,
  timeLine,
} from '../../../src/core/agent/arguments/serve.js';

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

const NOW = '2026-10-09T15:40:00Z';
const NOW_MS = Date.parse(NOW);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const LA = 'America/Los_Angeles';
const LEAD = `${TIME_LINE_SOURCE} The time the tools read is not the time asked about`;

function scripted(script: readonly Reply[], requests: LLMRequest[]) {
  let i = 0;
  return {
    name: 'limits-served-mock',
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
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

/** Epoch-ms bounds; the store clamps a read to its last `keepDays` and declares what it read. */
function clampTool(
  o: { name?: string; keepDays?: number; retention?: string; zone?: string } = {},
) {
  const keep = (o.keepDays ?? 7) * DAY;
  return defineTool({
    name: o.name ?? 'client_activity',
    description: 'Client operations over a window.',
    inputSchema: {
      type: 'object',
      properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
    },
    askOrAssume: { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'start_time', as: 'epoch-ms' },
          to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
        },
      ],
      ...(o.retention !== undefined && { retention: o.retention }),
    } as never,
    execute: (args) => {
      const to = Number((args as { end_time: number }).end_time);
      const from = Math.max(Number((args as { start_time: number }).start_time), to - keep);
      return describedResult({
        facts: [{ entity: 'client', ops: 42 }],
        provenance: { measuredAt: NOW, source: 'activity store' },
        period: {
          queried: { from: iso(from), to: iso(to - 1) },
          held: { from: iso(NOW_MS - 90 * DAY), to: NOW },
        },
        ...(o.zone !== undefined && { axis: { zone: o.zone } }),
      } as never);
    },
  });
}

async function run(
  tools: readonly Tool[],
  script: readonly Reply[],
  window: { from: string; to: string } | undefined,
  armed = true,
) {
  const requests: LLMRequest[] = [];
  let b = Agent.create({
    provider: scripted(script, requests) as never,
    model: 'mock',
    maxIterations: 6,
  }).tools(tools);
  if (armed) b = b.time({ zone: LA }).limitsTravelWithTheAnswer();
  const agent = b.build();
  const out = await agent.run({
    message: 'client activity',
    ...(armed && { time: { now: NOW, ...(window !== undefined && { window }) } }),
  });
  return { agent, out: String(out), requests };
}

/** The request's trailing request-only line, when its last message is a user TEXT that is not the person's. */
function lastLine(req: LLMRequest): string | undefined {
  const last = (req.messages as LLMMessage[])[req.messages.length - 1];
  if (last?.role !== 'user' || typeof last.content !== 'string') return undefined;
  return last.content === 'client activity' ? undefined : last.content;
}

const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS + 5_000);
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * The window set in the app's time control (`time.window`), served on its own sentence since
 * packet "gaps" (G9) — before any limit: the first request names it, the later ones too.
 */
const CONTROL_30D =
  "The window the person set in the app's time control is 2026-09-09 08:40 – 2026-10-09 08:39 " +
  'America/Los_Angeles (UTC-07:00) — client_activity start_time 1788968400000, end_time ' +
  '1791560400000. A call may pass these values as written; an answer built on them states that ' +
  'window.';
const CONTROL_7D =
  "The window the person set in the app's time control is 2026-10-02 08:40 – 2026-10-09 08:39 " +
  'America/Los_Angeles (UTC-07:00) — client_activity start_time 1790955600000, end_time ' +
  '1791560400000. A call may pass these values as written; an answer built on them states that ' +
  'window.';

describe('the time limits line — served late, after the read', () => {
  it('30 days asked, 7 read: the answer call ends with the conclusion; the first call names only the control window', async () => {
    const { requests } = await run(
      [clampTool()],
      [call('c1', 'client_activity'), { content: '42 operations.' }],
      { from: iso(NOW_MS - 30 * DAY), to: NOW },
    );
    expect(requests).toHaveLength(2);
    expect(lastLine(requests[0]!)).toBe(`${TIME_LINE_SOURCE} ${CONTROL_30D}`);
    const line = lastLine(requests[1]!);
    expect(line).toMatch(
      new RegExp(
        `^${`${TIME_LINE_SOURCE} ${CONTROL_30D} The time the tools read is not the time asked about`.replace(
          /[[\]().]/g,
          '\\$&',
        )} — client_activity read less than was asked — asked: 2026-09-09 08:40:00`,
      ),
    );
    expect(line).toMatch(
      /; read: 2026-10-02 08:40:00 – 2026-10-09 08:39:59 America\/Los_Angeles \(UTC-07:00\)\. So the answer to the person states the time each result read and claims nothing about time no result read\.$/,
    );
  });

  it('7 days asked, 7 read: no limit — each request names only the control window', async () => {
    const { requests } = await run(
      [clampTool()],
      [call('c1', 'client_activity'), { content: '42 operations.' }],
      { from: iso(NOW_MS - 7 * DAY), to: NOW },
    );
    const only = `${TIME_LINE_SOURCE} ${CONTROL_7D}`;
    expect(requests.map(lastLine)).toEqual([only, only]);
  });

  it('older than the source keeps: the refusal is served as a limit', async () => {
    const { requests } = await run(
      [clampTool({ retention: '90d' })],
      [
        call('c1', 'client_activity', {
          start_time: NOW_MS - 120 * DAY,
          end_time: NOW_MS - 100 * DAY,
        }),
        { content: 'Nothing.' },
      ],
      undefined,
    );
    expect(lastLine(requests[1]!)).toContain(
      'client_activity: the time asked about is older than the oldest data the tool declares its source keeps',
    );
  });

  it('without .time() no request carries a line (byte identity of the wire)', async () => {
    const { requests } = await run(
      [clampTool()],
      [
        call('c1', 'client_activity', { start_time: NOW_MS - 30 * DAY, end_time: NOW_MS }),
        { content: '42.' },
      ],
      undefined,
      false,
    );
    expect(requests.map(lastLine)).toEqual([undefined, undefined]);
  });
});

describe('a shifted read — the conclusion, not two ranges to compare', () => {
  // A look-back that waits on a check-in runs after the clock moved on: it reads the HOUR BEFORE IT
  // RAN, not the hour asked. The T8 bench served the two ranges and the answer still claimed the
  // asked hour ("1 error in the last 30 minutes", 11/20), so the model is told which part of the
  // window the result does not cover, in the person's zone, and that the answer says so.
  function lookbackCheckIn() {
    return defineTool({
      name: 'client_activity',
      checkIn: 'always',
      description: 'Client operations over a look-back window.',
      inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
      askOrAssume: { window: { assume: '1h' } },
      period: { forms: [{ kind: 'lookback', argument: 'window', signed: false }] } as never,
      execute: () => '{"ops":42}',
    });
  }

  it('after a 30-minute check-in pause the answer call names the uncovered half hour and what the answer says', async () => {
    const requests: LLMRequest[] = [];
    const agent = Agent.create({
      provider: scripted(
        [call('c1', 'client_activity', { window: '1h' }), { content: '42 operations.' }],
        requests,
      ) as never,
      model: 'mock',
      maxIterations: 6,
    })
      .tools([lookbackCheckIn()])
      .time({ zone: LA })
      .limitsTravelWithTheAnswer()
      .build();
    const paused = await agent.run({ message: 'client activity', time: { now: NOW } });
    expect(isPaused(paused)).toBe(true);
    vi.setSystemTime(NOW_MS + 30 * 60_000);
    const out = await agent.resume(
      (paused as { checkpoint: never }).checkpoint,
      checkInApproved({ by: 'ops' }),
    );
    const line = lastLine(requests[requests.length - 1]!);
    expect(line).toBe(
      `${LEAD} — client_activity's look-back ran after the clock moved on, so its result does ` +
        'not cover 2026-10-09 07:40:00–08:09:59 America/Los_Angeles (UTC-07:00) of the window ' +
        'asked (2026-10-09 07:40:00–08:40:00 America/Los_Angeles (UTC-07:00)), and covers ' +
        '2026-10-09 08:40:00–09:10:00 America/Los_Angeles (UTC-07:00), outside it. So the ' +
        "answer says that client_activity's result does not cover 2026-10-09 07:40:00–08:09:59 " +
        'America/Los_Angeles (UTC-07:00), and claims nothing about that time from it. So the ' +
        'answer to the person states the time each result read and claims nothing about time no ' +
        'result read.',
    );
    // The PERSON's limits block keeps its bytes: two ranges, "a shifted window".
    expect(String(out)).toContain('- client_activity read a shifted window — asked: ');
  });
});

describe('timeLimitsSentence — the composition', () => {
  it('nothing to say → undefined', () => {
    expect(timeLimitsSentence(undefined)).toBeUndefined();
    expect(timeLimitsSentence({ period: [], clocks: [] })).toBeUndefined();
  });
  it('clocks only → the label alone, no period lead', () => {
    expect(
      timeLimitsSentence({
        period: [],
        clocks: ["the sources' clocks differ (UTC, America/New_York) — compared as instants"],
      }),
    ).toBe("Clocks: the sources' clocks differ (UTC, America/New_York) — compared as instants.");
  });
});

describe('timeLine — ONE line, opened once with who says it', () => {
  it('the opening names the library, not the person, and is no correction', () => {
    expect(TIME_LINE_SOURCE).toMatch(/^\[A note from the library that runs the tools/);
    expect(TIME_LINE_SOURCE).toContain('not from the person');
    expect(TIME_LINE_SOURCE).toContain('not a correction from them');
  });
  it('nothing to say → no line; one half → the opening, then that half', () => {
    expect(timeLine([])).toBeUndefined();
    expect(timeLine([undefined, undefined])).toBeUndefined();
    expect(timeLine(['', undefined])).toBeUndefined();
    expect(timeLine([undefined, 'Clocks: x.'])).toBe(`${TIME_LINE_SOURCE} Clocks: x.`);
  });
  it('both halves → the opening ONCE, first, the windows before the limits', () => {
    const line = timeLine(['The window for “yesterday” is not settled yet.', 'Clocks: x.'])!;
    expect(line).toBe(
      `${TIME_LINE_SOURCE} The window for “yesterday” is not settled yet. Clocks: x.`,
    );
    expect(line.split('A note from the library')).toHaveLength(2);
  });
});

describe('the limits facts cross the Tools mount unrendered — `timeLimitFactsOf` ↔ `timeLimitLinesOf`', () => {
  // The mount's `inputMapper` is synchronous and on every agent's graph, so it
  // hands FACTS (`coverage/timeLimitFacts.ts`) and the slot renders them under
  // the arm (`serve.ts` · `timeLimitsLine`). The facts must be absent exactly
  // when the rendered lines are, or the mount arg stops being value-conditional.
  const clock = {
    kind: 'clock',
    turn: 1,
    iteration: 1,
    now: NOW,
    nowSource: 'app',
    zone: LA,
    zoneSource: 'run',
  };
  const range = (from: string, to: string) => ({ from, to });
  const period = (extra: Record<string, unknown>) => ({
    kind: 'period',
    turn: 1,
    toolCallId: 'c1',
    toolName: 'client_activity',
    iteration: 1,
    verdict: 'covered',
    ...extra,
  });
  const clamp = period({
    differs: {
      against: 'asked',
      asked: range(iso(NOW_MS - 30 * DAY), NOW),
      read: [range(iso(NOW_MS - 7 * DAY), NOW)],
      source: 'declared',
      missing: [range(iso(NOW_MS - 30 * DAY), iso(NOW_MS - 7 * DAY))],
      extra: [],
    },
  });
  const source = (toolCallId: string, zone: string) => ({
    kind: 'source-clock',
    turn: 1,
    iteration: 1,
    toolCallId,
    toolName: toolCallId,
    zone,
  });
  const ledgers: Record<string, readonly unknown[]> = {
    'no clock': [clamp],
    'a matching read': [clock, period({})],
    'a partly-beyond-retention read only': [clock, period({ partlyBeyondRetention: true })],
    'a clamp': [clock, clamp],
    'a shifted look-back': [clock, period({ shifted: { byMs: 120_000 } })],
    'one wall-clock source': [clock, source('orders', 'America/New_York')],
    'two sources on different clocks': [
      clock,
      source('orders', 'America/New_York'),
      source('tickets', 'Europe/Berlin'),
    ],
  };

  for (const [name, ledger] of Object.entries(ledgers)) {
    for (const audience of ['person', 'model'] as const) {
      it(`${name} (${audience}): facts present ⇔ lines present, and the facts render to the lines`, async () => {
        const { timeLimitFactsOf } = await import(
          '../../../src/core/agent/coverage/timeLimitFacts.js'
        );
        const { renderTimeLimits, timeLimitLinesOf } = await import(
          '../../../src/core/agent/coverage/timeLimits.js'
        );
        const facts = timeLimitFactsOf(ledger, 1, audience);
        const lines = timeLimitLinesOf(ledger, 1, audience);
        expect(facts === undefined, name).toBe(lines === undefined);
        expect(renderTimeLimits(facts, audience)).toEqual(lines);
      });
    }
  }

  it('a matching read and one declared clock serve the model nothing — no key crosses', async () => {
    const { timeLimitFactsOf } = await import('../../../src/core/agent/coverage/timeLimitFacts.js');
    expect(timeLimitFactsOf([clock, period({})], 1, 'model')).toBeUndefined();
    expect(
      timeLimitFactsOf([clock, source('orders', 'America/New_York')], 1, 'model'),
    ).toBeUndefined();
    expect(
      timeLimitFactsOf([clock, source('orders', 'America/New_York')], 1, 'person'),
    ).toBeDefined();
  });
});
