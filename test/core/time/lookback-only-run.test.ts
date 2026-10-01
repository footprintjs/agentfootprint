/**
 * A past window on a look-back-only tool, and a future start/end pair the
 * person gave, through real agents (packet "lookback"). A scripted provider,
 * a FIXTURE reader, the English reader or a UI window, and the wall clock
 * pinned with fake `Date` — no model is called.
 *
 * Law: the person's window reaches the tool exactly, else WIDER with its
 * over-inclusion on the record, else the call is REFUSED with a named reason
 * that the served line turns into what the answer states — never a silent
 * read of the tool's own default. A start and end the person gave are one
 * window: judged against the tool's `direction` together, with the reader
 * armed or not.
 *
 * Test types:
 *   functional  — the call that ASKED is recorded like any fill once confirmed: its latest
 *                 `call-window` row is `filled` from the person's answer with `sent` and
 *                 `differs.extra`, `ctx.time` carries the asked range, the result check reads the
 *                 over-inclusion; a covering look-back over `maxRange` (a chat word or a UI
 *                 window) and a window still running are refused `no-form-holds` and the tool's
 *                 `assume: '1h'` never runs; a date whose readings a look-back tool can read only
 *                 in part offers only those; a future start/end the person gave is asked again
 *                 naming the fact, then refused — the tool never runs — with the reader and
 *                 without; so is a future pair given end-first, which names no window at all;
 *                 a past pair runs;
 *   integration — the clock at dispatch after the ask: the asking call's covering look-back ran
 *                 after the clock moved on and is recorded shifted, never silently; the served line
 *                 after a refusal names it as a conclusion instead of the pending ask (the T6b
 *                 bench's future case looped on that ask); a checkpoint carrying the open-reading
 *                 refusal row crosses the door;
 *   byte identity — without `.time()` a look-back-only tool runs on its rule as it always did,
 *                 and nothing is filed or served.
 * Unit, property, security, boundary, performance: lookback-only.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  defineTool,
  englishTimeReader,
  isInputPause,
  type TimeReader,
  type Tool,
  type ToolExecutionContext,
} from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { validateCheckpoint } from '../../../src/core/runCheckpoint.js';
import { timeRowIsWellFormed } from '../../../src/core/time/rows.js';
import { TIME_LINE_SOURCE } from '../../../src/core/agent/arguments/serve.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'time-lookback-mock',
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
const YESTERDAY = { from: '2026-10-08T07:00:00Z', to: '2026-10-09T07:00:00Z' };
const TODAY = { from: '2026-10-09T07:00:00Z', to: '2026-10-10T07:00:00Z' };

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
/** A call's LATEST `call-window` row — the window it ran with, or why it did not run. */
const windowOf = (agent: { findings(): unknown }, id: string) =>
  ofKind(agent, 'call-window')
    .filter((r) => r.toolCallId === id)
    .pop();

async function build(
  script: readonly Reply[],
  tools: readonly Tool[],
  arm: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
) {
  const s = scripted(script);
  const agent = arm(
    Agent.create({ provider: s.provider as never, model: 'mock', maxIterations: 8 }).tools(tools),
  ).build();
  return { agent, requests: s.requests };
}

type Paused = {
  checkpoint: unknown;
  awaitingInput: {
    requestId: string;
    fields: readonly { id: string; enum?: readonly string[]; description?: string }[];
  };
};
function paused(out: unknown): Paused {
  if (!isInputPause(out)) throw new Error('expected an input pause');
  return out as never as Paused;
}
const resumeWith = (
  agent: { resume(c: never, i: never): Promise<unknown> },
  out: unknown,
  values: Record<string, unknown>,
) => {
  const p = paused(out);
  return agent.resume(
    p.checkpoint as never,
    { requestId: p.awaitingInput.requestId, values } as never,
  );
};

/** The late time line of a request: the request-only `user` line appended LAST, if any. */
function timeLineOf(req: LLMRequest | undefined, message: string): string | undefined {
  const last = req?.messages[req.messages.length - 1];
  if (last?.role !== 'user' || typeof last.content !== 'string') return undefined;
  return last.content === message ? undefined : last.content;
}
/** The tool message of the LAST request — the latest call's result. */
const lastToolMessage = (requests: readonly LLMRequest[]) =>
  requests[requests.length - 1]!.messages.filter((m) => m.role === 'tool').pop()!.content as string;

/** A look-back-only search, as the `{ argument, spelling }` sugar declares it. */
function lookbackTool(facts: Record<string, unknown> = {}, seen: Record<string, unknown>[] = []) {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines over a look-back window.',
    inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
    askOrAssume: { window: { assume: '1h' } },
    period: { argument: 'window', spelling: 'lookback', ...facts } as never,
    execute: (args, ctx: ToolExecutionContext) => {
      seen.push({ ...args, ...(ctx.time !== undefined && { time: ctx.time }) });
      return 'no errors';
    },
  });
}

/** Two epoch-ms arguments the person is asked for when the model leaves them out. */
function epochTool(facts: Record<string, unknown> = {}, seen: Record<string, unknown>[] = []) {
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
      ...facts,
    } as never,
    execute: (args) => {
      seen.push(args);
      return '{"ops":42}';
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS + 5_000);
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── the asking call, widened ────────────────────────────────────────

describe('the call that asked is recorded like any fill — the covering look-back, wider', () => {
  it('its latest call-window row is filled from the answer, with sent and differs.extra', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = await build(
      [call('c0', 'search_logs'), answer('none')],
      [lookbackTool({}, seen)],
      (b) => b.time({ zone: LA, reader: yesterdayReader }),
    );
    const first = await agent.run({ message: 'any errors yesterday?', time: { now: NOW } });
    const offered = paused(first).awaitingInput.fields[0]!.enum![0]!;
    await resumeWith(agent as never, first, { f1: offered });
    // 8 Oct 00:00 PDT (07:00Z) to now is 32h40m: the smallest covering look-back in minutes.
    expect(seen).toMatchObject([
      {
        window: '1960m',
        time: { asked: { from: '2026-10-08T00:00:00-07:00', to: '2026-10-09T00:00:00-07:00' } },
      },
    ]);
    expect(windowOf(agent, 'c0')).toMatchObject({
      how: 'filled',
      form: 0,
      asked: { from: '2026-10-08T00:00:00-07:00', to: '2026-10-09T00:00:00-07:00' },
      person: { source: 'answered', mention: 0 },
      sent: { from: '2026-10-08T07:00:00Z', to: '2026-10-09T15:40:00.001Z' },
      differs: { extra: [{ from: '2026-10-09T07:00:00Z', to: '2026-10-09T15:40:00.001Z' }] },
    });
    // The result check reads the over-inclusion: read but not asked.
    const period = ofKind(agent, 'period').find((r) => r.toolCallId === 'c0')!;
    expect(period.differs).toMatchObject({
      source: 'sent',
      missing: [],
      extra: [{ from: '2026-10-09T07:00:00Z', to: '2026-10-09T15:40:00.001Z' }],
    });
    for (const row of rows(agent)) {
      if (row.kind === 'call-window') expect(timeRowIsWellFormed(row)).toBe(true);
    }
  });

  it('the clock at dispatch — answered ten minutes later, the look-back is recorded shifted', async () => {
    const { agent } = await build(
      [call('c0', 'search_logs'), answer('none')],
      [lookbackTool()],
      (b) => b.time({ zone: LA, reader: yesterdayReader }),
    );
    const first = await agent.run({ message: 'any errors yesterday?', time: { now: NOW } });
    vi.setSystemTime(NOW_MS + 10 * 60_000);
    await resumeWith(agent as never, first, {
      f1: paused(first).awaitingInput.fields[0]!.enum![0]!,
    });
    const callRow = ofKind(agent, 'call').find((r) => r.toolCallId === 'c0')!;
    expect(callRow.drift).toEqual({ byMs: 600_000, outcome: 'shifted' });
    expect(ofKind(agent, 'period').find((r) => r.toolCallId === 'c0')).toMatchObject({
      shifted: { byMs: 600_000 },
    });
  });
});

// ─── no form holds it: refused, by name ───────────────────────────────

describe('no form can read the window, even wider — refused, never run on the tool’s rule', () => {
  it('a chat word whose every reading needs a look-back over maxRange: nothing asked, refused', async () => {
    const seen: Record<string, unknown>[] = [];
    const message = 'any errors yesterday?';
    const { agent, requests } = await build(
      [call('c0', 'search_logs'), answer('out of reach')],
      [lookbackTool({ maxRange: '24h' }, seen)],
      (b) => b.time({ zone: LA, reader: yesterdayReader }),
    );
    const out = await agent.run({ message, time: { now: NOW } });
    expect(isInputPause(out)).toBe(false);
    expect(seen).toEqual([]);
    expect(windowOf(agent, 'c0')).toEqual(
      expect.objectContaining({ how: 'refused', refused: 'no-form-holds' }),
    );
    expect(ofKind(agent, 'argument')).toEqual([]);
    expect(lastToolMessage(requests)).toContain(
      'search_logs was not run on that call: no period form the tool declares can read the ' +
        'window it asked for, exactly or by reading a wider one, within the most the tool ' +
        'declares it reads at once (maxRange 24h).',
    );
    // The late line: the refusal as a conclusion — not the pending ask naming that call again.
    expect(timeLineOf(requests[1], message)).toBe(
      `${TIME_LINE_SOURCE} ` +
        'search_logs was not run for “yesterday”: no period form the tool declares can read the ' +
        'window it asked for, exactly or by reading a wider one, within the most the tool ' +
        'declares it reads at once (maxRange 24h). So the answer tells the person that ' +
        'search_logs could not read that time, and claims nothing about it from search_logs.',
    );
  });

  it.each([
    ['yesterday, over maxRange', YESTERDAY, { maxRange: '24h' }],
    ['today, still running', TODAY, {}],
  ])(
    'a UI window (%s): refused with the window, the assumed 1h never runs',
    async (_, window, facts) => {
      const seen: Record<string, unknown>[] = [];
      const { agent } = await build(
        [call('c0', 'search_logs'), answer('out of reach')],
        [lookbackTool(facts, seen)],
        (b) => b.time({ zone: LA }),
      );
      await agent.run({ message: 'any errors?', time: { now: NOW, window } });
      expect(seen).toEqual([]);
      expect(windowOf(agent, 'c0')).toMatchObject({
        how: 'refused',
        refused: 'no-form-holds',
        asked: window,
        person: { source: 'control' },
      });
      expect(ofKind(agent, 'argument')).toEqual([]);
    },
  );

  it('a date read three ways offers only the reading the look-back tool can reach', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = await build(
      [call('c0', 'search_logs'), answer('none')],
      [lookbackTool({ maxRange: '7d' }, seen)],
      (b) => b.time({ zone: LA, reader: englishTimeReader() }),
    );
    const first = await agent.run({ message: 'Any errors on 10/08/26?', time: { now: NOW } });
    const field = paused(first).awaitingInput.fields[0]!;
    // Month-day-year (8 Oct) is in reach; day-month (10 Aug) and year-first (2010) are not.
    expect(field.enum).toEqual(['2026-10-08T00:00:00-07:00/2026-10-09T00:00:00-07:00']);
    await resumeWith(agent as never, first, { f1: field.enum![0]! });
    expect(seen).toMatchObject([{ window: '1960m' }]);
    expect(windowOf(agent, 'c0')).toMatchObject({ how: 'filled', person: { source: 'answered' } });
  });

  it('a checkpoint carrying the open-reading refusal row crosses the door', async () => {
    const { agent } = await build(
      [call('c0', 'search_logs'), answer('out of reach')],
      [lookbackTool({ maxRange: '24h' })],
      (b) => b.time({ zone: LA, reader: yesterdayReader }),
    );
    await agent.run({ message: 'any errors yesterday?', time: { now: NOW } });
    const cp = JSON.parse(JSON.stringify(agent.checkpoint())) as Record<string, unknown>;
    expect(JSON.stringify(cp)).toContain('"refused":"no-form-holds"');
    expect(() => validateCheckpoint(cp)).not.toThrow();
  });
});

// ─── the future pair the person gave ─────────────────────────────────

describe('a start and end the person gave are one window — judged against direction, both arms', () => {
  const tomorrowFrom = Date.parse('2026-10-10T07:00:00Z');
  const tomorrowTo = Date.parse('2026-10-11T07:00:00Z');

  it.each([
    ['without the reader', (b: ReturnType<typeof Agent.create>) => b.time({ zone: LA })],
    [
      'with the reader',
      (b: ReturnType<typeof Agent.create>) => b.time({ zone: LA, reader: englishTimeReader() }),
    ],
  ])('%s: asked again naming the fact, then refused — the tool never runs', async (_, arm) => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = await build(
      [call('c1', 'client_activity'), answer('cannot')],
      [epochTool({ direction: 'past' }, seen)],
      arm,
    );
    let out = await agent.run({ message: 'Show client activity', time: { now: NOW } });
    for (let round = 0; round < 3; round++) {
      expect(isInputPause(out)).toBe(true);
      out = await resumeWith(agent as never, out, { f1: tomorrowFrom, f2: tomorrowTo });
    }
    expect(isInputPause(out)).toBe(false);
    expect(seen).toEqual([]);
    expect(ofKind(agent, 'argument').filter((r) => r.source === 'answered')).toEqual([]);
    expect(lastToolMessage(requests)).toContain(
      'a window that has already happened (the source holds only the past)',
    );
  });

  it.each([
    ['without the reader', (b: ReturnType<typeof Agent.create>) => b.time({ zone: LA })],
    [
      'with the reader',
      (b: ReturnType<typeof Agent.create>) => b.time({ zone: LA, reader: englishTimeReader() }),
    ],
  ])(
    '%s: a future pair given end-first names no window — asked again, then refused, never run',
    async (_, arm) => {
      const seen: Record<string, unknown>[] = [];
      const { agent, requests } = await build(
        [call('c1', 'client_activity'), answer('cannot')],
        [epochTool({ direction: 'past' }, seen)],
        arm,
      );
      let out = await agent.run({ message: 'Show client activity', time: { now: NOW } });
      for (let round = 0; round < 3; round++) {
        expect(isInputPause(out)).toBe(true);
        out = await resumeWith(agent as never, out, { f1: tomorrowTo, f2: tomorrowFrom });
      }
      expect(isInputPause(out)).toBe(false);
      expect(seen).toEqual([]);
      expect(ofKind(agent, 'argument').filter((r) => r.source === 'answered')).toEqual([]);
      expect(lastToolMessage(requests)).toContain(
        "a window one of the tool's declared period forms can hold",
      );
    },
  );

  it('a past pair the person gave runs as given', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = await build(
      [call('c1', 'client_activity'), answer('ok')],
      [epochTool({ direction: 'past' }, seen)],
      (b) => b.time({ zone: LA }),
    );
    const out = await agent.run({ message: 'Show client activity', time: { now: NOW } });
    const from = Date.parse(YESTERDAY.from);
    const to = Date.parse(YESTERDAY.to);
    await resumeWith(agent as never, out, { f1: from, f2: to });
    expect(seen).toEqual([{ start_time: from, end_time: to }]);
  });
});

// ─── the served line after a refusal ─────────────────────────────────

describe('the served line — a refused reading is a conclusion, not the next call', () => {
  it('a future date to a past-only tool: refused, and the next request concludes it', async () => {
    const message = 'Show client activity on 10/20/26';
    const { agent, requests } = await build(
      [call('c1', 'client_activity'), answer('not yet')],
      [epochTool({ direction: 'past' })],
      (b) => b.time({ zone: LA, reader: englishTimeReader() }),
    );
    await agent.run({ message, time: { now: NOW } });
    expect(windowOf(agent, 'c1')).toMatchObject({ how: 'refused', refused: 'time-future' });
    expect(timeLineOf(requests[0], message)).toContain('is not settled yet');
    expect(timeLineOf(requests[1], message)).toBe(
      `${TIME_LINE_SOURCE} ` +
        'client_activity was not run for “10/20/26”: the window it asked for had not happened yet, ' +
        'and the tool declares that its source holds only the past. So the answer tells the ' +
        'person that client_activity could not read that time, and claims nothing about it from ' +
        'client_activity.',
    );
  });
});

// ─── byte identity ───────────────────────────────────────────────────

describe('byte identity — without .time() a look-back-only tool runs on its rule', () => {
  it('the assumed 1h runs; no time row is filed and no line is served', async () => {
    const seen: Record<string, unknown>[] = [];
    const message = 'any errors yesterday?';
    const { agent, requests } = await build(
      [call('c0', 'search_logs'), answer('none')],
      [lookbackTool({ maxRange: '24h' }, seen)],
      (b) => b,
    );
    await agent.run({ message });
    expect(seen).toEqual([{ window: '1h' }]);
    expect(ofKind(agent, 'call-window')).toEqual([]);
    expect(timeLineOf(requests[1], message)).toBeUndefined();
  });
});
