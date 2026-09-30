/**
 * The reader port end to end — `.time({ reader, policy })`, the seed's one
 * reading per turn, the `time-reading` rows, the `saidByPerson` gate and the
 * `model`-reading rule (the time design § 5.1–§ 5.5, step T6a), through real
 * agents on a scripted provider and a FIXTURE reader that returns fixed parts.
 * No English is read and no model is called.
 *
 * Law: the library reads the person's words only through an armed reader,
 * only on a message a person wrote, once per message — a resume and a retry
 * read the recorded reading, never the reader again.
 *
 * Test types:
 *   functional  — one row per mention with every candidate and the choice (`10/09/26` → three
 *                 orders asked; `dateOrder: 'MDY'` → assumed, recorded); one `mentions: 0` row
 *                 for a message with none; an async `model` reader → `said: []`, `confirm`; an
 *                 out-of-text quote refused (no text kept); a reader that breaks its port fails
 *                 the run naming it; the builder refuses a malformed reader and a policy
 *                 without one;
 *   integration — a pause and its resume never call the reader again; a `resumeOnError` retry of
 *                 the same turn reads its rows back; a continued conversation reads only the new
 *                 message; the rows cross the checkpoint door; both chart shapes;
 *   security    — a library-written `role: 'user'` turn is never read; a composed run's message
 *                 (another runner's output) is never read; the model is served nothing new (the
 *                 request bytes equal the reader-less twin's);
 *   byte identity — `.time()` without a reader files no reading row and calls nothing (the T3
 *                 reference `agent-time-clock` and every unarmed reference stay green);
 *   load        — a reading of 16 mentions files 16 rows, in order, inside a budget.
 * Unit, property, performance: resolve.test.ts.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  Sequence,
  defineTool,
  isPaused,
  pauseHere,
  type ClockRow,
  type TimeParts,
  type TimeReader,
  type TimeReading,
  type TimeReadingRow,
  type Tool,
} from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { validateCheckpoint } from '../../../src/core/runCheckpoint.js';
import { EVIDENCE_CHECK_FRAME_PREFIX } from '../../../src/lib/saidByPerson.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'time-reader-mock',
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
const MESSAGE = 'Show client activity 10/09/26 8 AM to 8:40 AM';

/** The parts a tokenizer would return for MESSAGE — fixed, so no English is read here. */
const RANGE_PARTS: TimeParts = {
  date: { kind: 'numeric', fields: [10, 9, 26] },
  rangeOf: [{ wall: { h: 8, meridiem: 'am' } }, { wall: { h: 8, m: 40, meridiem: 'am' } }],
};

/** A fixture reader: returns `answer(text)` and counts every call. */
function fixtureReader(
  answerFor: (text: string) => TimeReading | Promise<TimeReading>,
  kind: 'rule' | 'model' = 'rule',
) {
  const calls: { text: string; locale: string }[] = [];
  const reader: TimeReader = {
    id: kind === 'rule' ? 'fixture/rule' : 'fixture/model',
    version: '1.0.0',
    locale: 'en-US',
    kind,
    read(text, context) {
      calls.push({ text, locale: context.locale });
      return answerFor(text);
    },
  };
  return { reader, calls };
}

const rangeReader = () =>
  fixtureReader((text) =>
    text.includes('10/09/26')
      ? { mentions: [{ quote: '10/09/26 8 AM to 8:40 AM', parses: [RANGE_PARTS] }] }
      : { mentions: [] },
  );

type Mode = 'dynamic' | 'dynamic-grouped';

function agentWith(
  script: readonly Reply[],
  arm: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  reactMode: Mode = 'dynamic',
) {
  const s = scripted(script);
  const agent = arm(
    Agent.create({ provider: s.provider as never, model: 'mock', maxIterations: 8, reactMode }),
  ).build();
  return { agent, requests: s.requests };
}

const rows = (agent: { findings(): unknown }): readonly { kind: string }[] =>
  (agent.findings() as readonly { kind: string }[] | undefined) ?? [];
const readings = (agent: { findings(): unknown }): TimeReadingRow[] =>
  rows(agent).filter((r) => r.kind === 'time-reading') as TimeReadingRow[];

/** A tool that stops for a person. */
const confirm = (): Tool =>
  defineTool({
    name: 'confirm',
    description: 'Ask the person to confirm.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => pauseHere({ question: 'Go ahead?' }),
  });

// ─── the reading ─────────────────────────────────────────────────────

describe('one reading per turn, one row per mention', () => {
  for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`10/09/26 8 AM to 8:40 AM → every order, asked (${mode})`, async () => {
      const { reader, calls } = rangeReader();
      const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA, reader }), mode);
      await agent.run({ message: MESSAGE, time: { now: NOW } });
      expect(calls).toEqual([{ text: MESSAGE, locale: 'en-US' }]);
      const kinds = rows(agent).map((r) => r.kind);
      // The reading resolves against the clock, so it is filed after it.
      expect(kinds.indexOf('clock')).toBeLessThan(kinds.indexOf('time-reading'));
      const [row] = readings(agent);
      expect(row).toMatchObject({
        kind: 'time-reading',
        turn: 1,
        iteration: 1,
        reader: { id: 'fixture/rule', version: '1.0.0', kind: 'rule', locale: 'en-US' },
        mentions: 1,
        mention: 0,
        quote: '10/09/26 8 AM to 8:40 AM',
        parses: [RANGE_PARTS],
        choice: { by: 'open', remaining: [0, 1, 2], open: ['date-order'] },
      });
      expect(typeof row?.tzdata).toBe('string');
      expect(row?.candidates?.[0]?.range).toEqual({
        from: '2026-10-09T08:00:00-07:00',
        to: '2026-10-09T08:41:00-07:00',
      });
    });
  }

  it('a declared date order is assumed and recorded', async () => {
    const { reader } = rangeReader();
    const { agent } = agentWith([answer('hi')], (b) =>
      b.time({ zone: LA, reader, policy: { dateOrder: 'MDY' } }),
    );
    await agent.run({ message: MESSAGE, time: { now: NOW } });
    expect(readings(agent)[0]?.choice).toEqual({
      by: 'policy',
      candidate: 0,
      policy: { dateOrder: 'MDY' },
    });
  });

  it('the run’s zone is the one the words resolve in', async () => {
    const { reader } = rangeReader();
    const { agent } = agentWith([answer('hi')], (b) =>
      b.time({ zone: LA, reader, policy: { dateOrder: 'MDY' } }),
    );
    await agent.run({ message: MESSAGE, time: { now: NOW, zone: 'Asia/Kolkata' } });
    expect(readings(agent)[0]?.candidates?.[0]?.range).toEqual({
      from: '2026-10-09T08:00:00+05:30',
      to: '2026-10-09T08:41:00+05:30',
    });
  });

  it('a message with no time → ONE row saying it was read and held none', async () => {
    const { reader, calls } = rangeReader();
    const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA, reader }));
    await agent.run({ message: 'how are the backups?', time: { now: NOW } });
    expect(calls).toHaveLength(1);
    expect(readings(agent)).toEqual([
      expect.objectContaining({ kind: 'time-reading', turn: 1, mentions: 0 }),
    ]);
    expect(readings(agent)[0]).not.toHaveProperty('quote');
  });

  it('an async model reader: never said, always confirmed', async () => {
    const { reader } = fixtureReader(
      async () => ({
        mentions: [{ quote: '8:40 PM', parses: [{ wall: { h: 8, m: 40, meridiem: 'pm' } }] }],
      }),
      'model',
    );
    const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA, reader }));
    await agent.run({ message: 'errors at 8:40 PM', time: { now: NOW } });
    const [row] = readings(agent);
    expect(row?.reader.kind).toBe('model');
    expect(row?.candidates?.[0]?.said).toEqual([]);
    expect(row?.choice).toEqual({ by: 'open', remaining: [0], open: ['confirm'] });
  });

  it('an out-of-text quote is refused, and the row keeps none of it', async () => {
    const { reader } = fixtureReader(() => ({
      mentions: [{ quote: 'last Tuesday at noon', parses: [{ wall: { h: 12, meridiem: 'pm' } }] }],
    }));
    const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA, reader }));
    await agent.run({ message: 'errors at noon', time: { now: NOW } });
    expect(readings(agent)).toEqual([
      {
        kind: 'time-reading',
        turn: 1,
        iteration: 1,
        reader: expect.any(Object),
        tzdata: expect.any(String),
        mentions: 1,
        mention: 0,
        refused: 'quote-not-in-text',
      },
    ]);
    expect(JSON.stringify(agent.findings())).not.toContain('Tuesday');
  });

  it('a reader that breaks its port fails the run, naming it', async () => {
    const { reader } = fixtureReader(() => ({ found: [] } as never));
    const { agent, requests } = agentWith([answer('hi')], (b) => b.time({ zone: LA, reader }));
    await expect(agent.run({ message: 'x', time: { now: NOW } })).rejects.toThrow(
      /TimeReader 'fixture\/rule'/,
    );
    expect(requests).toHaveLength(0);
  });

  it('the builder refuses a malformed reader and a policy without one', () => {
    const b = () => Agent.create({ provider: {} as never, model: 'm' });
    expect(() => b().time({ reader: { id: 'x' } as never })).toThrow(
      /AgentBuilder\.time: reader\.version/,
    );
    expect(() => b().time({ zone: LA, policy: { dateOrder: 'DMY' } })).toThrow(/arm a reader/);
    const { reader } = rangeReader();
    expect(() => b().time({ reader, policy: { year: 'last' as never } })).toThrow(/policy\.year/);
  });
});

// ─── never twice for one message ─────────────────────────────────────

describe('a replay never calls the reader', () => {
  it('a pause and its resume read the recorded reading', async () => {
    const { reader, calls } = rangeReader();
    const { agent } = agentWith([call('c1', 'confirm'), answer('done')], (b) =>
      b.tool(confirm()).time({ zone: LA, reader }),
    );
    const paused = await agent.run({ message: MESSAGE, time: { now: NOW } });
    if (!isPaused(paused)) throw new Error('expected a pause');
    const before = readings(agent);
    const cp = JSON.parse(JSON.stringify(paused.checkpoint));
    await agent.resume(cp, { approved: true });
    expect(calls).toHaveLength(1);
    expect(readings(agent)).toEqual(before);
  });

  it('a retry of the same turn (resumeOnError) reads its rows back', async () => {
    const first = rangeReader();
    const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA, reader: first.reader }));
    await agent.run({ message: MESSAGE, time: { now: NOW } });
    const stored = agent.checkpoint()!;
    // The same turn again: the history ends on the person's message.
    const retry = rangeReader();
    const { agent: second } = agentWith([answer('again')], (b) =>
      b.time({ zone: LA, reader: retry.reader }),
    );
    await second.resumeOnError(
      { ...stored, history: stored.history.slice(0, 1) },
      { time: { now: NOW } },
    );
    expect(retry.calls).toHaveLength(0);
    const again = readings(second);
    expect(again).toHaveLength(1);
    expect(again[0]).toEqual(readings(agent)[0]);
  });

  it('a continued conversation reads only the new message; the rows cross the door', async () => {
    const { reader, calls } = rangeReader();
    const { agent } = agentWith([answer('one'), answer('two')], (b) =>
      b.time({ zone: LA, reader }),
    );
    await agent.run({ message: MESSAGE, time: { now: NOW } });
    const cp = agent.checkpoint();
    expect(() => validateCheckpoint(JSON.parse(JSON.stringify(cp)))).not.toThrow();
    await agent.followUp('and yesterday?', { time: { now: NOW } });
    expect(calls.map((c) => c.text)).toEqual([MESSAGE, 'and yesterday?']);
    expect(readings(agent).map((r) => [r.turn, r.mentions])).toEqual([
      [1, 1],
      [2, 0],
    ]);
    const clocks = rows(agent).filter((r) => r.kind === 'clock') as ClockRow[];
    expect(clocks.map((c) => c.turn)).toEqual([1, 2]);
  });
});

// ─── only a person's words ───────────────────────────────────────────

describe('the saidByPerson gate', () => {
  it('a library-written role:user turn is never read', async () => {
    const { reader, calls } = rangeReader();
    const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA, reader }));
    await agent.run({
      message: `${EVIDENCE_CHECK_FRAME_PREFIX}] the value 10/09/26 8 AM to 8:40 AM was not found`,
      time: { now: NOW },
    });
    expect(calls).toHaveLength(0);
    expect(readings(agent)).toEqual([]);
    // The clock is still stamped: only the words are left unread.
    expect(rows(agent).map((r) => r.kind)).toEqual(['clock']);
  });

  it('a composed run’s message — another runner’s output — is never read', async () => {
    const writer = agentWith([answer('Report for 10/09/26 8 AM to 8:40 AM')], (b) => b);
    const { reader, calls } = rangeReader();
    const readerAgent = agentWith([answer('ok')], (b) => b.time({ zone: LA, reader }));
    const seq = Sequence.create()
      .step('writer', writer.agent)
      .step('reader', readerAgent.agent)
      .build();
    await seq.run({ message: 'write the report' });
    expect(calls).toHaveLength(0);
  });

  it('a direct composed run() — the app says another runner wrote it — is never read', async () => {
    // Not through a Sequence: a composition mounts the chart and hands the
    // marker to seed directly, so it never passes `Agent.run`'s forwarding.
    // This pins that door — an agent with a reader and no declared sources
    // must still forward `messageFrom: 'composed'` to seed.
    const { reader, calls } = rangeReader();
    const { agent } = agentWith([answer('ok')], (b) => b.time({ zone: LA, reader }));
    await agent.run({ message: MESSAGE, messageFrom: 'composed', time: { now: NOW } });
    expect(calls).toHaveLength(0);
    expect(readings(agent)).toEqual([]);
    expect(rows(agent).map((r) => r.kind)).toEqual(['clock']);
  });

  it('the first step of a composition is the person’s own message, and is read', async () => {
    const { reader, calls } = rangeReader();
    const readerAgent = agentWith([answer('ok')], (b) => b.time({ zone: LA, reader }));
    const seq = Sequence.create().step('reader', readerAgent.agent).build();
    await seq.run({ message: MESSAGE });
    expect(calls.map((c) => c.text)).toEqual([MESSAGE]);
  });
});

// ─── byte identity and what is served ────────────────────────────────

describe('off means unchanged; nothing is served', () => {
  it('.time() without a reader files no reading row', async () => {
    const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA }));
    await agent.run({ message: MESSAGE, time: { now: NOW } });
    expect(readings(agent)).toEqual([]);
  });

  it('the model is served exactly what the reader-less twin is served', async () => {
    const { reader } = rangeReader();
    const armed = agentWith([answer('hi')], (b) => b.time({ zone: LA, reader }));
    const plain = agentWith([answer('hi')], (b) => b.time({ zone: LA }));
    await armed.agent.run({ message: MESSAGE, time: { now: NOW } });
    await plain.agent.run({ message: MESSAGE, time: { now: NOW } });
    expect(JSON.stringify(armed.requests)).toBe(JSON.stringify(plain.requests));
  });
});

// ─── load ────────────────────────────────────────────────────────────

describe('load', () => {
  it('16 mentions → 16 rows, in order, inside a budget', async () => {
    const words = Array.from(
      { length: 16 },
      (_, i) => `${(i % 12) + 1}:${String(i).padStart(2, '0')}`,
    );
    const message = `times ${words.join(' and ')}`;
    const { reader } = fixtureReader(() => ({
      mentions: words.map((w) => {
        const [h, m] = w.split(':').map(Number) as [number, number];
        return { quote: w, parses: [{ wall: { h, m } }] };
      }),
    }));
    const { agent } = agentWith([answer('hi')], (b) => b.time({ zone: LA, reader }));
    const start = performance.now();
    await agent.run({ message, time: { now: NOW } });
    expect(performance.now() - start).toBeLessThan(5000);
    const filed = readings(agent);
    expect(filed.map((r) => r.mention)).toEqual(words.map((_, i) => i));
    expect(filed.map((r) => r.quote)).toEqual(words);
    for (const r of filed) expect(r.choice?.by).toBe('open');
  });
});
