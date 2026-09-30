/**
 * lib/mcp/elicitation — a typed ask carried as an MCP elicitation, and back
 * (the time design § 6.1, step T4: a `time-range` field maps to two
 * `date-time` elicitation fields).
 *
 * Test types:
 *   unit        — each field kind's properties (string, number, boolean, labelled choices, an
 *                 instant, a zone, a range as `.from`/`.to`); `required` only where there is one way
 *                 to answer; a re-ask's reason leads the message; a supplied field is not asked;
 *   functional  — the round trip: content → `InputResponse` → the resume door takes it (a range
 *                 joined `from/to`; a choice OR a free entry);
 *   integration — through a real agent: the pause's elicitation, the client's content, the resume
 *                 runs; a refused range comes back as a re-ask whose elicitation leads with the
 *                 reason;
 *   security    — a property the elicitation did not ask, a choice AND a free entry, half a
 *                 range, an object value, a number `enum` (no MCP spelling), a colliding field id —
 *                 each refused by name, never widened;
 *   property, performance, load — not applicable: a pure field-by-field mapping over at most 32
 *                 fields, with no search and no state.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  InputRequestError,
  answerFromElicitation,
  defineTool,
  elicitationOf,
  isInputPause,
  requestInput,
  type AwaitingInput,
  type InputField,
} from '../../../src/index.js';
import { stampInputRequest } from '../../../src/core/inputRequest.js';

const ORIGIN = { originalRequest: 'traffic?', toolCallId: 'c1' };
const awaiting = (fields: readonly InputField[], extra: object = {}): AwaitingInput =>
  stampInputRequest({ id: 'ask', question: 'Which window?', fields, ...extra }, 'req-1', ORIGIN);

const RANGE: InputField = { id: 'window', type: 'string', format: 'time-range' };
const CHOICE = '2026-10-09T08:00-07:00/2026-10-09T08:41-07:00';

describe('elicitationOf — unit', () => {
  it('maps each field kind onto MCP’s primitive properties', () => {
    const request = elicitationOf(
      awaiting([
        { id: 'site', type: 'string', description: 'The site.' },
        { id: 'limit', type: 'number', required: false },
        { id: 'deep', type: 'boolean', required: false },
        { id: 'region', type: 'string', enum: ['east', 'west'], labels: ['East', 'West'] },
        { id: 'at', type: 'string', format: 'instant' },
        { id: 'zone', type: 'string', format: 'zone' },
        RANGE,
      ]),
    );
    expect(request).toEqual({
      message: 'Which window?',
      requestedSchema: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'The site.' },
          limit: { type: 'number' },
          deep: { type: 'boolean' },
          region: { type: 'string', enum: ['east', 'west'], enumNames: ['East', 'West'] },
          at: { type: 'string', format: 'date-time' },
          zone: { type: 'string' },
          'window.from': { type: 'string', format: 'date-time' },
          'window.to': { type: 'string', format: 'date-time' },
        },
        required: ['site', 'region', 'at', 'zone', 'window.from', 'window.to'],
      },
    });
  });

  it('a time field with choices offers them AND free entry — neither required; strict offers the choices only', () => {
    const labelled: InputField = {
      ...RANGE,
      enum: [CHOICE],
      labels: ['Fri, Oct 9, 8:00 – 8:40 AM PDT'],
    };
    expect(elicitationOf(awaiting([labelled])).requestedSchema).toEqual({
      type: 'object',
      properties: {
        window: { type: 'string', enum: [CHOICE], enumNames: ['Fri, Oct 9, 8:00 – 8:40 AM PDT'] },
        'window.from': { type: 'string', format: 'date-time' },
        'window.to': { type: 'string', format: 'date-time' },
      },
    });
    expect(elicitationOf(awaiting([{ ...labelled, strict: true }])).requestedSchema).toEqual({
      type: 'object',
      properties: {
        window: { type: 'string', enum: [CHOICE], enumNames: ['Fri, Oct 9, 8:00 – 8:40 AM PDT'] },
      },
      required: ['window'],
    });
    const zone: InputField = { id: 'zone', type: 'string', format: 'zone', enum: ['UTC'] };
    expect(Object.keys(elicitationOf(awaiting([zone])).requestedSchema.properties)).toEqual([
      'zone',
      'zone.other',
    ]);
  });

  it('a supplied field is not asked; a re-ask’s reason leads the message', () => {
    const request = elicitationOf(
      awaiting([RANGE, { id: 'site', type: 'string' }], {
        supplied: { site: 'east' },
        refused: { answer: { window: 'soon' }, reason: '“soon” is not a start and an end.' },
      }),
    );
    expect(request.message).toBe('“soon” is not a start and an end.\n\nWhich window?');
    expect(Object.keys(request.requestedSchema.properties)).toEqual(['window.from', 'window.to']);
  });
});

describe('answerFromElicitation — functional', () => {
  it('joins a range’s two properties as from/to; takes a choice or a free entry', () => {
    const pending = awaiting([RANGE, { id: 'site', type: 'string' }]);
    expect(
      answerFromElicitation(pending, {
        'window.from': '2026-10-09T08:00-07:00',
        'window.to': '2026-10-09T08:41-07:00',
        site: 'east',
      }),
    ).toEqual({ requestId: 'req-1', values: { window: CHOICE, site: 'east' } });
    const labelled = awaiting([{ ...RANGE, enum: [CHOICE], labels: ['x'] }]);
    expect(answerFromElicitation(labelled, { window: CHOICE }).values).toEqual({ window: CHOICE });
    const zone = awaiting([{ id: 'zone', type: 'string', format: 'zone', enum: ['UTC'] }]);
    expect(answerFromElicitation(zone, { 'zone.other': 'Asia/Kolkata' }).values).toEqual({
      zone: 'Asia/Kolkata',
    });
  });
});

describe('answerFromElicitation — security', () => {
  const pending = awaiting([{ ...RANGE, enum: [CHOICE] }]);
  it.each([
    ['a property it did not ask', { window: CHOICE, admin: true }],
    ['a choice and a free entry', { window: CHOICE, 'window.from': '2026-10-09T08:00-07:00' }],
    ['half a range', { 'window.from': '2026-10-09T08:00-07:00' }],
    ['an object value', { window: { toString: 'x' } }],
    ['not an object', ['x']],
  ])('refuses %s', (_name, content) => {
    expect(() => answerFromElicitation(pending, content)).toThrow(InputRequestError);
  });
  it('refuses a field MCP cannot carry, and a colliding id', () => {
    expect(() => elicitationOf(awaiting([{ id: 'n', type: 'number', enum: [1, 2] }]))).toThrow(
      /choices of strings only/,
    );
    expect(() =>
      elicitationOf(awaiting([RANGE, { id: 'window.from', type: 'string', required: false }])),
    ).toThrow(/collides/);
  });
});

describe('through a real agent — integration', () => {
  function agent(script: { content: string; toolCalls?: object[] }[]) {
    let i = 0;
    return Agent.create({
      provider: {
        name: 'elicit-mock',
        complete: async () => {
          const reply = script[Math.min(i++, script.length - 1)]!;
          return {
            content: reply.content,
            toolCalls: reply.toolCalls ?? [],
            usage: { input: 0, output: 0 },
          };
        },
      } as never,
      model: 'mock',
      maxIterations: 6,
    })
      .tool(
        defineTool({
          name: 'collect_window',
          description: 'Collect the query time window.',
          inputSchema: { type: 'object', properties: {} },
          execute: () => requestInput({ id: 'q', question: 'Which window?', fields: [RANGE] }),
        }),
      )
      .build();
  }

  it('elicits, answers, re-asks with the reason first, then runs', async () => {
    const runner = agent([
      { content: '', toolCalls: [{ id: 'c1', name: 'collect_window', args: {} }] },
      { content: 'Done.' },
    ]);
    const first = await runner.run({ message: 'traffic?' });
    if (!isInputPause(first)) throw new Error('expected an input pause');
    expect(Object.keys(elicitationOf(first.awaitingInput).requestedSchema.properties)).toEqual([
      'window.from',
      'window.to',
    ]);
    const second = await runner.resume(
      first.checkpoint,
      answerFromElicitation(first.awaitingInput, {
        'window.from': '2026-10-09T08:41-07:00',
        'window.to': '2026-10-09T08:00-07:00',
      }),
    );
    if (!isInputPause(second)) throw new Error('expected the re-ask');
    expect(elicitationOf(second.awaitingInput).message).toMatch(
      /^The start 2026-10-09T08:41-07:00 is not before the end 2026-10-09T08:00-07:00\.\n\nWhich window\?$/,
    );
    const done = await runner.resume(
      second.checkpoint,
      answerFromElicitation(second.awaitingInput, {
        'window.from': '2026-10-09T08:00-07:00',
        'window.to': '2026-10-09T08:41-07:00',
      }),
    );
    expect(done).toBe('Done.');
  });
});
