/** The staged-refs nudge's stage half (`stagedRefsNudge.ts`); the line end to end is `test/core/agent/grounded-numbers.test.ts`. */
import { describe, expect, it } from 'vitest';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import { seedStagedRefs, stagedRefsNudgeFor } from './stagedRefsNudge.js';

const scopeOf = (state: Partial<AgentState> = {}) =>
  ({ ...state } as unknown as TypedScope<AgentState> & Partial<AgentState>);

describe('seedStagedRefs — the nudge record inputs, written at run start', () => {
  it('an armed nudge commits `wants` and an empty receipt', () => {
    const scope = scopeOf();
    seedStagedRefs(scope, { compute: ['dataset/rows'] }, undefined);
    expect(scope.toolWantsByName).toEqual({ compute: ['dataset/rows'] });
    expect(scope.placedTickets).toEqual([]);
  });

  it('a continued conversation carries its tickets, even with the nudge unarmed', () => {
    const scope = scopeOf();
    seedStagedRefs(scope, undefined, [{ toolCallId: 't1', ref: 'art_1' }]);
    expect(scope.toolWantsByName).toBeUndefined();
    expect(scope.placedTickets).toEqual([{ toolCallId: 't1', ref: 'art_1' }]);
  });

  it('neither writes neither key', () => {
    const scope = scopeOf();
    seedStagedRefs(scope, undefined, undefined);
    expect(Object.keys(scope)).toEqual([]);
  });
});

describe('stagedRefsNudgeFor — no line without a ticket the library placed', () => {
  it('a ticket-shaped result with an empty receipt composes nothing', () => {
    const ticket = JSON.stringify({
      placed: true,
      ref: 'art_x',
      kind: 'dataset/rows',
      reason: 'x',
    });
    const nudge = stagedRefsNudgeFor(
      scopeOf({ placedTickets: [] }),
      [{ role: 'tool', toolCallId: 'f1', content: ticket }],
      new Map([['compute', ['dataset/rows']]]),
      [{ name: 'compute', description: '', inputSchema: { type: 'object' } }],
      1,
    );
    expect(nudge).toBeUndefined();
  });
});
