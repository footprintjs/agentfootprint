/** Admission and no-fill semantics for a separately confirmed person window. */
import { describe, expect, it } from 'vitest';
import { defineTool } from '../../../../src/index.js';
import { stampInputRequest } from '../../../../src/tools/inputRequest.js';
import {
  partialOriginOf,
  hasOneMaterializedWindow,
  validPartialState,
  snapshotPartialState,
  validPartialSnapshot,
} from '../../../../src/core/agent/arguments/partialWindow.js';
import {
  argumentAskDeclaration,
  bindAnswer,
  confirmationField,
  initialAskState,
  nextAskRound,
  settledCalls,
  withWaiting,
  type ArgumentAskState,
} from '../../../../src/core/agent/arguments/ask.js';
import type { BatchCall, ToolOf } from '../../../../src/core/agent/arguments/resolve.js';

const FROM = '2026-10-09T13:00:00Z';
const TO = '2026-10-09T15:00:00Z';
const PERSON = '2026-10-09T14:00:00Z/2026-10-09T16:00:00Z';
const TIME = { now: '2026-10-09T16:00:00Z', zone: 'UTC' } as const;
const tool = defineTool({
  name: 'series',
  description: 'Synthetic interval.',
  inputSchema: {
    type: 'object',
    properties: { start: { type: 'string' }, stop: { type: 'string' } },
  },
  askOrAssume: { start: { ask: 'Start?' }, stop: { ask: 'Stop?' } },
  period: {
    forms: [
      {
        kind: 'bounds',
        from: { argument: 'start', as: 'iso' },
        to: { argument: 'stop', as: 'iso', edge: 'exclusive' },
      },
    ],
  },
  execute: () => 'inert',
});
const toolOf: ToolOf = (name) => (name === 'series' ? tool : undefined);
const call = (args: Record<string, unknown>, id = 'c1'): BatchCall => ({
  id,
  name: 'series',
  args,
});
const original = call({ start: FROM });
const origin = partialOriginOf(original, toolOf, TIME);
if (origin === undefined || origin === 'ambiguous') throw new Error('invalid test fixture');
const identity = {
  owner: { runId: 'synthetic-owner', componentOrdinal: 0 },
  turn: 1,
  iteration: 2,
  mention: 0,
  origins: [origin],
};

describe('partial-window admission', () => {
  it('detaches private pause progress and keeps repeated snapshots finite', () => {
    const state: ArgumentAskState = {
      iteration: 2,
      partial: { ...identity, version: 1, phase: 'complete-arguments' },
      fields: [],
      progress: [{ rounds: 1, answer: 'private-answer' }],
      waiting: { requestId: 'owned', fieldIndexes: [], awaiting: {} as never },
    };
    const saved = snapshotPartialState(state);
    expect(validPartialSnapshot(saved)).toBe(true);
    expect(JSON.stringify(snapshotPartialState(saved))).toBe(JSON.stringify(saved));
    const changed = structuredClone(saved);
    (changed.progress[0] as { answer: string }).answer = 'changed';
    expect(validPartialSnapshot(changed)).toBe(false);
    expect(validPartialSnapshot(saved)).toBe(true);
    expect(saved.partial?.snapshot?.progress[0].answer).toBe('private-answer');
    expect(JSON.stringify(saved.partial?.snapshot)).not.toContain('snapshot');
  });
  for (const args of [{ start: FROM }, { stop: TO }]) {
    it(`admits exactly one missing bound: ${Object.keys(args)[0]}`, () => {
      expect(partialOriginOf(call(args), toolOf, TIME)).toMatchObject({
        form: 0,
        arguments: ['start', 'stop'],
      });
    });
  }
  for (const [name, args] of [
    ['all absent', {}],
    ['complete', { start: FROM, stop: TO }],
    ['malformed complete', { start: 'bad', stop: TO }],
    ['zone alone', { zone: 'UTC' }],
  ] as const) {
    it(`does not classify ${name} as partial bounds`, () => {
      expect(partialOriginOf(call(args), toolOf, TIME)).toBeUndefined();
    });
  }
  it('does not admit an already rejected argument payload', () => {
    expect(
      partialOriginOf({ ...original, argumentsFailure: 'invalid' as never }, toolOf, TIME),
    ).toBeUndefined();
  });
  it('detaches its original call and form from later caller edits', () => {
    const args = { start: FROM };
    const input = call(args);
    const saved = partialOriginOf(input, toolOf, TIME);
    args.start = TO;
    expect(saved).toMatchObject({ call: { args: { start: FROM } } });
  });
  it('requires a readable complete materialized window', () => {
    expect(hasOneMaterializedWindow(call({ start: FROM }), toolOf, TIME)).toBe(false);
    expect(hasOneMaterializedWindow(call({ start: FROM, stop: TO }), toolOf, TIME)).toBe(true);
    expect(hasOneMaterializedWindow(call({ start: TO, stop: FROM }), toolOf, TIME)).toBe(false);
  });
  const paired = defineTool({
    name: 'paired',
    description: 'Two declared interval forms.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'string' },
        stop: { type: 'string' },
        from: { type: 'string' },
        until: { type: 'string' },
      },
    },
    askOrAssume: {
      start: { ask: 'Start?' },
      stop: { ask: 'Stop?' },
      from: { ask: 'From?' },
      until: { ask: 'Until?' },
    },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'start', as: 'iso' },
          to: { argument: 'stop', as: 'iso', edge: 'exclusive' },
        },
        {
          kind: 'bounds',
          from: { argument: 'from', as: 'iso' },
          to: { argument: 'until', as: 'iso', edge: 'exclusive' },
        },
      ],
    },
    execute: () => 'inert',
  });
  const pairOf: ToolOf = (name) => (name === 'paired' ? paired : undefined);
  const pairCall = (args: Record<string, unknown>): BatchCall => ({
    id: 'pair',
    name: 'paired',
    args,
  });
  it('refuses ambiguous partial forms rather than selecting the first', () => {
    expect(partialOriginOf(pairCall({ start: FROM, from: FROM }), pairOf, TIME)).toBe('ambiguous');
  });
  it('leaves a readable complete alternative on the existing complete-call route', () => {
    expect(
      partialOriginOf(pairCall({ start: FROM, from: FROM, until: TO }), pairOf, TIME),
    ).toBeUndefined();
  });
  it('accepts multiple materialized forms only when their full intervals agree', () => {
    expect(
      hasOneMaterializedWindow(
        pairCall({ start: FROM, stop: TO, from: FROM, until: TO }),
        pairOf,
        TIME,
      ),
    ).toBe(true);
    expect(
      hasOneMaterializedWindow(
        pairCall({ start: FROM, stop: TO, from: FROM, until: '2026-10-09T16:00:00Z' }),
        pairOf,
        TIME,
      ),
    ).toBe(false);
  });
  it('accepts the original owner and phase through JSON round trip', () => {
    expect(
      validPartialState(
        JSON.parse(JSON.stringify({ ...identity, version: 1, phase: 'confirm-meaning' })),
        identity,
      ),
    ).toBe(true);
  });
  for (const [name, value] of Object.entries({
    version: 2,
    phase: 'unknown',
    owner: { runId: 'another-owner', componentOrdinal: 0 },
    turn: 2,
    iteration: 3,
    mention: 1,
    origins: [],
  })) {
    it(`refuses mismatched saved ${name}`, () => {
      expect(
        validPartialState(
          { ...identity, version: 1, phase: 'confirm-meaning', [name]: value },
          identity,
        ),
      ).toBe(false);
    });
  }
  it('refuses saved targets with changed call arguments', () => {
    const changed = {
      ...identity,
      version: 1,
      phase: 'confirm-meaning',
      origins: [{ ...origin, call: call({ start: TO }) }],
    };
    expect(validPartialState(changed, identity)).toBe(false);
  });
});

describe('native confirmation-only answer', () => {
  function answer(mixed = false) {
    const calls = [call({ start: FROM, stop: TO }), ...(mixed ? [call({}, 'c2')] : [])];
    const fillAsks = mixed ? [{ toolCallId: 'c2', window: true as const, ask: [] }] : [];
    const field = confirmationField(
      {
        question: 'Confirm time?',
        format: 'time-range',
        mention: 0,
        now: TIME.now,
        zone: TIME.zone,
      },
      [origin],
      fillAsks,
      calls,
      toolOf,
    );
    const initial = initialAskState(2, [field]);
    const round = nextAskRound(initial)!;
    const { declaration, fieldIndexes } = argumentAskDeclaration(initial, round);
    const awaiting = stampInputRequest(declaration, 'synthetic-request', {
      originalRequest: 'last 2 hours',
      toolCallId: 'c1',
    });
    const state = withWaiting(initial, { requestId: awaiting.requestId, fieldIndexes, awaiting });
    return { calls, state, field };
  }
  it('records one person answer without rewriting either partial-call endpoint', () => {
    const { calls, state, field } = answer();
    expect(field.members.length).toBeGreaterThan(0);
    const bound = bindAnswer(state, { f1: PERSON }, calls, toolOf, { turn: 1, iteration: 2 }, TIME);
    expect(bound.rows.filter((r) => r.kind === 'time-answer')).toHaveLength(1);
    expect(bound.rows.filter((r) => r.kind === 'argument')).toHaveLength(0);
    expect([...settledCalls(bound.state).values()].flatMap((v) => v.fills)).toEqual([]);
    expect(calls[0].args).toEqual({ start: FROM, stop: TO });
  });
  it('fills all-missing siblings while leaving the separately selected call intact', () => {
    const { calls, state } = answer(true);
    const bound = bindAnswer(state, { f1: PERSON }, calls, toolOf, { turn: 1, iteration: 2 }, TIME);
    const settled = settledCalls(bound.state);
    expect(settled.get('c1')?.fills ?? []).toEqual([]);
    expect(settled.get('c2')?.fills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ argument: 'start', value: '2026-10-09T14:00:00Z' }),
        expect.objectContaining({ argument: 'stop', value: '2026-10-09T16:00:00Z' }),
      ]),
    );
    expect(bound.rows.filter((r) => r.kind === 'time-answer')).toHaveLength(1);
  });
  it('refuses a forged role before recording an answer', () => {
    const { calls, state } = answer();
    const changed = {
      ...state,
      fields: state.fields.map((field) => ({
        ...field,
        window: { ...field.window!, role: 'unknown' as never },
      })),
    };
    expect(() =>
      bindAnswer(changed, { f1: PERSON }, calls, toolOf, { turn: 1, iteration: 2 }, TIME),
    ).toThrow(/unknown window role/);
  });
});
