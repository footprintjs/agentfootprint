import { describe, expect, it, vi } from 'vitest';
import * as assessment from '../../src/core/agent/assessment/assess.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { accountForAnswer, type Recording } from '../../src/observe.js';

const first = [1, 2, 3, 4, 0] as const;
const second = [1, 2, 3, 4, 1] as const;
const toolCallId = 'reused';
const toolName = 'shelf';
const tool = { toolCallId, toolName };

function proposal(callOccurrenceKey: readonly number[]) {
  return {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: toolCallId, name: toolName, args: { shelf: 'A' }, callOccurrenceKey }],
  };
}

function result(callOccurrenceKey: readonly number[], shelf: string) {
  return {
    role: 'tool',
    ...tool,
    content: JSON.stringify([shelf]),
    callOccurrenceKey,
    toolResultExecution: 'returned',
  };
}

function observation(iteration: number, callOccurrenceKey: readonly number[], extra: object) {
  return {
    kind: 'argument',
    turn: 1,
    iteration,
    ...tool,
    argument: 'shelf',
    rule: 'ask',
    callOccurrenceKey,
    ...extra,
  };
}

const firstProposal = proposal(first);
const secondProposal = proposal(second);
const firstResult = result(first, 'first result');
const secondResult = result(second, 'second result');
const failed = observation(1, first, {
  source: 'model',
  claimed: 'user',
  failed: 'quote-not-found',
});
const clean = observation(2, second, { source: 'said', claimed: 'user' });
const correction = observation(2, second, {
  claimed: 'none',
  correction: 'source-declaration-required',
});
const withheld = observation(1, first, { claimed: 'none', withheld: 'batch-preempted' });
const witness = { kind: 'state', key: 'findingsLedger', path: '/0/argument' };

type Source = 'named' | 'unplaced' | 'none';
type Leg = 'landed' | 'open' | 'undispatched';

interface Case {
  readonly name: string;
  readonly history: readonly object[];
  readonly ledger: readonly object[];
  readonly legs: readonly [Leg, Leg];
  readonly paused?: true;
  readonly checked: readonly number[];
  readonly keyed: Source;
  readonly legacy: Source;
  readonly legacyUnchecked?: readonly number[];
}

// The nine cases named in the review, with current entry facts and keyless legacy recordings.
const cases: readonly Case[] = [
  {
    name: '1 · one call landed with a failed check',
    history: [firstProposal, firstResult],
    ledger: [failed],
    legs: ['landed', 'undispatched'],
    checked: [0],
    keyed: 'named',
    legacy: 'named',
  },
  {
    name: '2 · the second proposal has no result at the pause',
    history: [firstProposal, firstResult, secondProposal],
    ledger: [failed, clean],
    legs: ['landed', 'open'],
    paused: true,
    checked: [0],
    keyed: 'named',
    legacy: 'none',
    legacyUnchecked: [0, 1],
  },
  {
    name: '3 · both calls landed',
    history: [firstProposal, firstResult, secondProposal, secondResult],
    ledger: [failed, clean],
    legs: ['landed', 'landed'],
    checked: [0, 1],
    keyed: 'named',
    legacy: 'none',
    legacyUnchecked: [0, 1],
  },
  {
    name: '4 · the first landed and the second was withheld for correction',
    history: [firstProposal, firstResult, secondProposal],
    ledger: [failed, correction],
    legs: ['landed', 'undispatched'],
    checked: [0],
    keyed: 'named',
    legacy: 'none',
    legacyUnchecked: [0],
  },
  {
    name: '5 · neither landed and the first check was corrected',
    history: [firstProposal, secondProposal],
    ledger: [failed, { ...correction, callOccurrenceKey: first }],
    legs: ['undispatched', 'undispatched'],
    checked: [],
    keyed: 'none',
    legacy: 'none',
  },
  {
    name: '6 · the first was withheld and the second landed clean',
    history: [firstProposal, secondProposal, secondResult],
    ledger: [withheld, clean],
    legs: ['undispatched', 'landed'],
    checked: [1],
    keyed: 'none',
    legacy: 'none',
    legacyUnchecked: [1],
  },
  {
    name: '7 · the first check failed without a result and the second landed clean',
    history: [firstProposal, secondProposal, secondResult],
    ledger: [failed, clean],
    legs: ['open', 'landed'],
    checked: [1],
    keyed: 'none',
    legacy: 'none',
    legacyUnchecked: [0, 1],
  },
  {
    name: '8 · two observations of one landed call',
    history: [firstProposal, firstResult],
    ledger: [failed, { ...clean, iteration: 1, callOccurrenceKey: first }],
    legs: ['landed', 'undispatched'],
    checked: [1],
    keyed: 'none',
    legacy: 'none',
  },
  {
    name: '9 · the first proposal and result were evicted after both calls landed',
    history: [secondProposal, secondResult],
    ledger: [failed, clean],
    legs: ['landed', 'landed'],
    checked: [0, 1],
    keyed: 'unplaced',
    legacy: 'none',
    legacyUnchecked: [0, 1],
  },
];

function event(type: AgentfootprintEvent['type'], payload: object, step: string) {
  return { type, payload, meta: { runId: 'fixture', runtimeStageId: step } };
}

function load(fixture: Case, keyed: boolean, recordedEntry = keyed): Recording {
  const message = 'Read the shelf.';
  const history = [{ role: 'user', content: message }, ...fixture.history];
  const brackets = fixture.legs.flatMap((leg, i) => {
    if (leg === 'undispatched') return [];
    const callOccurrenceKey = [first, second][i];
    const step = `tool-calls#${i + 1}`;
    const fields = { ...tool, callOccurrenceKey };
    const opening = event('agentfootprint.stream.tool_start', { ...fields, args: {} }, step);
    return leg === 'open'
      ? [opening]
      : [
          opening,
          event(
            'agentfootprint.stream.tool_end',
            {
              ...fields,
              entered: true,
              durationMs: 1,
              result: `${i + 1} result`,
            },
            step,
          ),
        ];
  });
  const recording = {
    snapshot: {
      sharedState: {
        turnNumber: 1,
        history,
        findingsLedger: fixture.ledger,
        ...(recordedEntry && {
          enteredToolCalls: {
            entries: fixture.legs.flatMap((leg, i) =>
              leg === 'landed' ? [{ callOccurrenceKey: [first, second][i], entered: true }] : [],
            ),
            complete: true,
          },
        }),
        ...(fixture.paused && { pausedToolCallId: toolCallId }),
      },
    },
    events: [
      event('agentfootprint.agent.turn_start', { message }, 'seed#1'),
      ...brackets,
      ...(fixture.paused
        ? []
        : [event('agentfootprint.agent.turn_end', { finalContent: 'Done.' }, 'final#1')]),
    ],
    structure: {},
  };
  return JSON.parse(
    JSON.stringify(recording, (key, value: unknown) => {
      if (!keyed && key === 'callOccurrenceKey') return undefined;
      if (!recordedEntry && key === 'toolResultExecution') return undefined;
      return value;
    }),
  ) as Recording;
}

function sourceOf(assessed: ReturnType<typeof assessment.assessAnswer>) {
  return assessed.reasons.find((reason) => reason.reason === 'argument-unverified');
}

describe('argument occurrences in loaded recordings', () => {
  it.each(cases)('$name', (fixture) => {
    for (const keyed of [true, false]) {
      const recording = load(fixture, keyed);
      const expected = keyed ? fixture.keyed : fixture.legacy;
      const unchecked = keyed ? undefined : fixture.legacyUnchecked;
      const checked = unchecked === undefined ? fixture.checked : [];
      const stateOnly = assessment.assessAnswer(recording);
      const failure = sourceOf(stateOnly);
      const check = (name: 'argument-rules' | 'argument-sources', field: string) =>
        expect(stateOnly.checked.find(({ check }) => check === name)).toEqual(
          checked.length === 0
            ? undefined
            : {
                check: name,
                layer: 2,
                ran: checked.length,
                of: checked.length,
                witness: checked.map((index) => ({
                  ...witness,
                  path: `/${index}/${field}`,
                })),
              },
        );
      check('argument-rules', 'argument');
      check('argument-sources', 'claimed');
      const unavailable = unchecked?.map((index) => ({ ...witness, path: `/${index}/argument` }));
      expect(stateOnly.reasons.find(({ reason }) => reason === 'check-unreachable')).toEqual(
        unavailable === undefined
          ? undefined
          : { reason: 'check-unreachable', source: { kind: 'run' }, witness: unavailable },
      );
      expect(failure?.witness).toEqual(expected === 'none' ? undefined : [witness]);
      expect(failure?.source).toEqual(
        expected === 'none'
          ? undefined
          : expected === 'named'
          ? { kind: 'calls', calls: [tool] }
          : { kind: 'calls', calls: [], unplaced: [witness] },
      );

      // The public account renders this internal source as witness lines. Capture
      // its actual fold result to prove parity before checking the rendered output.
      const fold = vi.spyOn(assessment, 'foldState');
      try {
        const account = accountForAnswer(recording);
        expect(fold.mock.results.map(({ value }) => value)).toContainEqual(stateOnly);
        expect(account.facts.standing.value).toBe(stateOnly.standing);
        const lines = account.rows.find(({ id }) => id === 'how-sure')?.lines ?? [];
        expect(
          lines.find(({ template }) => template.id === 'howSure.reason.argumentUnverified')
            ?.pointers,
        ).toEqual(expected === 'none' ? undefined : [witness]);
        expect(
          lines.find(({ template }) => template.id === 'howSure.reason.dispatchProofUnavailable')
            ?.pointers,
        ).toEqual(unavailable);
        expect(
          lines.some(({ template }) => template.id === 'howSure.reason.unplacedEvidence'),
        ).toBe(false);
        expect(
          lines.some(({ template }) => template.id === 'howSure.reason.resultUnavailable'),
        ).toBe(keyed && expected === 'unplaced');
      } finally {
        fold.mockRestore();
      }
    }
  });

  it('an older keyed record can prove an evicted call entered from its exact tool-end', () => {
    const fixture = cases[8]!;
    const exact = assessment.assessAnswer(load(fixture, true));
    const older = assessment.assessAnswer(load(fixture, true, false));
    expect(older).toEqual(exact);
    expect(sourceOf(older)?.source).toEqual({ kind: 'calls', calls: [], unplaced: [witness] });
  });

  it('reports a damaged duplicate result as unreadable', () => {
    const recording = load(
      {
        ...cases[0]!,
        history: [firstProposal, firstResult, result(first, 'conflicting result')],
      },
      true,
    );
    const stateOnly = assessment.assessAnswer(recording);
    expect(sourceOf(stateOnly)?.source).toEqual({ kind: 'calls', calls: [], unplaced: [witness] });
    const lines = accountForAnswer(recording).rows.find(({ id }) => id === 'how-sure')?.lines;
    expect(
      lines?.find(({ template }) => template.id === 'howSure.reason.callAddressUnreadable')
        ?.pointers,
    ).toEqual([witness]);
  });
});
