/**
 * negative-claim — a SOUNDNESS ORACLE: an independent, brute-force reference over a small
 * exhaustive domain, written here from the design's rules and nowhere else.
 *
 * The seeded properties (`property.test.ts`) pin monotonicity and determinism, and both pass for
 * a checker that never withholds or always establishes. This file closes that hole: every point of
 * the domain is judged by the checker AND by the reference, and they must agree; then the same
 * comparison is run against three mutants — "always establish", "never withhold" (no prose note)
 * and "always withhold" — and each must be caught.
 *
 * Typed domain: the cited read (turn, outcome, emptiness, composed, one completeness gap, the
 * `complete` flag) × one other call (none; same search with more rows; same search failing after;
 * a write after, dispatched or refused; a wider search with rows; a narrower search with rows;
 * another tool with rows) × kind (`none`, `complete`) — 2 304 points.
 *
 * Prose domain: one read (outcome, emptiness, one gap) × four sentences — 160 points.
 */
import { describe, expect, it } from 'vitest';

import { judgeTypedNegatives } from '../../../src/integrity/negative-claim/judge.js';
import { judgeProseNegatives } from '../../../src/integrity/negative-claim/prose.js';
import type { SearchGap } from '../../../src/integrity/negative-claim/searchRow.js';
import type { ProseClaimRow, TurnCall } from '../../../src/integrity/negative-claim/types.js';
import { EMAIL_GAP, changesCall, incidentCall, rid, turnRecord, writeCall } from './fixtures.js';

// ── the typed domain ────────────────────────────────────────────────────────────────────────

type Kind = 'none' | 'complete';
type Other =
  | 'absent'
  | 'same-more-rows'
  | 'same-fails-after'
  | 'write-after'
  | 'write-refused'
  | 'wider-rows'
  | 'narrower-rows'
  | 'other-tool-rows';

interface TypedPoint {
  readonly earlier: boolean;
  readonly outcome: 'ok' | 'error';
  readonly emptiness: 'declared-absent' | 'non-empty' | 'undeclared-empty';
  readonly composed: 'local' | 'remote';
  readonly gap: 'none' | 'paged' | 'cap-reached';
  readonly complete: boolean;
  readonly other: Other;
  readonly kind: Kind;
}

const GAP: Record<TypedPoint['gap'], readonly SearchGap[]> = {
  none: [],
  paged: [{ kind: 'paged', what: 'page: 2', bears: 'completeness' }],
  'cap-reached': [{ kind: 'cap-reached', what: 'limit: 200 reached', bears: 'completeness' }],
};

function typedPoints(): TypedPoint[] {
  const out: TypedPoint[] = [];
  for (const earlier of [false, true])
    for (const outcome of ['ok', 'error'] as const)
      for (const emptiness of ['declared-absent', 'non-empty', 'undeclared-empty'] as const)
        for (const composed of ['local', 'remote'] as const)
          for (const gap of ['none', 'paged', 'cap-reached'] as const)
            for (const complete of [true, false])
              for (const other of [
                'absent',
                'same-more-rows',
                'same-fails-after',
                'write-after',
                'write-refused',
                'wider-rows',
                'narrower-rows',
                'other-tool-rows',
              ] as const)
                for (const kind of ['none', 'complete'] as const)
                  out.push({ earlier, outcome, emptiness, composed, gap, complete, other, kind });
  return out;
}

/** The record of one point: the cited read c1 (critical severity), then the other call. */
function typedCalls(p: TypedPoint): TurnCall[] {
  const cited = incidentCall({
    id: 'c1',
    severity: 'critical',
    turn: p.earlier ? 1 : 2,
    outcome: p.outcome,
    emptiness: p.emptiness,
    rows: p.emptiness === 'non-empty' ? 3 : 0,
    composed: p.composed,
    gaps: GAP[p.gap],
    complete: p.complete,
  });
  const after = { turn: 2 };
  switch (p.other) {
    case 'absent':
      return [cited];
    case 'same-more-rows':
      return [
        cited,
        incidentCall({ id: 'c2', severity: 'critical', emptiness: 'non-empty', rows: 5, ...after }),
      ];
    case 'same-fails-after':
      return [cited, incidentCall({ id: 'c2', severity: 'critical', outcome: 'error', ...after })];
    case 'write-after':
      return [cited, writeCall('w1', after)];
    case 'write-refused':
      return [cited, writeCall('w1', { ...after, outcome: 'error', dispatched: false })];
    case 'wider-rows':
      return [cited, incidentCall({ id: 'c2', emptiness: 'non-empty', rows: 2, ...after })];
    case 'narrower-rows':
      return [
        cited,
        incidentCall({
          id: 'c2',
          severity: 'critical',
          window: '30m',
          emptiness: 'non-empty',
          rows: 1,
          ...after,
        }),
      ];
    case 'other-tool-rows':
      return [cited, changesCall('k1', 2)];
  }
}

/** THE REFERENCE — the rules of § 5.1 and § 5.4 as plain conditions over the point. */
function referenceEstablished(p: TypedPoint): boolean {
  if (p.earlier || p.outcome !== 'ok' || p.composed !== 'local') return false;
  if (p.kind === 'none') {
    if (p.emptiness !== 'declared-absent' || p.gap === 'paged') return false;
  } else if (!p.complete || p.gap !== 'none') {
    return false;
  }
  switch (p.other) {
    case 'same-more-rows':
      return false; // a same-search read with rows contradicts a none, and has MORE rows than the list
    case 'same-fails-after':
    case 'write-after':
      return false;
    case 'wider-rows':
      return p.kind === 'complete'; // rows of a wider search withhold a none; none are provably inside
    case 'narrower-rows':
      // Its row is inside the cited scope: it contradicts a none, and a list of fewer rows.
      return p.kind === 'complete' && p.emptiness === 'non-empty';
    default:
      return true;
  }
}

type TypedImpl = (negatives: unknown, calls: readonly TurnCall[]) => string | undefined;

const realTyped: TypedImpl = (negatives, calls) =>
  judgeTypedNegatives({ field: 'n', negatives, record: turnRecord(calls, { turn: 2 }) })[0]?.row
    .code;

const disagreements = (impl: TypedImpl): string[] =>
  typedPoints().flatMap((p) => {
    const code = impl([{ kind: p.kind, restsOn: [rid('c1')] }], typedCalls(p));
    return (code === 'established') === referenceEstablished(p)
      ? []
      : [`${JSON.stringify(p)} → ${code}`];
  });

describe('ORACLE — the typed door agrees with the reference on every point', () => {
  it('2 304 points, no disagreement', () => {
    expect(typedPoints()).toHaveLength(2304);
    expect(disagreements(realTyped)).toEqual([]);
  });

  it('the reference holds both outcomes, so it can catch both kinds of mutant', () => {
    const established = typedPoints().filter(referenceEstablished).length;
    expect(established).toBeGreaterThan(0);
    expect(established).toBeLessThan(typedPoints().length);
  });

  it.each([
    ['always establish', (() => 'established') as TypedImpl],
    ['always withhold', (() => 'call-not-read') as TypedImpl],
  ])('catches the "%s" mutant', (_name, mutant) => {
    expect(disagreements(mutant).length).toBeGreaterThan(0);
  });
});

// ── the prose domain ────────────────────────────────────────────────────────────────────────

const TEXTS = {
  scoped: 'The incident store has no open incidents on payments in the last 2 hours.',
  flat: 'There are no open incidents on payments in the last 2 hours.',
  noWindow: 'There are no open incidents on payments.',
  noOpen: 'Payments had no incidents in the last 2 hours.',
} as const;

const PROSE_GAPS: Record<string, readonly SearchGap[]> = {
  none: [],
  email: [EMAIL_GAP],
  prose: [{ kind: 'prose', what: 'the archive tier' }],
  paged: [{ kind: 'paged', what: 'page: 2', bears: 'completeness' }],
  cap: [{ kind: 'cap-reached', what: 'limit reached', bears: 'completeness' }],
};

interface ProsePoint {
  readonly outcome: 'ok' | 'error';
  readonly emptiness: 'declared-absent' | 'non-empty' | 'undeclared-empty' | 'clarify';
  readonly gap: keyof typeof PROSE_GAPS;
  readonly text: keyof typeof TEXTS;
}

function prosePoints(): ProsePoint[] {
  const out: ProsePoint[] = [];
  for (const outcome of ['ok', 'error'] as const)
    for (const emptiness of [
      'declared-absent',
      'non-empty',
      'undeclared-empty',
      'clarify',
    ] as const)
      for (const gap of Object.keys(PROSE_GAPS) as (keyof typeof PROSE_GAPS)[])
        for (const text of Object.keys(TEXTS) as (keyof typeof TEXTS)[])
          out.push({ outcome, emptiness, gap, text });
  return out;
}

/** THE REFERENCE for prose: no note only for a read, declared-absent, fully named, no bearing gap. */
function referenceNoNote(p: ProsePoint): boolean {
  if (p.outcome !== 'ok' || p.emptiness !== 'declared-absent') return false;
  if (p.text === 'noWindow' || p.text === 'noOpen') return false;
  if (p.gap === 'none') return true;
  return p.gap === 'email' && p.text === 'scoped';
}

type ProseImpl = (text: string, calls: readonly TurnCall[]) => ProseClaimRow | undefined;

const realProse: ProseImpl = (text, calls) =>
  judgeProseNegatives({ field: 's', text, record: turnRecord(calls) }).find(
    (r): r is ProseClaimRow => r.kind === 'negative-claim',
  );

const proseDisagreements = (impl: ProseImpl): string[] =>
  prosePoints().flatMap((p) => {
    const row = impl(TEXTS[p.text], [
      incidentCall({
        outcome: p.outcome,
        emptiness: p.emptiness,
        rows: p.emptiness === 'non-empty' ? 2 : 0,
        gaps: PROSE_GAPS[p.gap],
      }),
    ]);
    const noNote = row !== undefined && row.notes.length === 0;
    return noNote === referenceNoNote(p)
      ? []
      : [`${JSON.stringify(p)} → ${JSON.stringify(row?.notes)}`];
  });

describe('ORACLE — the prose door agrees with the reference on every point', () => {
  it('160 points, no disagreement', () => {
    expect(prosePoints()).toHaveLength(160);
    expect(proseDisagreements(realProse)).toEqual([]);
  });

  it('catches the "never withhold" mutant (no note, ever)', () => {
    const mutant: ProseImpl = (text, calls) => {
      const row = realProse(text, calls);
      return row === undefined ? undefined : { ...row, notes: [] };
    };
    expect(proseDisagreements(mutant).length).toBeGreaterThan(0);
  });
});
