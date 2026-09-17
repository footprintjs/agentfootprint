/**
 * Unit — the one writer and the outcome row (9.105.0, `toolChoice/record.ts`).
 *
 * Pinned: `recordToolChoice` appends a FRESH array (the prior one untouched),
 * takes the prior rows explicitly when the caller's frame holds them as a
 * frozen input, and emits one event per row with identities, enums, numbers
 * and a boolean only — never a description, never the message; `outcomeRowFor`
 * sets `firstAgrees` only when both readings exist and `miss` only on a
 * narrowed call whose reply named an unserved tool.
 */

import { describe, expect, it } from 'vitest';
import {
  outcomeRowFor,
  pickAttemptedFor,
  pickRowFor,
  recordToolChoice,
  type ToolChoiceScope,
} from '../../../../src/core/agent/toolChoice/record.js';
import type {
  ToolChoiceEntry,
  ToolChoiceRow,
} from '../../../../src/core/agent/toolChoice/types.js';

const PICK: ToolChoiceRow = {
  kind: 'pick',
  iteration: 2,
  source: 'classifier',
  classifier: { name: 'mock', model: 'jev-1.13.0' },
  offered: ['lookup', 'charge', 'ship'],
  ranked: [
    { name: 'charge', score: 0.7 },
    { name: 'lookup', score: 0.2 },
    { name: 'ship', score: 0.1 },
  ],
  chosen: 'charge',
  confidence: 0.7,
  usage: { inputTokens: 120, outputTokens: 9 },
  latencyMs: 42,
  served: ['read_skill', 'lookup', 'charge'],
  narrowed: true,
};

function scopeOf(prior?: readonly ToolChoiceEntry[]) {
  const events: { name: string; payload: unknown }[] = [];
  const scope: ToolChoiceScope = {
    ...(prior !== undefined && { toolChoices: prior }),
    $emit: (name, payload) => events.push({ name, payload }),
  };
  return { scope, events };
}

describe('recordToolChoice', () => {
  it('appends a fresh array and leaves the prior one untouched', () => {
    const prior: ToolChoiceEntry[] = [PICK];
    const { scope } = scopeOf(prior);
    const outcome = outcomeRowFor(PICK, ['charge'], 2);
    recordToolChoice(scope, outcome);
    expect(scope.toolChoices).toEqual([PICK, outcome]);
    expect(scope.toolChoices).not.toBe(prior);
    expect(prior).toEqual([PICK]);
  });

  it('takes the prior rows explicitly when the caller’s frame holds them as a frozen input', () => {
    const { scope } = scopeOf();
    recordToolChoice(scope, PICK, [outcomeRowFor(undefined, [], 1)]);
    expect(scope.toolChoices?.map((r) => r.kind)).toEqual(['outcome', 'pick']);
  });

  it('a pick emits identities, numbers and the narrowing flag — never the descriptions', () => {
    const { scope, events } = scopeOf();
    recordToolChoice(scope, { ...PICK, narrowedSkipped: undefined });
    expect(events).toEqual([
      {
        name: 'agentfootprint.tool_choice.picked',
        payload: {
          iteration: 2,
          chosen: 'charge',
          confidence: 0.7,
          offered: 3,
          served: 3,
          narrowed: true,
          latencyMs: 42,
          inputTokens: 120,
          outputTokens: 9,
        },
      },
    ]);
  });

  it('a skipped narrowing carries its reason on the event; an absent chosen stays absent', () => {
    const { scope, events } = scopeOf();
    const { chosen: _dropped, usage: _u, ...rest } = PICK;
    recordToolChoice(scope, { ...rest, narrowed: false, narrowedSkipped: 'too-few' });
    expect(events[0]!.payload).toEqual({
      iteration: 2,
      confidence: 0.7,
      offered: 3,
      served: 3,
      narrowed: false,
      narrowedSkipped: 'too-few',
      latencyMs: 42,
    });
  });

  it('a failure emits the status and latency; the message stays on the row', () => {
    const { scope, events } = scopeOf();
    recordToolChoice(scope, {
      kind: 'pick-error',
      iteration: 3,
      source: 'classifier',
      classifier: { name: 'mock' },
      status: 529,
      message: 'overloaded — do not put me in an event',
      latencyMs: 7,
      served: ['lookup'],
    });
    expect(events).toEqual([
      {
        name: 'agentfootprint.tool_choice.failed',
        payload: { iteration: 3, status: 529, latencyMs: 7 },
      },
    ]);
  });

  it('an outcome emits the called names, the agreement and the miss', () => {
    const { scope, events } = scopeOf();
    recordToolChoice(scope, outcomeRowFor(PICK, ['ship', 'charge'], 2));
    expect(events).toEqual([
      {
        name: 'agentfootprint.tool_choice.outcome',
        payload: { iteration: 2, called: ['ship', 'charge'], firstAgrees: false, missed: ['ship'] },
      },
    ]);
  });
});

describe('outcomeRowFor', () => {
  it('firstAgrees is chosen === called[0]', () => {
    expect(outcomeRowFor(PICK, ['charge', 'lookup'], 2)).toEqual({
      kind: 'outcome',
      iteration: 2,
      called: ['charge', 'lookup'],
      firstAgrees: true,
    });
    expect(outcomeRowFor(PICK, ['lookup'], 2).firstAgrees).toBe(false);
  });

  it('firstAgrees is absent on an answer, and when the pick had no chosen', () => {
    expect(outcomeRowFor(PICK, [], 2)).toEqual({ kind: 'outcome', iteration: 2, called: [] });
    const { chosen: _c, ...unchosen } = PICK;
    expect('firstAgrees' in outcomeRowFor(unchosen, ['charge'], 2)).toBe(false);
  });

  it('miss names every called tool outside the NARROWED served list; a served door is never a miss', () => {
    expect(outcomeRowFor(PICK, ['read_skill', 'ship', 'invoice'], 2).miss).toEqual({
      wanted: ['ship', 'invoice'],
    });
  });

  it('an un-narrowed call cannot miss, whatever was called', () => {
    const full = { ...PICK, narrowed: false, served: ['lookup'] };
    expect('miss' in outcomeRowFor(full, ['ship'], 2)).toBe(false);
    expect('miss' in outcomeRowFor(undefined, ['ship'], 2)).toBe(false);
  });
});

describe('pickRowFor / pickAttemptedFor', () => {
  const rows: ToolChoiceEntry[] = [
    PICK,
    outcomeRowFor(PICK, ['charge'], 2),
    {
      kind: 'pick-error',
      iteration: 3,
      source: 'classifier',
      classifier: { name: 'mock' },
      message: 'x',
      latencyMs: 1,
      served: [],
    },
  ];
  it('finds the pick row for an iteration, and knows an error row was an attempt', () => {
    expect(pickRowFor(rows, 2)).toBe(PICK);
    expect(pickRowFor(rows, 3)).toBeUndefined();
    expect(pickAttemptedFor(rows, 3)).toBe(true);
    expect(pickAttemptedFor(rows, 4)).toBe(false);
    expect(pickAttemptedFor(undefined, 2)).toBe(false);
  });
});
