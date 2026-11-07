/**
 * `agentfootprint/time` · `timeReplyPairs` — the reader a host's front end asks
 * which optional field is a time range's correction sibling.
 *
 *   functional  — a real ask, carried as JSON, gives its pair, and a one-click
 *                 confirm that treats the sibling as not asked is the whole answer;
 *   integration — the wire's reader and the resume door agree: the sibling is
 *                 optional, an answer with neither value is held and runs nothing,
 *                 and the third refuses the call;
 *   security    — no change to a real ask's JSON makes the reader fail any way but
 *                 the one named TypeError: 400 seeded changes, every path of the ask;
 *   byte identity — an ask with no time pair gives none (a plain `requestInput`).
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  defineTool,
  englishTimeReader,
  isInputPause,
  requestInput,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { timeReplyPairs, type TimeReplyPair, type TimeReplyRequest } from '../../src/doors/time.js';

const NOW = '2026-10-09T15:40:00Z';
const PAIR: TimeReplyPair = { range: 'f1', correction: 'f1-correction' };
const MALFORMED = 'Malformed time reply field binding.';

function desk(handed: unknown[], alsoAsks = false) {
  let calls = 0;
  const tool = defineTool({
    name: 'client_activity',
    description: 'Client operations over a window.',
    inputSchema: {
      type: 'object',
      properties: {
        start_time: { type: 'integer' },
        end_time: { type: 'integer' },
        ...(alsoAsks && { region: { type: 'string' } }),
      },
    },
    askOrAssume: {
      start_time: { ask: 'From when?' },
      end_time: { ask: 'Until when?' },
      ...(alsoAsks && { region: { ask: 'Which region?' } }),
    },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'start_time', as: 'epoch-ms' },
          to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
        },
      ],
    },
    execute: (args) => {
      handed.push(args);
      return '{"ops":42}';
    },
  });
  return Agent.create({
    provider: mock({
      respond: () =>
        calls++ === 0
          ? { content: '', toolCalls: [{ id: 'c1', name: 'client_activity', args: {} }] }
          : { content: 'done' },
    }),
    model: 'mock',
  })
    .tool(tool)
    .time({ zone: 'America/Los_Angeles', reader: englishTimeReader() })
    .build();
}

async function pausedAsk(handed: unknown[] = [], alsoAsks = false) {
  const agent = desk(handed, alsoAsks);
  const paused = await agent.run({ message: 'any activity yesterday?', time: { now: NOW } });
  if (!isInputPause(paused)) throw new Error('expected the time confirmation');
  // In process the ask is a TimeReplyRequest as it stands: this line is the compile-time pin.
  const inProcess: TimeReplyRequest = paused.awaitingInput;
  return { agent, paused, inProcess, wire: JSON.parse(JSON.stringify(paused.awaitingInput)) };
}

/** Every path of a JSON value, each as the keys that reach it. */
function pathsOf(value: unknown, at: readonly string[] = []): (readonly string[])[] {
  if (typeof value !== 'object' || value === null) return [at];
  return [at, ...Object.entries(value).flatMap(([key, item]) => pathsOf(item, [...at, key]))];
}

/** A copy of `value` with the thing at `path` replaced, or deleted when `next` is `DROP`. */
const DROP = Symbol('drop');
function changed(value: unknown, path: readonly string[], next: unknown): unknown {
  if (path.length === 0) return next === DROP ? undefined : next;
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  let holder: Record<string, unknown> = copy;
  for (const key of path.slice(0, -1)) holder = holder[key] as Record<string, unknown>;
  if (next === DROP) delete holder[path.at(-1)!];
  else holder[path.at(-1)!] = next;
  return copy;
}

describe('a real ask, carried as JSON', () => {
  it('gives its pair in process and off the wire', async () => {
    const { agent, inProcess, wire } = await pausedAsk();
    expect(timeReplyPairs(inProcess)).toEqual([PAIR]);
    expect(timeReplyPairs(wire)).toEqual([PAIR]);
    await agent.shutdown();
  });

  it('a one-click confirm that treats the sibling as not asked sends the whole answer', async () => {
    const handed: unknown[] = [];
    const { agent, paused, wire } = await pausedAsk(handed);
    const ask = wire as typeof paused.awaitingInput;
    const siblings = new Set(timeReplyPairs(ask).map((pair) => pair.correction));
    const asked = ask.fields.filter((field) => !siblings.has(field.id));
    expect(ask.fields.map((field) => field.id)).toEqual(['f1', 'f1-correction']);
    expect(ask.missing).toEqual([]);
    expect(asked.map((field) => field.id)).toEqual(['f1']);
    const done = await agent.resume(paused.checkpoint, {
      requestId: ask.requestId,
      values: { f1: asked[0]!.enum![0]! },
    });
    expect(isInputPause(done)).toBe(false);
    expect(handed).toHaveLength(1);
    await agent.shutdown();
  });

  it('a field still asked beside the pair keeps it from being one click: only the sibling is excused', async () => {
    const { agent, wire } = await pausedAsk([], true);
    const ask = wire as TimeReplyRequest;
    expect(timeReplyPairs(ask)).toEqual([PAIR]);
    const siblings = new Set(timeReplyPairs(ask).map((pair) => pair.correction));
    expect(ask.fields.filter((field) => !siblings.has(field.id))).toHaveLength(2);
    await agent.shutdown();
  });

  it('an answer with neither value is held, runs nothing, and the third refuses the call', async () => {
    const handed: unknown[] = [];
    const { agent, paused } = await pausedAsk(handed);
    let at: unknown = paused;
    for (let held = 0; held < 2; held++) {
      if (!isInputPause(at)) throw new Error('expected the ask back');
      at = await agent.resume(at.checkpoint, { requestId: at.awaitingInput.requestId, values: {} });
      if (!isInputPause(at)) throw new Error('expected a hold');
      expect(timeReplyPairs(at.awaitingInput)).toEqual([PAIR]);
      expect(at.awaitingInput.fields[0]?.description).toBe(
        'Choose a range or say what to change, such as a time zone or yesterday.',
      );
    }
    if (!isInputPause(at)) throw new Error('expected the ask back');
    const refused = await agent.resume(at.checkpoint, {
      requestId: at.awaitingInput.requestId,
      values: {},
    });
    expect(isInputPause(refused)).toBe(false);
    expect(handed).toEqual([]);
    await agent.shutdown();
  });
});

describe('SECURITY: the reader on a changed ask', () => {
  it('any change gives a pair, no pair, or the one named TypeError', async () => {
    const { agent, wire } = await pausedAsk();
    const paths = pathsOf(wire);
    // Seeded, so a failure names a change that reproduces.
    let seed = 20261107;
    const next = (bound: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed % bound;
    };
    const values = [DROP, null, 0, 1, 2, '', 'x', 'f1', true, false, [], {}, [null], { id: 'f1' }];
    let threw = 0;
    let read = 0;
    for (let round = 0; round < 400; round++) {
      const path = paths[next(paths.length)]!;
      const value = values[next(values.length)];
      const request = changed(wire, path, value) as TimeReplyRequest;
      try {
        expect(Array.isArray(timeReplyPairs(request)), path.join('.')).toBe(true);
        read++;
      } catch (error) {
        expect(error, path.join('.')).toBeInstanceOf(TypeError);
        expect((error as Error).message, path.join('.')).toBe(MALFORMED);
        threw++;
      }
    }
    // The run is real only if the changes reached both outcomes.
    expect(threw).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(0);
    await agent.shutdown();
  });

  it.each([
    ['the range no longer optional', ['fields', '0', 'required'], true],
    ['the range format dropped', ['fields', '0', 'format'], DROP],
    ['the text field dropped', ['fields', '1'], null],
    [
      'a binding of a later version',
      ['context', 'agentfootprint', 'fields', '0', 'timeReply', 'version'],
      2,
    ],
  ] as const)('a stamped binding that does not match throws: %s', async (_, path, value) => {
    const { agent, wire } = await pausedAsk();
    expect(() => timeReplyPairs(changed(wire, path, value) as TimeReplyRequest)).toThrow(
      new TypeError(MALFORMED),
    );
    await agent.shutdown();
  });
});

describe('an ask with no time pair', () => {
  it('a plain typed ask gives none, in process and off the wire', async () => {
    const tool = defineTool({
      name: 'ask_year',
      description: 'Asks which year.',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        requestInput({
          id: 'year',
          question: 'Which year?',
          fields: [{ id: 'year', type: 'number' }],
        }),
    });
    const agent = Agent.create({
      provider: mock({
        respond: () => ({ content: '', toolCalls: [{ id: 'c1', name: 'ask_year', args: {} }] }),
      }),
      model: 'mock',
    })
      .tool(tool)
      .build();
    const paused = await agent.run({ message: 'go' });
    if (!isInputPause(paused)) throw new Error('expected the ask');
    expect(timeReplyPairs(paused.awaitingInput)).toEqual([]);
    expect(timeReplyPairs(JSON.parse(JSON.stringify(paused.awaitingInput)))).toEqual([]);
    await agent.shutdown();
  });
});
