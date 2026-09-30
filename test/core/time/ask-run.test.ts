/**
 * The time ask end to end (the time design § 6, step T4) — a `requestInput`
 * field with a `format`, answered through `agent.resume`, on a scripted
 * provider. No model is called and no English is read.
 *
 * Law: the library checks a time answer before the app sees it; a refused
 * answer is asked again with the 9.127.0 shapes (`refused: { answer, reason }`,
 * `repeat: { count }`), the reason a catalog sentence, and nothing runs.
 *
 * Test types:
 *   functional  — answers out of order, zone-less, not a range, and (under `.time()`, which knows
 *                 the person's zone) in a DST gap → re-ask with `refused` and `repeat`, the field
 *                 `missing` again, no model call; a good answer then runs and the tool's result
 *                 carries it; `.time({ messages })` words the reason; a `zone` field refuses `PST`;
 *                 a non-`strict` field with choices keeps free entry open, a `strict` one does not;
 *                 the definition refusals (`format` off a string field, a malformed choice or
 *                 supplied value, labels not one per choice, `strict` where it changes nothing);
 *   integration — the re-ask crosses a JSON round trip of its checkpoint onto a FRESH agent and
 *                 still counts; a kept valid field is not asked again; the re-ask passes the
 *                 checkpoint door (`validateCheckpoint`);
 *   security    — a refused answer never reaches the model or the record (the request bytes and
 *                 the history hold only the accepted answer); the reason never rides the served
 *                 `input_received` result;
 *   byte identity — a `format` field answered well serves the model the same bytes as its twin
 *                 without one (every unarmed reference: test/core/tools/byte-identity.test.ts);
 *   load        — a 32-field time ask answered in one reply, one field refused: one re-ask naming
 *                 that field, inside a budget;
 *   unit, property, performance — ask.test.ts.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  InputRequestError,
  defaultTimeAskMessages,
  defineTool,
  isInputPause,
  requestInput,
  type InputField,
  type InputRequestDeclaration,
  type RunnerPauseOutcome,
} from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'time-ask-mock',
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

const LA = 'America/Los_Angeles';
const GOOD = '2026-10-09T08:00-07:00/2026-10-09T08:41-07:00';
const SCRIPT: readonly Reply[] = [
  { content: '', toolCalls: [{ id: 'c1', name: 'collect_window', args: {} }] },
  { content: 'Done.' },
];

const WINDOW_FIELD: InputField = {
  id: 'window',
  type: 'string',
  format: 'time-range',
  description: 'The window to search, from/to.',
};
const declaration = (fields: readonly InputField[] = [WINDOW_FIELD]): InputRequestDeclaration => ({
  id: 'query-window',
  question: 'Which window should the search cover?',
  fields,
});

function windowAgent(
  options: {
    fields?: readonly InputField[];
    /** The replies left — a fresh agent resuming a copied checkpoint starts past the ask. */
    script?: readonly Reply[];
    time?: Parameters<ReturnType<typeof Agent.create>['time']>[0] | false;
  } = {},
) {
  const s = scripted(options.script ?? SCRIPT);
  let builder = Agent.create({
    provider: s.provider as never,
    model: 'mock',
    maxIterations: 6,
  }).tool(
    defineTool({
      name: 'collect_window',
      description: 'Collect the query time window.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => requestInput(declaration(options.fields)),
    }),
  );
  if (options.time !== false && options.time !== undefined) builder = builder.time(options.time);
  return { agent: builder.build(), requests: s.requests };
}

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function paused(
  result: unknown,
): RunnerPauseOutcome & { awaitingInput: NonNullable<RunnerPauseOutcome['awaitingInput']> } {
  if (!isInputPause(result)) throw new Error('expected an input pause');
  return result as never;
}

const runOpts = (armed: boolean) =>
  armed
    ? { message: 'errors this morning?', time: { zone: LA, now: '2026-10-09T15:40:00Z' } }
    : { message: 'errors this morning?' };

async function firstAsk(options: Parameters<typeof windowAgent>[0] = {}) {
  const made = windowAgent(options);
  const first = paused(
    await made.agent.run(runOpts(options.time !== undefined && options.time !== false)),
  );
  return { ...made, first };
}

// ─── functional ─────────────────────────────────────────────────────────

describe('a refused time answer is asked again — functional', () => {
  it('answers out of order → re-ask with refused and repeat, nothing runs', async () => {
    const { agent, requests, first } = await firstAsk();
    expect(first.awaitingInput.fields[0]).toMatchObject({ format: 'time-range' });
    const before = requests.length;
    const second = paused(
      await agent.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { window: '2026-10-09T08:41-07:00/2026-10-09T08:00-07:00' },
      }),
    );
    expect(requests.length).toBe(before); // no model call: the door asked again
    expect(second.awaitingInput.refused).toEqual({
      answer: { window: '2026-10-09T08:41-07:00/2026-10-09T08:00-07:00' },
      reason: 'The start 2026-10-09T08:41-07:00 is not before the end 2026-10-09T08:00-07:00.',
    });
    expect(second.awaitingInput.repeat).toEqual({ count: 1 });
    expect(second.awaitingInput.missing).toEqual(['window']);
    expect(second.awaitingInput.supplied).toEqual({});
    expect(second.awaitingInput.requestId).toBe(first.awaitingInput.requestId);
    expect(second.awaitingInput.question).toBe('Which window should the search cover?');
  });

  it('a zone-less answer, then one that is no range: each re-ask counts', async () => {
    const { agent, first } = await firstAsk();
    const second = paused(
      await agent.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { window: '2026-10-09T08:00/2026-10-09T08:40' },
      }),
    );
    expect(second.awaitingInput.refused?.reason).toBe(
      '“2026-10-09T08:00” has no offset, so it could be in any time zone. Add one, like -07:00, or Z for UTC.',
    );
    const third = paused(
      await agent.resume(second.checkpoint, {
        requestId: second.awaitingInput.requestId,
        values: { window: 'this morning' },
      }),
    );
    expect(third.awaitingInput.repeat).toEqual({ count: 2 });
    expect(third.awaitingInput.refused?.reason).toMatch(
      /^“this morning” is not a start and an end\./,
    );
  });

  it('in a DST gap → refused under .time() (the person’s zone is known), taken without it', async () => {
    const gap = '2026-03-08T02:30-08:00/2026-03-08T04:30-07:00';
    const armed = await firstAsk({ time: { zone: LA } });
    const reask = paused(
      await armed.agent.resume(armed.first.checkpoint, {
        requestId: armed.first.awaitingInput.requestId,
        values: { window: gap },
      }),
    );
    expect(reask.awaitingInput.refused?.reason).toBe(
      '2026-03-08 02:30 does not exist in America/Los_Angeles: the clocks skip that hour on that day. Pick a time before or after it.',
    );
    const unarmed = await firstAsk();
    const done = await unarmed.agent.resume(unarmed.first.checkpoint, {
      requestId: unarmed.first.awaitingInput.requestId,
      values: { window: gap },
    });
    expect(isInputPause(done)).toBe(false);
  });

  it('a good answer runs, and the tool’s result carries it', async () => {
    const { agent, first } = await firstAsk();
    const second = paused(
      await agent.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { window: '2026-10-09T08:41-07:00/2026-10-09T08:00-07:00' },
      }),
    );
    const done = await agent.resume(second.checkpoint, {
      requestId: second.awaitingInput.requestId,
      values: { window: GOOD },
    });
    expect(isInputPause(done)).toBe(false);
    expect(done).toBe('Done.');
  });

  it('.time({ messages }) words the reason; the rest of the catalog stays', async () => {
    const { agent, first } = await firstAsk({
      time: {
        zone: LA,
        messages: { 'answer.out-of-order': 'Start {{from}} must come before {{to}}.' },
      },
    });
    const second = paused(
      await agent.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { window: '2026-10-09T09:00Z/2026-10-09T08:00Z' },
      }),
    );
    expect(second.awaitingInput.refused?.reason).toBe(
      'Start 2026-10-09T09:00Z must come before 2026-10-09T08:00Z.',
    );
    expect(() =>
      Agent.create({ provider: scripted([]).provider as never, model: 'm' }).time({
        zone: LA,
        messages: { 'answer.nope': 'x' } as never,
      }),
    ).toThrow(/no key 'answer\.nope'/);
  });

  it('a zone field refuses an abbreviation and takes an IANA name', async () => {
    const zone: InputField = { id: 'zone', type: 'string', format: 'zone' };
    const { agent, first } = await firstAsk({ fields: [zone] });
    const second = paused(
      await agent.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { zone: 'PST' },
      }),
    );
    expect(second.awaitingInput.refused?.reason).toBe(
      defaultTimeAskMessages['answer.not-a-zone'].replace('{{value}}', 'PST'),
    );
    const done = await agent.resume(second.checkpoint, {
      requestId: second.awaitingInput.requestId,
      values: { zone: LA },
    });
    expect(isInputPause(done)).toBe(false);
  });

  it('choices keep free entry open unless strict', async () => {
    const choice = '2026-10-09T08:00-07:00/2026-10-09T08:41-07:00';
    const labelled: InputField = {
      ...WINDOW_FIELD,
      enum: [choice],
      labels: ['Fri, Oct 9, 2026, 8:00 – 8:40 AM PDT'],
    };
    const open = await firstAsk({ fields: [labelled] });
    expect(open.first.awaitingInput.fields[0]?.labels).toEqual([
      'Fri, Oct 9, 2026, 8:00 – 8:40 AM PDT',
    ]);
    const free = await open.agent.resume(open.first.checkpoint, {
      requestId: open.first.awaitingInput.requestId,
      values: { window: '2026-10-09T07:00-07:00/2026-10-09T07:30-07:00' },
    });
    expect(isInputPause(free)).toBe(false);
    const strict = await firstAsk({ fields: [{ ...labelled, strict: true }] });
    await expect(
      strict.agent.resume(strict.first.checkpoint, {
        requestId: strict.first.awaitingInput.requestId,
        values: { window: '2026-10-09T07:00-07:00/2026-10-09T07:30-07:00' },
      }),
    ).rejects.toThrow(InputRequestError);
  });
});

describe('a time field is refused at definition, never repaired — functional', () => {
  const raise =
    (field: object, extra: object = {}) =>
    () =>
      requestInput({ ...declaration([field as InputField]), ...extra });
  it.each([
    ['format off a string field', { id: 'n', type: 'number', format: 'instant' }],
    ['an unknown format', { id: 'w', type: 'string', format: 'date' }],
    [
      'a choice that is not its format',
      { id: 'w', type: 'string', format: 'instant', enum: ['2026-10-09T08:00'] },
    ],
    ['labels without choices', { id: 'w', type: 'string', format: 'zone', labels: ['x'] }],
    [
      'labels not one per choice',
      { id: 'w', type: 'string', format: 'zone', enum: ['UTC', 'Etc/UTC'], labels: ['UTC'] },
    ],
    ['strict without choices', { id: 'w', type: 'string', format: 'zone', strict: true }],
    ['strict off a time field', { id: 'w', type: 'string', enum: ['a'], strict: true }],
  ])('%s', (_name, field) => {
    expect(raise(field)).toThrow(InputRequestError);
  });
  it('a supplied value that is not its format', () => {
    expect(() =>
      requestInput({
        ...declaration([WINDOW_FIELD, { id: 'site', type: 'string' }]),
        supplied: { window: 'last week' },
      }),
    ).toThrow(/supplied value is not a well-formed time-range/);
  });
});

// ─── integration ─────────────────────────────────────────────────────────

describe('the re-ask crosses the checkpoint — integration', () => {
  it('a JSON copy of the re-ask resumes on a FRESH agent and still counts; a kept field is not asked', async () => {
    const fields: InputField[] = [WINDOW_FIELD, { id: 'site', type: 'string' }];
    const { first } = await firstAsk({ fields });
    const { agent: again } = windowAgent({ fields });
    const second = paused(
      await again.resume(roundTrip(first.checkpoint), {
        requestId: first.awaitingInput.requestId,
        values: { window: '2026-10-09T08:00/2026-10-09T08:40', site: 'east' },
      }),
    );
    expect(second.awaitingInput.supplied).toEqual({ site: 'east' });
    expect(second.awaitingInput.origins).toEqual({ site: 'response' });
    expect(second.awaitingInput.missing).toEqual(['window']);
    const { agent: third } = windowAgent({ fields });
    const reask = paused(
      await third.resume(roundTrip(second.checkpoint), {
        requestId: second.awaitingInput.requestId,
        values: { window: 'PST' },
      }),
    );
    expect(reask.awaitingInput.repeat).toEqual({ count: 2 });
    const done = await windowAgent({ fields, script: SCRIPT.slice(1) }).agent.resume(
      roundTrip(reask.checkpoint),
      {
        requestId: reask.awaitingInput.requestId,
        values: { window: GOOD },
      },
    );
    expect(isInputPause(done)).toBe(false);
  });
});

// ─── security + byte identity ────────────────────────────────────────────

describe('a refused answer reaches nothing — security', () => {
  it('the model and the record hold only the accepted answer; the reason is not served', async () => {
    const bad = '2026-10-09T08:41-07:00/2026-10-09T08:00-07:00';
    const { agent, requests, first } = await firstAsk();
    const second = paused(
      await agent.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { window: bad },
      }),
    );
    await agent.resume(second.checkpoint, {
      requestId: second.awaitingInput.requestId,
      values: { window: GOOD },
    });
    const served = JSON.stringify(requests);
    expect(served).toContain(GOOD);
    expect(served).not.toContain(bad);
    expect(served).not.toContain('is not before the end');
    expect(JSON.stringify(agent.getLastSnapshot()?.sharedState ?? {})).not.toContain(bad);
  });
});

describe('a good answer serves the same bytes — byte identity', () => {
  it('a format field answered well equals its twin without one', async () => {
    const plainField: InputField = {
      id: 'window',
      type: 'string',
      description: WINDOW_FIELD.description,
    };
    const bytes = async (fields: readonly InputField[]) => {
      const { agent, requests, first } = await firstAsk({ fields });
      await agent.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { window: GOOD },
      });
      return JSON.stringify(requests.map((r) => r.messages)).replace(/run-\d+-\d+/g, 'run-…');
    };
    expect(await bytes([WINDOW_FIELD])).toBe(await bytes([plainField]));
  });
});

// ─── load ────────────────────────────────────────────────────────────────

describe('a 32-field time ask — load', () => {
  it('one reply, one refused field: one re-ask naming it, inside a budget', async () => {
    const fields: InputField[] = Array.from({ length: 32 }, (_, i) => ({
      id: `w${i}`,
      type: 'string',
      format: 'time-range',
    }));
    const { agent, first } = await firstAsk({ fields, time: { zone: LA } });
    const values = Object.fromEntries(fields.map((f, i) => [f.id, i === 17 ? 'soon' : GOOD]));
    const start = performance.now();
    const second = paused(
      await agent.resume(first.checkpoint, { requestId: first.awaitingInput.requestId, values }),
    );
    expect(performance.now() - start).toBeLessThan(2_000);
    expect(second.awaitingInput.missing).toEqual(['w17']);
    expect(second.awaitingInput.refused?.answer).toEqual({ w17: 'soon' });
    expect(Object.keys(second.awaitingInput.supplied)).toHaveLength(31);
  });
});
