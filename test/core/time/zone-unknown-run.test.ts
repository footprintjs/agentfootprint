/**
 * G15 — `.time()` with NO zone known (an app deployed without its zone
 * setting). Before, the run was refused, so an app that could not name a zone
 * could not arm the layer at all: "Always confirm" silently became "never
 * confirm" and tools ran on their defaults.
 *
 * Law: the zone is never guessed. With no run zone and no builder fallback
 * the clock records `zoneSource: 'unknown'` and spells instants in UTC; every
 * reading of the person's words that names no zone of its own waits on their
 * zone, which the time ask asks FIRST ("Which time zone are you in?"); the
 * zone the person answers holds for the turns after it (`zoneSource:
 * 'answered'`). Every line that shows a time while the zone is unknown says
 * it is in UTC because the person's zone is not known.
 *
 * Test types:
 *   unit        — the resolver: a mention with no zone of its own resolves to nothing and asks
 *                 the zone (a look-back too); a mention that names its zone resolves; the ask's
 *                 question names the person's zone, not a token; the limits name the unknown zone;
 *   functional  — "any client activity yesterday?" under `.time({ reader })` with no zone: the
 *                 zone is asked first, then yesterday is offered in the answered zone, and the
 *                 tool runs that day;
 *   integration — the next turn of the conversation reads in the answered zone with no zone ask;
 *                 a control window is served in UTC and named as such, and fills the call exactly;
 *   security    — no wall time is judged under the UTC spelling (an unknown zone is not a zone);
 *   byte identity — an app that passes a zone is unchanged (every other suite in this folder).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  defineTool,
  englishTimeReader,
  isInputPause,
  type Tool,
  type ToolExecutionContext,
} from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { TIME_LINE_SOURCE } from '../../../src/core/agent/arguments/serve.js';
import {
  chooseReading,
  DEFAULT_TIME_POLICY,
  resolveMention,
} from '../../../src/core/time/resolve.js';
import { timeAskOf } from '../../../src/core/time/readingAsk.js';
import { answeredZoneOf, type TimeReadingRow } from '../../../src/core/time/rows.js';
import {
  renderTimeLimits,
  UNKNOWN_ZONE_LINE,
} from '../../../src/core/agent/coverage/timeLimits.js';
import { defaultTimeAskMessages } from '../../../src/locales/timeAsk.js';
import { readTimeContext, timeContextOf } from '../../../src/core/time/wire.js';

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'time-zone-unknown-mock',
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
const UNKNOWN = { now: NOW, zone: 'UTC', zoneSource: 'unknown' } as const;
const RULE = { id: 'agentfootprint/english', kind: 'rule' as const };

type Row = { kind: string } & Record<string, unknown>;
const ofKind = (agent: { findings(): unknown }, kind: string): Row[] =>
  ((agent.findings() as Row[] | undefined) ?? []).filter((r) => r.kind === kind);

/** Two epoch-ms arguments, both asked by the tool's own rule — an absolute form. */
function epochTool(seen: Record<string, unknown>[] = []) {
  return defineTool({
    name: 'client_activity',
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
    } as never,
    execute: (args, ctx: ToolExecutionContext) => {
      seen.push({
        ...args,
        ...(ctx.time !== undefined && { zone: ctx.time.zone }),
        ...(ctx.time?.zoneUnknown === true && { zoneUnknown: true }),
      });
      return '{"ops":42}';
    },
  });
}

function build(script: readonly Reply[], tools: readonly Tool[], reader = true) {
  const s = scripted(script);
  const agent = Agent.create({ provider: s.provider as never, model: 'mock', maxIterations: 6 })
    .tools(tools)
    .time(reader ? { reader: englishTimeReader() } : {})
    .build();
  return { agent, requests: s.requests };
}

type Field = { id: string; format?: string; description?: string; enum?: readonly string[] };
function paused(result: unknown) {
  if (!isInputPause(result)) throw new Error('expected an input pause');
  return result as never as {
    checkpoint: unknown;
    awaitingInput: { requestId: string; question: string; fields: readonly Field[] };
  };
}

function timeLineOf(req: LLMRequest | undefined): string | undefined {
  const last = req?.messages[req.messages.length - 1];
  if (last?.role !== 'user' || typeof last.content !== 'string') return undefined;
  return last.content.startsWith(TIME_LINE_SOURCE) ? last.content : undefined;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS + 5_000);
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── unit: the resolver never reads words in a zone nobody named ──────────

describe('G15 — the resolver under an unknown zone', () => {
  it('a mention that names no zone resolves to NOTHING and asks the zone — a look-back too', () => {
    for (const parts of [
      { relative: { unit: 'day', offset: -1 } },
      { wall: { h: 8, meridiem: 'am' } },
      { relative: { unit: 'hour', count: 2 } },
      { rangeOf: [{ wall: { h: 8, meridiem: 'am' } }, { wall: { h: 9, meridiem: 'am' } }] },
    ] as const) {
      const res = resolveMention([parts as never], UNKNOWN, RULE, true);
      expect(res, JSON.stringify(parts)).toEqual({
        candidates: [],
        needsZone: true,
        unsupported: [],
      });
      expect(chooseReading(res, DEFAULT_TIME_POLICY, 'rule', undefined, true)).toEqual({
        by: 'open',
        remaining: [],
        open: ['zone'],
      });
    }
  });

  it('a mention that NAMES its zone resolves as before — the person said it', () => {
    const named = resolveMention(
      [{ wall: { h: 8, meridiem: 'am' }, zoneToken: 'Europe/London' }],
      UNKNOWN,
      RULE,
      true,
    );
    expect(named.needsZone).toBe(false);
    expect(named.candidates.map((c) => c.range.from)).toEqual(['2026-10-09T08:00:00+01:00']);
  });

  it('GUARD: a known zone reads as it always did', () => {
    const known = resolveMention(
      [{ relative: { unit: 'day', offset: -1 } }],
      { now: NOW, zone: LA },
      RULE,
      true,
    );
    expect(known.candidates.map((c) => c.range.from)).toEqual(['2026-10-08T00:00:00-07:00']);
  });

  it('the zone ask names the PERSON’s zone, not a token they never wrote', () => {
    const row = {
      kind: 'time-reading',
      turn: 1,
      iteration: 1,
      reader: { ...RULE, version: '1.2.0', locale: 'en-US' },
      tzdata: 'test',
      mentions: 1,
      mention: 0,
      quote: 'yesterday',
      parses: [{ relative: { unit: 'day', offset: -1 } }],
      candidates: [],
      choice: { by: 'open', remaining: [], open: ['zone'] },
    } as unknown as TimeReadingRow;
    expect(timeAskOf(row, defaultTimeAskMessages)).toEqual({
      question: 'Which time zone are you in? It decides which time “yesterday” is.',
      field: { id: 'time', type: 'string', required: true, format: 'zone' },
    });
  });

  it('the tool’s time context says the zone is unknown, and the wire reads it back — `true` only', () => {
    const ctx = timeContextOf(undefined, UNKNOWN, NOW);
    expect(ctx).toEqual({
      version: 1,
      zone: 'UTC',
      zoneUnknown: true,
      now: NOW,
      dispatchedAt: NOW,
    });
    expect(readTimeContext(JSON.parse(JSON.stringify(ctx)))).toEqual(ctx);
    expect(readTimeContext({ ...ctx, zoneUnknown: false })).toBeUndefined();
    expect(timeContextOf(undefined, { now: NOW, zone: LA }, NOW)).not.toHaveProperty('zoneUnknown');
  });

  it('the limits lines say why their ranges are in UTC — for the person and for the model', () => {
    const facts = {
      zone: 'UTC',
      zoneUnknown: true as const,
      sources: [],
      period: [
        {
          kind: 'period',
          turn: 1,
          iteration: 1,
          verdict: 'covered',
          toolCallId: 'c1',
          toolName: 'client_activity',
          differs: {
            against: 'asked',
            asked: { from: '2026-09-09T15:40:00Z', to: '2026-10-09T15:40:00Z' },
            read: [{ from: '2026-10-02T15:40:00Z', to: '2026-10-09T15:40:00Z' }],
            source: 'queried',
            missing: [{ from: '2026-09-09T15:40:00Z', to: '2026-10-02T15:40:00Z' }],
            extra: [],
          },
        },
      ],
    };
    for (const audience of ['person', 'model'] as const) {
      const lines = renderTimeLimits(facts as never, audience);
      expect(lines?.clocks).toContain(UNKNOWN_ZONE_LINE);
      expect(lines?.period[0]).toContain('UTC');
    }
    expect(
      renderTimeLimits({ ...facts, zoneUnknown: undefined } as never)?.clocks ?? [],
    ).not.toContain(UNKNOWN_ZONE_LINE);
  });
});

// ─── functional + integration: through real agents ────────────────────────

describe('G15 — an agent with no zone anywhere asks the person’s zone first, then reads in it', () => {
  it('“yesterday”: the zone is asked, yesterday is offered in that zone, the tool runs that day, and the next turn reads in it', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = build(
      [
        call('c1', 'client_activity'),
        answer('42 operations'),
        call('c2', 'client_activity'),
        answer('7'),
      ],
      [epochTool(seen)],
    );
    const zone = paused(
      await agent.run({ message: 'any client activity yesterday?', time: { now: NOW } }),
    );
    expect(ofKind(agent, 'clock')).toMatchObject([{ zone: 'UTC', zoneSource: 'unknown' }]);
    // The line before the ask: the instant in UTC, the zone named as not known.
    expect(timeLineOf(requests[0])).toContain(
      "This turn's time: Friday 2026-10-09 15:40 UTC (the person's time zone is not known).",
    );
    expect(zone.awaitingInput.fields).toMatchObject([
      {
        format: 'zone',
        description: 'Which time zone are you in? It decides which time “yesterday” is.',
      },
    ]);
    const readings = paused(
      await agent.resume(zone.checkpoint as never, {
        requestId: zone.awaitingInput.requestId,
        values: { f1: LA },
      }),
    );
    const field = readings.awaitingInput.fields[0]!;
    expect(field.enum).toEqual(['2026-10-08T00:00:00-07:00/2026-10-09T00:00:00-07:00']);
    const done = await agent.resume(readings.checkpoint as never, {
      requestId: readings.awaitingInput.requestId,
      values: { f1: field.enum![0]! },
    });
    expect(isInputPause(done)).toBe(false);
    expect(seen[0]).toMatchObject({
      start_time: Date.parse('2026-10-08T07:00:00Z'),
      end_time: Date.parse('2026-10-09T07:00:00Z'),
    });
    expect(ofKind(agent, 'time-answer')).toMatchObject([{ zone: LA, how: 'confirmed' }]);
    expect(answeredZoneOf(agent.findings() as never)).toBe(LA);

    // The next turn: the answered zone holds — recorded, and the reading needs no zone ask.
    const next = paused(await agent.followUp('and yesterday again?', { time: { now: NOW } }));
    expect(ofKind(agent, 'clock').map((c) => [c.zone, c.zoneSource])).toEqual([
      ['UTC', 'unknown'],
      [LA, 'answered'],
    ]);
    expect(next.awaitingInput.fields[0]).toMatchObject({
      format: 'time-range',
      enum: ['2026-10-08T00:00:00-07:00/2026-10-09T00:00:00-07:00'],
    });
    const last = requests[requests.length - 1];
    expect(timeLineOf(last)).toContain(
      "This turn's time: Friday 2026-10-09 08:40 America/Los_Angeles",
    );
  });

  it('a window the app set in its control is served in UTC, named as such, and fills the call exactly', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = build(
      [call('c1', 'client_activity'), answer('ok')],
      [epochTool(seen)],
      false,
    );
    const window = { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:30:00Z' };
    const out = await agent.run({ message: 'any client activity?', time: { now: NOW, window } });
    expect(isInputPause(out)).toBe(false);
    expect(timeLineOf(requests[0])).toBe(
      `${TIME_LINE_SOURCE} This turn's time: Friday 2026-10-09 15:40 UTC (the person's time zone is not ` +
        "known). The window the person set in the app's time control is 2026-10-09 15:00–15:29 " +
        "UTC (the person's time zone is not known) — client_activity start_time " +
        `${Date.parse(window.from)}, end_time ${Date.parse(window.to)}. A call may pass these ` +
        'values as written; an answer built on them states that window.',
    );
    // The zone is named once — never "UTC, in UTC".
    expect(timeLineOf(requests[0])).not.toMatch(/UTC,? in UTC/);
    expect(seen).toEqual([
      {
        start_time: Date.parse(window.from),
        end_time: Date.parse(window.to),
        zone: 'UTC',
        // The tool is told the zone is only a spelling — never the person's.
        zoneUnknown: true,
      },
    ]);
  });

  it('SECURITY: an unknown zone judges no wall time — UTC is a spelling, not the person’s zone', async () => {
    // A free-entry answer is judged without a zone, so a wall time UTC never skips is not
    // "checked" against a zone nobody named; the answer's own offsets carry it.
    const { agent } = build([call('c1', 'client_activity'), answer('ok')], [epochTool()]);
    const zone = paused(
      await agent.run({ message: 'any client activity yesterday?', time: { now: NOW } }),
    );
    expect(zone.awaitingInput.fields[0]!.format).toBe('zone');
    const refused = await agent.resume(zone.checkpoint as never, {
      requestId: zone.awaitingInput.requestId,
      values: { f1: 'PST' },
    });
    // An abbreviation is no zone: asked again, never read as one.
    expect(isInputPause(refused)).toBe(true);
    expect(ofKind(agent, 'time-answer')).toEqual([]);
  });
});
