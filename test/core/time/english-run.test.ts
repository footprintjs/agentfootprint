/**
 * The English reader through real agents (time design § 5.3, TQ13, step T6b):
 * `.time({ reader: englishTimeReader() })`, the one served time sentence on a
 * tool that declares a period, and the lazy word-driven ask. A scripted
 * provider and the wall clock pinned with fake `Date` — no model is called.
 *
 * Law: the library reads the person's words only through the armed reader; a
 * window it read is served to the model in each tool's own form, as a reading;
 * a window it could not settle is asked of the person only when a tool that
 * declares a period is about to be called — the zone first when they wrote an
 * abbreviation, then the readings as labelled choices.
 *
 * Test types:
 *   functional  — the field sentence "10/09/26 8 AM to 8:40 AM PST": a zone ask naming `PST`,
 *                 then the three date orders as labelled choices, then the tool runs with the
 *                 chosen window in its own form (`answered` rows, the note says whose window);
 *                 under `dateOrder: 'MDY'` the zone answer settles it (one ask); "yesterday" →
 *                 the sentence names the window in the tool's form (a look-back, said wider);
 *                 "yesterday morning" and "last week" → one `unreadable` row each, no window ask
 *                 (the tool's own rule asks); a future date to a `past` tool is refused before
 *                 dispatch;
 *   integration — the ask's checkpoint crosses a JSON round trip onto a FRESH agent and binds;
 *                 every react mode (classic, dynamic, grouped) serves the same sentence;
 *   security    — an answered window outside the tool's `direction` is asked again, never run;
 *                 the sentence names a reading as a reading ("not their words");
 *   byte identity — without a reader nothing is served or asked: the request's tool list equals
 *                 the reader-less twin's; a turn whose reader settled nothing serves the bytes it
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
      reader: { id: 'agentfootprint/english', version: '1.0.0', kind: 'rule', locale: 'en-US' },
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
    expect(field.description).toBe('Which time did you mean by “10/09/26 8 AM to 8:40 AM PST”?');
    expect(field.enum).toEqual([
      '2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00',
      '2026-09-10T08:00:00-07:00/2026-09-10T08:41:00-07:00',
      '2010-09-26T08:00:00-07:00/2010-09-26T08:41:00-07:00',
    ]);
    expect(field.labels).toHaveLength(3);
    expect(field.labels![0]).toContain('PDT');
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

  it("under `dateOrder: 'MDY'` the zone answer settles the window — one ask", async () => {
    const seen: Record<string, unknown>[] = [];
    const { agent } = build(
      [call('c1', 'client_activity', {}), answer('42 operations')],
      [epochTool(seen)],
      (b) => b.time({ zone: LA, reader, policy: { dateOrder: 'MDY' } }),
    );
    const first = paused(await agent.run({ message: FIELD, time: { now: NOW } }));
    const done = await agent.resume(first.checkpoint as never, {
      requestId: first.awaitingInput.requestId,
      values: { f1: LA },
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
    const done = await two.agent.resume(checkpoint, {
      requestId: first.awaitingInput.requestId,
      values: { f1: LA },
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

describe('a range the reader reads only half of — never a silent narrower window', () => {
  for (const [message, quote] of [
    ['Show client activity yesterday 8:40 PM to 9', 'yesterday 8:40 PM to 9'],
    ['Show client activity yesterday 14:00 to 16', 'yesterday 14:00 to 16'],
  ] as const) {
    it(`"${quote}" → one unreadable row; the tool never runs on a one-minute window`, async () => {
      const seen: Record<string, unknown>[] = [];
      const { agent, requests } = build(
        [call('c1', 'client_activity', {}), answer('ok')],
        [epochTool(seen)],
        (b) => b.time({ zone: LA, reader }),
      );
      const first = paused(await agent.run({ message, time: { now: NOW } }));
      expect(seen).toEqual([]);
      expect(ofKind(agent, 'time-reading')).toMatchObject([
        { quote, problem: 'unreadable', choice: { by: 'none', why: 'unreadable' } },
      ]);
      expect(first.awaitingInput.fields.map((f) => f.description)).toEqual([
        'From when?',
        'Until when?',
      ]);
      // Nothing settled, so nothing is served as a reading.
      const activity = (requests[0]!.tools ?? []).find((t) => t.name === 'client_activity')!;
      expect(activity.description).toBe('Client operations over a window.');
    });
  }
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

describe('the one served time sentence — on each tool that declares a period', () => {
  for (const mode of ['dynamic', 'dynamic-grouped', 'classic'] as const) {
    it(`"yesterday" is served in each tool's own form (${mode})`, async () => {
      const { agent, requests } = build(
        [answer('none')],
        [lookbackTool(), epochTool()],
        (b) => b.time({ zone: LA, reader }),
        mode,
      );
      await agent.run({ message: 'any errors yesterday?', time: { now: NOW } });
      const tools = requests[0]!.tools ?? [];
      const search = tools.find((t) => t.name === 'search_logs')!;
      const activity = tools.find((t) => t.name === 'client_activity')!;
      expect(search.description).toBe(
        "Error lines over a look-back window. The library read time words in the person's " +
          'message as: “yesterday” → window "1960m" (a wider read than the words named) — a ' +
          'reading of their words, not their words; a call may pass these values as written.',
      );
      expect(activity.description).toBe(
        "Client operations over a window. The library read time words in the person's message " +
          'as: “yesterday” → start_time 1791442800000, end_time 1791529200000 — a reading of ' +
          'their words, not their words; a call may pass these values as written.',
      );
      expect(ofKind(agent, 'time-reading')).toHaveLength(1);
    });
  }

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
    expect(plain.requests[0]!.tools!.every((t) => !t.description.includes('library read'))).toBe(
      true,
    );
  });
});
