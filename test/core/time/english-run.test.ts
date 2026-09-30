/**
 * The English reader through real agents (time design § 5.3, TQ13, step T6b):
 * `.time({ reader: englishTimeReader() })`, the one served time sentence on a
 * tool that declares a period, and the lazy word-driven ask. A scripted
 * provider and the wall clock pinned with fake `Date` — no model is called.
 *
 * Law: the library reads the person's words only through the armed reader,
 * and a reading only PROPOSES (the owner's decision "Always confirm", time
 * design TQ29): every window read from chat is offered through the time ask,
 * pre-filled and editable, with its window AND its zone — the zone first when
 * they wrote an abbreviation. Only what the person picks or types in that
 * form is theirs (a `time-answer` row, `confirmed` or `edited`); from then on
 * the turn's later calls are filled from it and the served sentence names it
 * with its source.
 *
 * Test types:
 *   functional  — the field sentence "10/09/26 8 AM to 8:40 AM PST": a zone ask naming `PST`,
 *                 then the three date orders as labelled confirmations, then the tool runs with
 *                 the chosen window in its own form (`answered` rows, the note says whose
 *                 window); a row from each of the seven review rounds and every form the earlier
 *                 allow-list filed as said ("last 2 hours", an explicit ISO instant) pauses on a
 *                 confirmation — never said; a confirmed pre-fill is filed `answered` with the
 *                 click recorded (`time-answer`, `how: 'confirmed'`), an edited one as the
 *                 person's window (`how: 'edited'`); a tool whose rule ASSUMES its period is asked,
 *                 its default never standing in for the words; "yesterday morning" and "last
 *                 week" → one `unreadable` row each, no pre-fill (the tool's own rule asks); a
 *                 future date to a `past` tool is refused before dispatch; the reader edges
 *                 (packet "reader"): "yesterday 8 AM to 9 AM" is offered and run as one hour,
 *                 "yesterday London time" as the London day (an edit recorded in London, an
 *                 edit in a bare offset in that offset's zone), and the field sentence under the
 *                 app's PST map + MDY is ONE confirmation offering the zone's and the letters'
 *                 readings;
 *   integration — the ask's checkpoint crosses a JSON round trip onto a FRESH agent and binds;
 *                 after the confirmation the next request serves the window with its source in
 *                 both dynamic modes; classic mode caches its tools (the known limit) and still
 *                 fills the later call;
 *   security    — an answered window outside the tool's `direction` is asked again, never run;
 *   byte identity — without a reader nothing is served or asked: the request's tool list equals
 *                 the reader-less twin's; a turn with nothing confirmed serves the bytes it
 *                 always did.
 * Unit, property, boundary, performance: english-reader.test.ts.
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

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'time-english-mock',
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
const FIELD = 'Show client activity 10/09/26 8 AM to 8:40 AM PST';
/** `[NOW − 2h, NOW)` as `time/present.ts` · `presentRange` writes it in Los Angeles. */
const WINDOW_2H = '2026-10-09 06:40–08:40 America/Los_Angeles (UTC-07:00)';

type Row = { kind: string } & Record<string, unknown>;
const rows = (agent: { findings(): unknown }): Row[] =>
  ((agent.findings() as Row[] | undefined) ?? []).map((r) => ({ ...r }));
const ofKind = (agent: { findings(): unknown }, kind: string) =>
  rows(agent).filter((r) => r.kind === kind);

type Mode = 'dynamic' | 'dynamic-grouped' | 'classic';

function build(
  script: readonly Reply[],
  tools: readonly Tool[],
  arm: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  mode?: Mode,
) {
  const s = scripted(script);
  const agent = arm(
    Agent.create({
      provider: s.provider as never,
      model: 'mock',
      maxIterations: 6,
      ...(mode !== undefined && { reactMode: mode }),
    }).tools(tools),
  ).build();
  return { agent, requests: s.requests };
}

/** Two epoch-ms arguments, both asked by the tool's own rule — an absolute form. */
function epochTool(seen: Record<string, unknown>[] = [], facts: Record<string, unknown> = {}) {
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
    execute: (args, ctx: ToolExecutionContext) => {
      seen.push({ ...args, ...(ctx.time !== undefined && { time: ctx.time }) });
      return '{"ops":42}';
    },
  });
}

/** A look-back-only search, as today's `{ argument, spelling }` sugar declares it. */
function lookbackTool(seen: Record<string, unknown>[] = []) {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines over a look-back window.',
    inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
    askOrAssume: { window: { assume: '1h' } },
    period: { argument: 'window', spelling: 'lookback' } as never,
    execute: (args) => {
      seen.push(args);
      return 'no errors';
    },
  });
}

const reader = englishTimeReader();

/** The pending half of the served time line (`arguments/serve.ts` · `timeWindowsLine`). */
const pendingLine = (quote: string, calls: string): string =>
  `The window for “${quote}” is not settled yet: the person confirms it in the library's own ` +
  `form, which shows its reading of those words with the zone and opens when ${calls} (or the ` +
  'call is refused with the reason). So the next step is that call — not a question about the ' +
  'time in the reply, and not a window written into the call, which would run unconfirmed.';

/**
 * The late time line of a request (step T6b): the request-only `user` line appended LAST, after
 * the person's message or the latest tool result — `undefined` when the request carries none.
 */
function timeLineOf(req: LLMRequest | undefined): string | undefined {
  const last = req?.messages[req.messages.length - 1];
  if (last?.role !== 'user' || typeof last.content !== 'string') return undefined;
  return last.content.startsWith("The person's time words") ||
    last.content.startsWith('The window for “')
    ? last.content
    : undefined;
}

function paused(result: unknown) {
  if (!isInputPause(result)) throw new Error('expected an input pause');
  return result as never as {
    checkpoint: unknown;
    awaitingInput: {
      requestId: string;
      question: string;
      fields: readonly {
        id: string;
        format?: string;
        description?: string;
        enum?: readonly string[];
        labels?: readonly string[];
      }[];
    };
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS + 5_000);
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── the lazy word-driven ask ─────────────────────────────────────────

describe('the field sentence — the zone, then the date order, then the tool runs', () => {
  it('asks the zone for "PST", then the three readings, then runs with the chosen window', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = build(
      [call('c1', 'client_activity', {}), answer('42 operations')],
      [epochTool(seen)],
      (b) => b.time({ zone: LA, reader }),
    );
    const first = paused(await agent.run({ message: FIELD, time: { now: NOW } }));
    expect(first.awaitingInput.fields).toHaveLength(1);
    expect(first.awaitingInput.fields[0]).toMatchObject({
      format: 'zone',
      description: 'Which time zone did you mean by “PST” in “10/09/26 8 AM to 8:40 AM PST”?',
    });
    expect(ofKind(agent, 'time-reading')[0]).toMatchObject({
      quote: '10/09/26 8 AM to 8:40 AM PST',
      reader: { id: 'agentfootprint/english', version: '1.1.0', kind: 'rule', locale: 'en-US' },
      choice: { by: 'open', remaining: [], open: ['zone'] },
    });
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({
      how: 'not-filled',
      why: 'open-reading',
    });

    const second = paused(
      await agent.resume(first.checkpoint as never, {
        requestId: first.awaitingInput.requestId,
        values: { f1: LA },
      }),
    );
    const field = second.awaitingInput.fields[0]!;
    expect(field.format).toBe('time-range');
    // Off the reader's allow-list (a numeric date): every reading is offered to CONFIRM, with its zone.
    expect(field.description).toBe('Is this the time you meant by “10/09/26 8 AM to 8:40 AM PST”?');
    expect(field.enum).toEqual([
      '2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00',
      '2026-09-10T08:00:00-07:00/2026-09-10T08:41:00-07:00',
      '2010-09-26T08:00:00-07:00/2010-09-26T08:41:00-07:00',
    ]);
    expect(field.labels).toHaveLength(3);
    expect(field.labels![0]).toContain('PDT');
    expect(field.labels![0]).toContain('in America/Los_Angeles');
    expect(seen).toEqual([]);

    const done = await agent.resume(second.checkpoint as never, {
      requestId: second.awaitingInput.requestId,
      values: { f1: field.enum![0]! },
    });
    expect(isInputPause(done)).toBe(false);
    // 08:00 PDT is 15:00Z; the exclusive end is 08:41 PDT.
    expect(seen[0]).toMatchObject({ start_time: 1791558000000, end_time: 1791560460000 });
    expect(ofKind(agent, 'argument')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ argument: 'start_time', source: 'answered' }),
        expect.objectContaining({ argument: 'end_time', source: 'answered' }),
      ]),
    );
    const tool = requests[requests.length - 1]!.messages.find((m) => m.role === 'tool')!;
    expect(tool.content as string).toContain(
      "from the window the person chose when asked what their words meant — recorded as the person's answer",
    );
  });

  it("under `dateOrder: 'MDY'` the zone answer leaves one reading — confirmed with its zone", async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'client_activity', {}), answer('42 operations')],
      [epochTool(seen)],
      (b) => b.time({ zone: LA, reader, policy: { dateOrder: 'MDY' } }),
    );
    const first = paused(await agent.run({ message: FIELD, time: { now: NOW } }));
    const second = paused(
      await agent.resume(first.checkpoint as never, {
        requestId: first.awaitingInput.requestId,
        values: { f1: LA },
      }),
    );
    const field = second.awaitingInput.fields[0]!;
    expect(field.enum).toEqual(['2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00']);
    expect(field.labels![0]!.replace(/\s/g, ' ')).toBe(
      'I read “10/09/26 8 AM to 8:40 AM PST” as Fri, Oct 9, 2026, 8:00 – 8:40 AM PDT in America/Los_Angeles — is that right?',
    );
    expect(seen).toEqual([]);
    const done = await agent.resume(second.checkpoint as never, {
      requestId: second.awaitingInput.requestId,
      values: { f1: field.enum![0]! },
    });
    expect(isInputPause(done)).toBe(false);
    expect(seen[0]).toMatchObject({ start_time: 1791558000000, end_time: 1791560460000 });
  });

  it('the ask crosses a JSON round trip of its checkpoint onto a fresh agent', async () => {
    const seen: Record<string, unknown>[] = [];
    // The fresh agent's model picks up where the first one paused: its next reply is the answer.
    const make = (script: readonly Reply[]) =>
      build(script, [epochTool(seen)], (b) =>
        b.time({ zone: LA, reader, policy: { dateOrder: 'MDY' } }),
      );
    const one = make([call('c1', 'client_activity', {}), answer('42 operations')]);
    const first = paused(await one.agent.run({ message: FIELD, time: { now: NOW } }));
    const checkpoint = JSON.parse(JSON.stringify(first.checkpoint));
    const two = make([answer('42 operations')]);
    const second = paused(
      await two.agent.resume(checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { f1: LA },
      }),
    );
    const again = JSON.parse(JSON.stringify(second.checkpoint));
    const three = make([answer('42 operations')]);
    const done = await three.agent.resume(again, {
      requestId: second.awaitingInput.requestId,
      values: { f1: second.awaitingInput.fields[0]!.enum![0]! },
    });
    expect(isInputPause(done)).toBe(false);
    expect(seen[0]).toMatchObject({ start_time: 1791558000000 });
  });

  it('only the readings the tool’s direction allows are offered; a free answer outside it is asked again', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'client_activity', {}), answer('42 operations')],
      [epochTool(seen, { direction: 'future' })],
      (b) => b.time({ zone: LA, reader }),
    );
    const first = paused(await agent.run({ message: FIELD, time: { now: NOW } }));
    const second = paused(
      await agent.resume(first.checkpoint as never, {
        requestId: first.awaitingInput.requestId,
        values: { f1: LA },
      }),
    );
    // 10 Sep 2026 and 26 Sep 2010 are over; 9 Oct 08:00–08:41 still runs past now (08:40).
    expect(second.awaitingInput.fields[0]!.enum).toEqual([
      '2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00',
    ]);
    expect(second.awaitingInput.fields[0]!.labels).toHaveLength(1);
    const third = paused(
      await agent.resume(second.checkpoint as never, {
        requestId: second.awaitingInput.requestId,
        values: { f1: '2026-10-01T08:00:00-07:00/2026-10-01T09:00:00-07:00' },
      }),
    );
    expect(third.awaitingInput.fields[0]).toMatchObject({ format: 'time-range' });
    expect(seen).toEqual([]);
    expect(ofKind(agent, 'argument')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ argument: 'start_time', asked: 'invalid-answer' }),
      ]),
    );
  });

  it('every reading outside the tool’s direction → nothing is asked, the call is refused', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = build(
      [call('c1', 'client_activity', {}), answer('none')],
      [epochTool(seen, { direction: 'future' })],
      (b) => b.time({ zone: LA, reader }),
    );
    const done = await agent.run({ message: 'client activity on 09/01/26', time: { now: NOW } });
    expect(isInputPause(done)).toBe(false);
    expect(seen).toEqual([]);
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({ how: 'refused', refused: 'time-past' });
    const tool = requests[1]!.messages.find((m) => m.role === 'tool')!;
    expect(tool.content as string).toContain('the window it asked for had already ended');
  });
});

// ─── what v1 does not read ────────────────────────────────────────────

describe('phrases v1 does not read — one unreadable row, no window ask', () => {
  for (const [message, quote] of [
    ['what failed yesterday morning?', 'yesterday morning'],
    ['client activity last week', 'last week'],
  ] as const) {
    it(`"${quote}" → unreadable, and the tool's own rule asks`, async () => {
      const { agent } = build(
        [call('c1', 'client_activity', {}), answer('ok')],
        [epochTool()],
        (b) => b.time({ zone: LA, reader }),
      );
      const first = paused(await agent.run({ message, time: { now: NOW } }));
      expect(ofKind(agent, 'time-reading')).toMatchObject([
        { quote, problem: 'unreadable', choice: { by: 'none', why: 'unreadable' } },
      ]);
      // The tool's own `ask` rule: one field per argument, no `format`.
      expect(first.awaitingInput.fields.map((f) => f.description)).toEqual([
        'From when?',
        'Until when?',
      ]);
      expect(first.awaitingInput.fields.every((f) => f.format === undefined)).toBe(true);
    });
  }
});

describe('every chat reading is a confirmation — never filed as said (the owner’s decision “Always confirm”)', () => {
  // A row from each of the seven review rounds, and the forms the earlier allow-list filed as
  // said: each pauses on a pre-filled, editable confirmation naming its window AND its zone.
  for (const [message, quote] of [
    ['Show client activity yesterday 8:40 PM to 9', 'yesterday 8:40 PM'],
    ['Show client activity yesterday 8:40 PM till 9.30', 'yesterday 8:40 PM'],
    ['Show client activity yesterday 8:40 PM until the deploy', 'yesterday 8:40 PM'],
    ['Start: yesterday 8:40 PM\nEnd: 9.30 — show client activity', 'yesterday 8:40 PM'],
    ['Show client activity 8 AM forward', '8 AM'],
    ['Show client activity yesterday London time', 'yesterday London time'],
    ['client activity for the last 2 hours of the outage', 'last 2 hours'],
    ['client activity last 2 hours ending at the outage', 'last 2 hours'],
    ['client activity newer than 2026-10-09T08:00Z', '2026-10-09T08:00Z'],
    ['any client activity in the last 2 hours?', 'last 2 hours'],
    ['client activity 2026-10-09T08:00-07:00', '2026-10-09T08:00-07:00'],
    ['client activity yesterday?', 'yesterday'],
  ] as const) {
    it(`${JSON.stringify(
      message,
    )} → a confirmation of “${quote}”, never said; the tool waits`, async () => {
      const seen: Record<string, unknown>[] = [];
      const { agent, requests } = build(
        [call('c1', 'client_activity', {}), answer('ok')],
        [epochTool(seen)],
        (b) => b.time({ zone: LA, reader }),
      );
      const first = paused(await agent.run({ message, time: { now: NOW } }));
      expect(seen).toEqual([]);
      const [row] = ofKind(agent, 'time-reading');
      expect(row).toMatchObject({ quote, choice: { by: 'open' } });
      expect((row!.choice as { open: string[] }).open).toContain('confirm');
      expect((row!.candidates as { said: unknown[] }[]).every((c) => c.said.length === 0)).toBe(
        true,
      );
      expect(ofKind(agent, 'call-window')[0]).toMatchObject({
        how: 'not-filled',
        why: 'open-reading',
      });
      // Nothing settled, so no window is served — only the library's conclusion that the words
      // are not confirmed yet, and the one move that lets the person confirm them, LATE: the last
      // line of the request, never the tool's description (step T6b's serving placement).
      const activity = (requests[0]!.tools ?? []).find((t) => t.name === 'client_activity')!;
      expect(activity.description).toBe('Client operations over a window.');
      expect(timeLineOf(requests[0])).toBe(
        pendingLine(quote, 'client_activity is called with start_time, end_time left out'),
      );
      // One field, pre-filled with the reading and its zone, free entry open.
      expect(first.awaitingInput.fields).toHaveLength(1);
      const field = first.awaitingInput.fields[0]!;
      expect(field.format).toBe('time-range');
      expect(field.description).toBe(`Is this the time you meant by “${quote}”?`);
      expect(field.enum!.length).toBeGreaterThan(0);
      expect(field.labels![0]!.replace(/\s/g, ' ')).toMatch(
        new RegExp(
          `^I read “${quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}” as .+ in ${
            // A zone the person named is the proposal's zone (packet "reader"); else the run's.
            quote.endsWith('London time') ? 'Europe/London' : 'America/Los_Angeles'
          } — is that right\\?$`,
        ),
      );
      expect(ofKind(agent, 'time-answer')).toEqual([]);
    });
  }

  it('a confirmed pre-fill is the person’s answer — their click recorded', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'client_activity', {}), answer('ok')],
      [epochTool(seen)],
      (b) => b.time({ zone: LA, reader }),
    );
    const first = paused(
      await agent.run({ message: 'any client activity in the last 2 hours?', time: { now: NOW } }),
    );
    const offered = first.awaitingInput.fields[0]!.enum![0]!;
    const done = await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: offered },
    });
    expect(isInputPause(done)).toBe(false);
    expect(seen[0]).toMatchObject({ start_time: NOW_MS - 2 * 3_600_000 });
    expect(ofKind(agent, 'time-answer')).toEqual([
      {
        kind: 'time-answer',
        turn: 1,
        iteration: 1,
        mention: 0,
        from: '2026-10-09T13:40:00Z',
        to: '2026-10-09T15:40:00.001Z',
        zone: LA,
        how: 'confirmed',
      },
    ]);
    expect(ofKind(agent, 'argument')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ argument: 'start_time', source: 'answered' }),
        expect.objectContaining({ argument: 'end_time', source: 'answered' }),
      ]),
    );
    // Never `said`: no argument row and no window of this turn claims the person's words.
    expect(ofKind(agent, 'argument').some((r) => r.source === 'said')).toBe(false);
  });

  it('an edited pre-fill is the person’s answer — the window they wrote, recorded as edited', async () => {
    const EDITED = '2026-10-08T20:40:00-07:00/2026-10-08T21:30:00-07:00';
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'client_activity', {}), answer('ok')],
      [epochTool(seen)],
      (b) => b.time({ zone: LA, reader }),
    );
    const first = paused(
      await agent.run({
        message: 'Show client activity yesterday 8:40 PM till 9.30',
        time: { now: NOW },
      }),
    );
    const done = await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: EDITED },
    });
    expect(isInputPause(done)).toBe(false);
    expect(seen[0]).toMatchObject({
      start_time: Date.parse('2026-10-08T20:40:00-07:00'),
      end_time: Date.parse('2026-10-08T21:30:00-07:00'),
    });
    expect(ofKind(agent, 'time-answer')).toMatchObject([
      {
        mention: 0,
        from: '2026-10-08T20:40:00-07:00',
        to: '2026-10-08T21:30:00-07:00',
        how: 'edited',
      },
    ]);
    expect(ofKind(agent, 'argument')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ argument: 'start_time', source: 'answered' }),
      ]),
    );
  });

  it('a tool whose rule ASSUMES its period is asked, not assumed: its default never stands in for the words', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'search_logs', {}), answer('none')],
      [lookbackTool(seen)],
      (b) => b.time({ zone: LA, reader }),
    );
    const first = paused(
      await agent.run({ message: 'any errors in the last 2 hours?', time: { now: NOW } }),
    );
    expect(seen).toEqual([]);
    const done = await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: first.awaitingInput.fields[0]!.enum![0]! },
    });
    expect(isInputPause(done)).toBe(false);
    // The confirmed look-back, in the tool's own form — not the rule's `1h`.
    expect(seen).toEqual([{ window: '2h' }]);
  });
});

describe('a future date to a `past` tool — refused before dispatch', () => {
  it('"10/20/26" under MDY is refused with the reason, and the tool never runs', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = build(
      [call('c1', 'client_activity', {}), answer('none')],
      [epochTool(seen, { direction: 'past' })],
      (b) => b.time({ zone: LA, reader, policy: { dateOrder: 'MDY' } }),
    );
    await agent.run({ message: 'client activity on 10/20/26', time: { now: NOW } });
    expect(seen).toEqual([]);
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({
      how: 'refused',
      refused: 'time-future',
    });
    const tool = requests[1]!.messages.find((m) => m.role === 'tool')!;
    expect(tool.content as string).toContain('the window it asked for had not happened yet');
  });
});

// ─── the served sentence (TQ13) ───────────────────────────────────────

describe('the one served time sentence — the confirmed window and its source', () => {
  for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`"last 2 hours": nothing served before the confirmation; after it, the next request names the window in each tool's own form, as the person's confirmation (${mode})`, async () => {
      const { agent, requests } = build(
        [call('c0', 'search_logs', {}), answer('none')],
        [lookbackTool(), epochTool()],
        (b) => b.time({ zone: LA, reader }),
        mode,
      );
      const first = paused(
        await agent.run({ message: 'any errors in the last 2 hours?', time: { now: NOW } }),
      );
      // Before the confirmation: a proposal is never served as a window — the late line says the
      // words are not confirmed yet and names each period tool's arguments to leave out. The tool
      // descriptions carry nothing.
      expect(requests[0]!.tools!.map((t) => t.description)).toEqual([
        'Error lines over a look-back window.',
        'Client operations over a window.',
      ]);
      expect(timeLineOf(requests[0])).toBe(
        pendingLine(
          'last 2 hours',
          'search_logs is called with window left out, or client_activity is called with ' +
            'start_time, end_time left out',
        ),
      );
      await agent.resume(first.checkpoint as never, {
        requestId: first.awaitingInput.requestId,
        values: { f1: first.awaitingInput.fields[0]!.enum![0]! },
      });
      // After it: the late line names the window in the person's zone, WHOSE it is, and each
      // tool's own values; the answer is told to state it. Nothing is pending any more.
      expect(requests[1]!.tools!.map((t) => t.description)).toEqual([
        'Error lines over a look-back window.',
        'Client operations over a window.',
      ]);
      expect(timeLineOf(requests[1])).toBe(
        "The person's time words, as the library holds them: “last 2 hours” is " +
          `${WINDOW_2H}, the window the person confirmed when asked what their words meant — ` +
          `search_logs window "2h"; client_activity start_time ${NOW_MS - 2 * 3_600_000}, ` +
          `end_time ${NOW_MS}. A call may pass these values as written; an answer built on them ` +
          'states that window.',
      );
      expect(ofKind(agent, 'time-reading')).toHaveLength(1);
    });
  }

  it('classic mode caches its tools after the first iteration: the confirmed window is not served there (the known limit) — a later call is still filled from it', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent, requests } = build(
      [call('c0', 'search_logs', {}), call('c1', 'search_logs', {}), answer('none')],
      [lookbackTool(seen), epochTool()],
      (b) => b.time({ zone: LA, reader }),
      'classic',
    );
    const first = paused(
      await agent.run({ message: 'any errors in the last 2 hours?', time: { now: NOW } }),
    );
    await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: first.awaitingInput.fields[0]!.enum![0]! },
    });
    expect(JSON.stringify(requests[1]!.tools)).toBe(JSON.stringify(requests[0]!.tools));
    // The slot did not re-run, so its iteration-1 line (pending) is stale and is NOT served.
    expect(timeLineOf(requests[0])).toContain('is not settled yet');
    expect(timeLineOf(requests[1])).toBeUndefined();
    expect(seen).toEqual([{ window: '2h' }, { window: '2h' }]);
    expect(ofKind(agent, 'call-window').filter((r) => r.toolCallId === 'c1')).toMatchObject([
      { how: 'filled', person: { source: 'answered', mention: 0 } },
    ]);
  });

  it('a call that ran on a window the model wrote while a reading waited: the next line names the limit, not the move', async () => {
    const { agent, requests } = build(
      [call('c0', 'search_logs', { window: '2h' }), answer('none')],
      [lookbackTool()],
      (b) => b.time({ zone: LA, reader }),
    );
    const out = await agent.run({ message: 'any errors in the last 2 hours?', time: { now: NOW } });
    expect(isInputPause(out)).toBe(false);
    expect(timeLineOf(requests[0])).toBe(
      pendingLine('last 2 hours', 'search_logs is called with window left out'),
    );
    expect(ofKind(agent, 'call-window')[0]).toMatchObject({ how: 'model' });
    expect(timeLineOf(requests[1])).toBe(
      'The window for “last 2 hours” is not settled: the person has not confirmed it, and the ' +
        'call that ran used a window written into it, unconfirmed. An answer built on that call ' +
        'says its window was not confirmed by the person.',
    );
  });

  it('an edited window is served as the window the person gave', async () => {
    const { agent, requests } = build(
      [call('c0', 'client_activity', {}), answer('none')],
      [epochTool()],
      (b) => b.time({ zone: LA, reader }),
    );
    const first = paused(await agent.run({ message: 'any errors yesterday?', time: { now: NOW } }));
    await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: '2026-10-08T20:00:00-07:00/2026-10-08T21:00:00-07:00' },
    });
    expect(timeLineOf(requests[1])).toContain(
      ', the window the person gave when asked what their words meant — client_activity ' +
        `start_time ${Date.parse('2026-10-08T20:00:00-07:00')}, end_time ` +
        `${Date.parse('2026-10-08T21:00:00-07:00')}.`,
    );
  });

  it('byte identity — no reader: the tool list equals the unarmed twin’s; a turn with nothing settled too', async () => {
    const plain = build([answer('none')], [lookbackTool(), epochTool()], (b) =>
      b.time({ zone: LA }),
    );
    await plain.agent.run({ message: 'any errors yesterday?', time: { now: NOW } });
    const armed = build([answer('none')], [lookbackTool(), epochTool()], (b) =>
      b.time({ zone: LA, reader }),
    );
    await armed.agent.run({ message: 'any errors at all?', time: { now: NOW } });
    expect(JSON.stringify(armed.requests[0]!.tools)).toBe(JSON.stringify(plain.requests[0]!.tools));
    // …and no late line: a message with no time words serves nothing new.
    expect(armed.requests[0]!.messages).toHaveLength(plain.requests[0]!.messages.length);
    expect(timeLineOf(armed.requests[0])).toBeUndefined();
    expect(plain.requests[0]!.tools!.every((t) => !t.description.includes('library read'))).toBe(
      true,
    );
  });
});

// ─── reader edges (time follow-ups, packet "reader") ────────────────────

describe('reader edges — the end edge, a named zone, the app’s abbreviation map, through real agents', () => {
  it('“yesterday 8 AM to 9 AM” is offered as one hour and the tool receives 08:00–09:00', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'client_activity', {}), answer('ok')],
      [epochTool(seen)],
      (b) => b.time({ zone: LA, reader }),
    );
    const first = paused(
      await agent.run({ message: 'Any errors yesterday 8 AM to 9 AM?', time: { now: NOW } }),
    );
    const field = first.awaitingInput.fields[0]!;
    expect(field.enum).toEqual(['2026-10-08T08:00:00-07:00/2026-10-08T09:00:00-07:00']);
    expect(field.labels![0]!.replace(/\s/g, ' ')).toContain('8:00 – 9:00 AM PDT');
    const done = await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: field.enum![0]! },
    });
    expect(isInputPause(done)).toBe(false);
    expect(seen[0]).toMatchObject({
      start_time: Date.parse('2026-10-08T15:00:00Z'),
      end_time: Date.parse('2026-10-08T16:00:00Z'),
    });
  });

  it('“yesterday London time” is proposed as the London day; an edit is recorded in London', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'client_activity', {}), answer('ok')],
      [epochTool(seen)],
      (b) => b.time({ zone: LA, reader }),
    );
    const first = paused(
      await agent.run({
        message: 'Show client activity yesterday London time',
        time: { now: NOW },
      }),
    );
    const field = first.awaitingInput.fields[0]!;
    expect(field.enum).toEqual(['2026-10-08T00:00:00+01:00/2026-10-09T00:00:00+01:00']);
    expect(field.labels![0]).toContain('in Europe/London — is that right?');
    const [row] = ofKind(agent, 'time-reading');
    expect(row).toMatchObject({ quote: 'yesterday London time' });
    expect((row!.candidates as { implied: string[] }[])[0]!.implied).not.toContain('zone');
    const EDITED = '2026-10-08T06:00:00+01:00/2026-10-08T18:00:00+01:00';
    const done = await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: EDITED },
    });
    expect(isInputPause(done)).toBe(false);
    expect(ofKind(agent, 'time-answer')).toMatchObject([
      { from: '2026-10-08T06:00:00+01:00', zone: 'Europe/London', how: 'edited' },
    ]);
  });

  it('an edit typed in an offset no offered zone shows is recorded in that offset’s zone, not the app’s', async () => {
    const { agent } = build([call('c1', 'client_activity', {}), answer('ok')], [epochTool()], (b) =>
      b.time({ zone: LA, reader }),
    );
    const first = paused(
      await agent.run({ message: 'Show client activity yesterday', time: { now: NOW } }),
    );
    await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: '2026-10-08T00:00:00Z/2026-10-09T00:00:00Z' },
    });
    expect(ofKind(agent, 'time-answer')).toMatchObject([{ zone: 'UTC', how: 'edited' }]);
  });

  it('the field sentence under the app’s PST map and MDY: ONE confirmation, zone reading first', async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'client_activity', {}), answer('42 operations')],
      [epochTool(seen)],
      (b) =>
        b.time({
          zone: LA,
          reader,
          policy: {
            dateOrder: 'MDY',
            abbreviations: { PST: { zone: LA, offset: '-08:00' } },
          },
        }),
    );
    const first = paused(await agent.run({ message: FIELD, time: { now: NOW } }));
    expect(first.awaitingInput.fields).toHaveLength(1);
    const field = first.awaitingInput.fields[0]!;
    expect(field.format).toBe('time-range');
    expect(field.enum).toEqual([
      '2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00',
      '2026-10-09T08:00:00-08:00/2026-10-09T08:41:00-08:00',
    ]);
    expect(field.labels![0]).toContain('in America/Los_Angeles');
    expect(field.labels![1]).toContain('in Etc/GMT+8');
    const done = await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: field.enum![0]! },
    });
    expect(isInputPause(done)).toBe(false);
    expect(seen[0]).toMatchObject({ start_time: 1791558000000, end_time: 1791560460000 });
    expect(ofKind(agent, 'time-answer')).toMatchObject([{ zone: LA, how: 'confirmed' }]);
  });
});
