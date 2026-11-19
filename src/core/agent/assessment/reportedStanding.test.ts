import { describe, expect, it } from 'vitest';

import type { LLMMessage } from '../../../provider-contract/types.js';
import { assessAnswer } from './assess.js';
import { assessmentDataOf, standingFactsOf, standingLineOf } from './compose.js';

const tool = 'lookup_fixture';
const user: LLMMessage = { role: 'user', content: 'Check the fixture.' };
const proposed = (id: string, args: Record<string, unknown> | undefined) => ({
  role: 'assistant',
  content: '',
  toolCalls: [{ id, name: tool, ...(args === undefined ? {} : { args }) }],
});
const landed = (id: string, status?: 'partial' | 'pending', outcome?: 'failed') => ({
  role: 'tool' as const,
  toolCallId: id,
  toolName: tool,
  content: 'Request received.',
  ...(status === undefined ? {} : { reportedStatus: status }),
  ...(outcome === undefined ? {} : { outcome }),
});

function reasonCodes(history: readonly unknown[], findingsLedger: readonly unknown[] = []) {
  return assessAnswer({ snapshot: { sharedState: { history, turnNumber: 2, findingsLedger } } })
    .reasons;
}

describe('standing over a committed reported status', () => {
  it.each(['pending', 'partial'] as const)('uses only the recorded %s message field', (status) => {
    const reasons = reasonCodes([user, landed('c1', status)]);
    expect(reasons).toMatchObject([
      {
        reason: 'work-not-finished',
        layer: 3,
        source: { kind: 'calls', calls: [{ toolName: tool, reportedStatus: status }] },
        witness: [{ kind: 'history', index: 1, path: '/reportedStatus' }],
      },
    ]);
    expect(reasonCodes([user, { ...landed('c1'), content: 'The job is pending.' }])).toEqual([]);
    expect(reasonCodes([user, landed('c1', status), user])).toEqual([]);
  });

  it('prefers the recorded failure when an imported message carries both', () => {
    expect(reasonCodes([user, landed('c1', 'pending', 'failed')]).map((r) => r.reason)).toEqual([
      'call-not-completed',
    ]);
  });

  it.each([
    { label: 'same recorded arguments', retry: { item: 'a' }, status: undefined, clears: true },
    { label: 'different arguments', retry: { item: 'b' }, status: undefined, clears: false },
    { label: 'hidden arguments', retry: { item: 'REDACTED' }, status: undefined, clears: false },
    { label: 'missing arguments', retry: undefined, status: undefined, clears: false },
    { label: 'unfinished retry', retry: { item: 'a' }, status: 'partial' as const, clears: false },
  ])('decides recovery with $label', ({ retry, status, clears }) => {
    const history = [
      user,
      proposed('c1', { item: 'a' }),
      landed('c1', 'pending'),
      proposed('c2', retry),
      landed('c2', status),
    ];
    expect(reasonCodes(history).some((r) => r.reason === 'work-not-finished')).toBe(!clears);
  });

  it('clears only the occurrence retried with matching arguments under a reused id', () => {
    const id = 'c1';
    const history = [
      user,
      proposed(id, { item: 'a' }),
      landed(id, 'pending'),
      proposed(id, { item: 'b' }),
      landed(id, 'partial'),
      proposed(id, { item: 'a' }),
      landed(id),
    ];
    expect(reasonCodes(history)).toMatchObject([
      {
        reason: 'work-not-finished',
        source: {
          kind: 'calls',
          calls: [{ toolCallId: id, toolName: tool, reportedStatus: 'partial' }],
        },
        witness: [{ kind: 'history', index: 4, path: '/reportedStatus' }],
      },
    ]);
  });
});

describe('standing over committed procedure skips', () => {
  const skip = {
    kind: 'step-skipped',
    turn: 2,
    iteration: 1,
    skillId: 'fixture',
    index: 1,
    total: 2,
    tool,
    toolCallId: 'skip-1',
    policy: 'advance',
  };

  it('uses witnesses of this turn and leaves earlier-turn skips out', () => {
    expect(reasonCodes([user], [{ ...skip, turn: 1 }, skip])).toMatchObject([
      {
        reason: 'step-skipped',
        layer: 4,
        source: { kind: 'run' },
        witness: [{ kind: 'state', key: 'findingsLedger', path: '/1/kind' }],
      },
    ]);
    expect(reasonCodes([user], [{ ...skip, turn: 1 }])).toEqual([]);
    expect(reasonCodes([user], [{ ...skip, policy: 'hold' }])).toEqual([]);
  });

  it('counts the steps the procedure advanced past', () => {
    const assessed = assessAnswer({
      snapshot: {
        sharedState: {
          history: [user],
          turnNumber: 2,
          findingsLedger: [skip, { ...skip, index: 2, toolCallId: 'skip-2' }],
        },
      },
    });
    const line = standingLineOf(
      assessmentDataOf(assessed),
      [],
      false,
      standingFactsOf(assessed, new Map()),
    );
    expect(line).toBe('Not sure — 2 declared steps were skipped.');
  });
});
