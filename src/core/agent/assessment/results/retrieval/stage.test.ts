import { describe, expect, it } from 'vitest';
import { foldState } from '../../chart.js';

const excluded = {
  kind: 'ok',
  candidateCount: 3,
  admittedCount: 0,
  exclusions: { 'below-threshold': 3 },
  complete: true,
};

const request = {
  kind: 'retrieval-request',
  turn: 5,
  iteration: 1,
  accepted: 'absent',
  exposure: 'absent',
  committedProviderResponse: true,
  sources: [excluded],
} as const;

function reasons(rows: readonly unknown[], turnNumber = 5) {
  return foldState(
    {
      turnNumber,
      iteration: rows.reduce<number>((latest, row) => {
        const current = row as { turn?: number; iteration?: number };
        return current.turn === turnNumber && current.iteration !== undefined
          ? Math.max(latest, current.iteration)
          : latest;
      }, 1),
      history: [
        { role: 'user', content: 'What happened?' },
        { role: 'assistant', content: 'Here is the answer.' },
      ],
      findingsLedger: rows,
    },
    undefined,
    false,
  ).reasons;
}

describe('retrieval warnings read current committed requests', () => {
  it('names a known exclusion from a complete zero-inclusion turn', () => {
    const first = { ...request, turn: 4, exposure: 'present' };
    expect(reasons([first, request])).toContainEqual(
      expect.objectContaining({
        reason: 'memory-retrieval-excluded',
        layer: 3,
        witness: [{ kind: 'state', key: 'findingsLedger', path: '/1/sources/0' }],
      }),
    );
  });

  it('distinguishes a timeout from an ordinary empty lookup', () => {
    const empty = { ...excluded, candidateCount: 0, exclusions: {} };
    expect(reasons([{ ...request, sources: [empty] }])).toEqual([]);
    const timeout = { kind: 'timeout', admittedCount: 0, exclusions: {}, complete: true };
    expect(reasons([{ ...request, sources: [timeout] }]).map(({ reason }) => reason)).toEqual([
      'memory-retrieval-timeout',
    ]);
  });

  it.each(['present', 'unknown'])(
    'keeps an earlier %s exposure when the final call has zero',
    (exposure) => {
      expect(
        reasons([
          { ...request, exposure },
          { ...request, iteration: 2 },
        ]),
      ).toEqual([]);
    },
  );

  it('leaves a local response, missing iteration, old turn or unreadable witness unknown', () => {
    expect(reasons([{ ...request, accepted: 'local', committedProviderResponse: false }])).toEqual(
      [],
    );
    expect(reasons([{ ...request, iteration: 2 }])).toEqual([]);
    expect(reasons([request], 6)).toEqual([]);
    expect(reasons([{ ...request, sources: '[REDACTED]' }])).toEqual([]);
    expect(reasons([{ ...request, sources: [{ ...excluded, complete: false }] }])).toEqual([]);
  });
});
