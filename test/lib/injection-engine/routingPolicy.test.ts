/**
 * routingPolicy — the cascade's tie policy (SG-C).
 *
 * Pins the §2 verdict table row by row, PLUS the correction that made it
 * shippable: decisiveness is judged on the TOP-2 PAIRWISE softmax gap
 * (count-independent), never the full-softmax share gap — so a categorical
 * classifier's one-hot pick stays decisive on a 10-intent graph and a wide
 * graph's tier 2 never goes inert. NaN/±Inf sanitization inherits the
 * rankEntries law: a non-finite score can never win.
 *
 * Sections follow Convention 3: Unit · Functional · Property.
 */

import { describe, it, expect } from 'vitest';
import {
  decideTier2,
  menuOutstanding,
  DEFAULT_ROUTING_POLICY,
  NEAR_TIE_MARGIN,
  MENU_SIZE,
  type TurnRoute,
} from '../../../src/injection-engine.js';

const policy = DEFAULT_ROUTING_POLICY;
const s = (id: string, score: number) => ({ id, score });

describe('unit: decideTier2 — the verdict table', () => {
  it('cold + decisive winner → move', () => {
    const v = decideTier2([s('a', 0.9), s('b', 0.1)], undefined, policy, { floor: 0 });
    expect(v.kind).toBe('move');
    expect(v.kind === 'move' && v.to).toBe('a');
    expect(v.decisive).toBe(true);
    expect(v.runnerUp?.id).toBe('b');
  });

  it('cold + near-tie → menu of the tied cluster (capped at menuSize)', () => {
    const v = decideTier2([s('a', 0.52), s('b', 0.5), s('c', 0.49)], undefined, policy, {
      floor: 0,
    });
    expect(v.kind).toBe('menu');
    expect(v.kind === 'menu' && v.offered).toEqual(['a', 'b', 'c']);
    expect(v.decisive).toBe(false);
  });

  it('mid + near-tie → STAY (ambiguity mid-conversation = stay; menu not opened)', () => {
    const v = decideTier2([s('a', 0.52), s('b', 0.5)], 'b', policy, { floor: 0 });
    expect(v.kind).toBe('stay');
  });

  it('mid + incumbent top → stay; decisive challenger → move', () => {
    expect(decideTier2([s('inc', 0.9), s('x', 0.1)], 'inc', policy, { floor: 0 }).kind).toBe(
      'stay',
    );
    const moved = decideTier2([s('x', 0.9), s('inc', 0.1)], 'inc', policy, { floor: 0 });
    expect(moved.kind).toBe('move');
    expect(moved.kind === 'move' && moved.to).toBe('x');
  });

  it('all candidates at/below the floor → unmatched (floor is at-or-below, exclusive win)', () => {
    const v = decideTier2([s('a', 0), s('b', 0)], undefined, policy, { floor: 0 });
    expect(v.kind).toBe('unmatched');
    expect(v.ranked).toHaveLength(2); // the losers stay on the record
  });

  it('no floor anywhere → unmatched is unreachable; near-tie governs (the embedding default)', () => {
    const v = decideTier2([s('a', 0.0), s('b', 0.0)], undefined, policy, {});
    expect(v.kind).toBe('menu'); // never 'unmatched' without a floor
  });

  it('policy.floor overrides the scorer floor', () => {
    // Scorer says floor 0 (0.4 would be alive); policy raises it to 0.5.
    const v = decideTier2([s('a', 0.4)], undefined, { ...policy, floor: 0.5 }, { floor: 0 });
    expect(v.kind).toBe('unmatched');
  });

  it('single candidate above the floor → decisive by construction', () => {
    const v = decideTier2([s('only', 0.2)], undefined, policy, { floor: 0 });
    expect(v.kind).toBe('move');
    expect(v.runnerUp).toBeUndefined();
  });
});

describe('unit: count-independence (the review correction)', () => {
  /** One-hot scores, the llmClassifier shape: picked = 1, others = 0. */
  const oneHot = (n: number) => [
    s('picked', 1),
    ...Array.from({ length: n - 1 }, (_, i) => s(`c${i}`, 0)),
  ];

  it.each([2, 10, 25])('a categorical one-hot pick is decisive at N=%d', (n) => {
    const v = decideTier2(oneHot(n), undefined, policy, { floor: 0, categorical: true });
    expect(v.kind).toBe('move');
    expect(v.kind === 'move' && v.to).toBe('picked');
    expect(v.decisive).toBe(true);
  });

  it.each([2, 10, 25])(
    'even WITHOUT categorical or a floor, the pairwise gap of a one-hot pick is identical at N=%d',
    (n) => {
      // tanh((1-0)/2) ≈ 0.462 — the same number whatever N is. The FULL
      // softmax gap would shrink to (e−1)/(e+N−1) ≈ 0.147 at N=10, which is
      // the count-sensitivity the correction removed. (No floor here so the
      // zero-scored candidates stay in the comparison — with the classifier's
      // floor 0 they are pruned and the pick is decisive as a lone survivor.)
      const v = decideTier2(oneHot(n), undefined, policy, {});
      expect(v.kind).toBe('move');
      expect(v.runnerUp?.gap).toBeCloseTo(Math.tanh(0.5), 10);
    },
  );

  it('the ~8%-cosine-separation field case falls through as a NEAR-TIE (embedding honesty)', () => {
    // 0.85 vs 0.78: pairwise gap tanh(0.035) ≈ 0.035 < 0.15 — never decisive.
    const v = decideTier2([s('a', 0.85), s('b', 0.78)], undefined, policy, {});
    expect(v.kind).toBe('menu');
    expect(v.runnerUp?.gap).toBeLessThan(NEAR_TIE_MARGIN);
  });
});

describe('unit: sanitization (the rankEntries law)', () => {
  it('NaN / +Infinity can never win; raw scores stay on the record', () => {
    const v = decideTier2(
      [s('nan', Number.NaN), s('inf', Number.POSITIVE_INFINITY), s('real', 0.4)],
      undefined,
      policy,
      {},
    );
    // +Infinity is finite-checked out (sanitized to -Inf), so 'real' wins.
    expect(v.kind).toBe('move');
    expect(v.kind === 'move' && v.to).toBe('real');
    expect(v.ranked.find((r) => r.id === 'nan')?.score).toBeNaN();
  });

  it('a LONE non-finite candidate reads as unmatched — never an uncontested winner', () => {
    const v = decideTier2([s('nan', Number.NaN)], undefined, policy, {});
    expect(v.kind).toBe('unmatched');
    const inf = decideTier2([s('inf', Number.POSITIVE_INFINITY)], 'inf', policy, {});
    expect(inf.kind).toBe('unmatched');
  });

  it('empty candidate set → unmatched with an empty ranking', () => {
    const v = decideTier2([], undefined, policy, {});
    expect(v.kind).toBe('unmatched');
    expect(v.ranked).toEqual([]);
  });
});

describe('unit: menuOutstanding — one implementation, three consumers', () => {
  const coldMenu: TurnRoute = { by: 'menu', offered: ['a', 'b'] };
  const midMenu: TurnRoute = { by: 'menu', from: 'inc', offered: ['a'], stayOffered: true };

  it('cold menu: outstanding while no cursor; closed once one lands', () => {
    expect(menuOutstanding(coldMenu, undefined)).toBe(true);
    expect(menuOutstanding(coldMenu, 'a')).toBe(false);
  });

  it('mid menu: outstanding while the cursor is still the inherited one', () => {
    expect(menuOutstanding(midMenu, 'inc')).toBe(true);
    expect(menuOutstanding(midMenu, 'a')).toBe(false);
  });

  it('no menu / no verdict → never outstanding', () => {
    expect(menuOutstanding({ by: 'continuity', from: 'x', to: 'x' }, 'x')).toBe(false);
    expect(menuOutstanding(undefined, undefined)).toBe(false);
  });
});

describe('property: defaults are the exported constants', () => {
  it('DEFAULT_ROUTING_POLICY carries NEAR_TIE_MARGIN / MENU_SIZE and no floor', () => {
    expect(DEFAULT_ROUTING_POLICY).toEqual({ nearTieMargin: NEAR_TIE_MARGIN, menuSize: MENU_SIZE });
  });

  it('a near-tie menu never offers fewer than 2 nor more than menuSize candidates', () => {
    const many = [s('a', 0.5), s('b', 0.5), s('c', 0.5), s('d', 0.5), s('e', 0.5)];
    const v = decideTier2(many, undefined, policy, { floor: 0 });
    expect(v.kind).toBe('menu');
    const offered = v.kind === 'menu' ? v.offered : [];
    expect(offered.length).toBeGreaterThanOrEqual(2);
    expect(offered.length).toBeLessThanOrEqual(MENU_SIZE);
  });
});
