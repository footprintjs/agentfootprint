/**
 * PIN — the four `AblationSpec` arms, byte-for-byte.
 *
 * The strategy-arm work (`arms/`) is ADDITIVE by construction: it is a sibling
 * type, and `ablation.ts` / `bisect.ts` / `rerun.ts` / `cost.ts` were not
 * touched. This file is what makes "by construction" checkable rather than
 * asserted — it pins the removal tier's shape and its exact prose, so a later
 * attempt to fold substitution INTO the union (the design this repo rejected)
 * cannot pass quietly.
 *
 * Three things are pinned:
 *   1. the union has exactly four kinds (compile-time exhaustiveness + runtime);
 *   2. `applyAblations` filters exactly what it filtered;
 *   3. `verdictFor`'s claim sentences, character for character, for both of its
 *      intervention words — the reason the arm tier grew its OWN verdict prose
 *      instead of widening this one.
 */

import { describe, expect, it } from 'vitest';

import {
  ablationForSuspect,
  applyAblations,
  verdictFor,
  type AblationRunStats,
  type AblationSpec,
  type Suspect,
} from '../../../src/lib/context-bisect';

// ── 1. The union is still four arms ──────────────────────────────────

describe('AblationSpec — the union is REMOVALS, and there are four of them', () => {
  it('exhaustive over exactly tool | injection | memory | arg', () => {
    // A fifth arm makes this switch non-exhaustive and the `never` assignment
    // stops compiling — which is the point. Adding a substitution arm here is
    // the change this file exists to make loud.
    const kindOf = (spec: AblationSpec): string => {
      switch (spec.kind) {
        case 'tool':
          return 'tool';
        case 'injection':
          return 'injection';
        case 'memory':
          return 'memory';
        case 'arg':
          return 'arg';
        default: {
          const exhaustive: never = spec;
          return exhaustive;
        }
      }
    };
    const specs: AblationSpec[] = [
      { kind: 'tool', ignoredTools: ['t'] },
      { kind: 'injection', excludeInjectionIds: ['i'] },
      { kind: 'memory', excludeMemoryIds: ['m'] },
      { kind: 'arg', source: 's#0', note: 'n' },
    ];
    expect(specs.map(kindOf)).toEqual(['tool', 'injection', 'memory', 'arg']);
  });

  it('ablationForSuspect still maps the five suspect kinds unchanged', () => {
    const suspect = (partial: Partial<Suspect> & Pick<Suspect, 'kind'>): Suspect => ({
      source: 's#0',
      stageName: 'S',
      score: 1,
      structuralScore: 1,
      hasContentEvidence: false,
      edgePath: [],
      ...partial,
    });
    expect(ablationForSuspect(suspect({ kind: 'tool', detail: { toolName: 'lookup' } }))).toEqual({
      kind: 'tool',
      ignoredTools: ['lookup'],
    });
    expect(
      ablationForSuspect(suspect({ kind: 'injection', detail: { injectionId: 'vip' } })),
    ).toEqual({ kind: 'injection', excludeInjectionIds: ['vip'] });
    expect(ablationForSuspect(suspect({ kind: 'memory', detail: { injectionId: 'm1' } }))).toEqual({
      kind: 'memory',
      excludeMemoryIds: ['m1'],
    });
    expect(ablationForSuspect(suspect({ kind: 'arg' }))?.kind).toBe('arg');
    expect(ablationForSuspect(suspect({ kind: 'stage' }))).toBeUndefined();
  });
});

// ── 2. applyAblations filters exactly what it filtered ───────────────

describe('applyAblations — unchanged by the substitution tier', () => {
  const targets = {
    tools: [{ schema: { name: 'a' } }, { schema: { name: 'b' } }],
    injections: [{ id: 'x' }, { id: 'y' }],
    memoryEntries: [{ id: 'm1' }, { id: 'm2' }],
  };

  it('all four kinds at once produce the same filtered inputs as before', () => {
    const out = applyAblations(
      [
        { kind: 'tool', ignoredTools: ['a'] },
        { kind: 'injection', excludeInjectionIds: ['x'] },
        { kind: 'memory', excludeMemoryIds: ['m2'] },
        { kind: 'arg', source: 's#0', note: 'the runner must override run input' },
      ],
      targets,
    );
    expect(out.tools.map((t) => t.schema.name)).toEqual(['b']);
    expect(out.injections.map((i) => i.id)).toEqual(['y']);
    expect(out.memoryEntries.map((m) => m.id)).toEqual(['m1']);
  });

  it('empty specs are the identity; an arg spec alone filters nothing', () => {
    expect(applyAblations([], targets)).toEqual(targets);
    expect(applyAblations([{ kind: 'arg', source: 's#0', note: 'n' }], targets)).toEqual(targets);
  });
});

// ── 3. verdictFor's prose, character for character ───────────────────

describe('verdictFor — the removal tier keeps its exact sentences', () => {
  const stats = (flips: number, samples = 3): AblationRunStats => ({
    samples,
    flips,
    similarity: { mean: 0.5, min: 0.4, max: 0.6, stdev: 0.1 },
  });

  it('ablating: all four sentences byte-identical', () => {
    expect(verdictFor('X', stats(3), true)).toEqual({
      verdict: 'confirmed',
      claim:
        'CAUSAL: ablating X flipped the outcome in 3/3 seeded reruns ' +
        '(mean similarity to original 0.500 ± 0.100).',
    });
    expect(verdictFor('X', stats(1), true)).toEqual({
      verdict: 'inconclusive',
      claim:
        'INCONCLUSIVE: ablating X flipped only 1/3 seeded reruns — below majority; ' +
        'raise samples or check scenario stability.',
    });
    expect(verdictFor('X', stats(0), true)).toEqual({
      verdict: 'not-confirmed',
      claim:
        'NOT CONFIRMED: ablating X did not change the outcome in 3 seeded reruns — ' +
        'its ranking remains a correlational proxy only.',
    });
    expect(verdictFor('X', stats(3), false)).toEqual({
      verdict: 'inconclusive',
      claim:
        'INCONCLUSIVE: the un-ablated baseline itself changed outcome across seeded reruns — ' +
        'no ablation verdict for X is trustworthy on an unstable scenario.',
    });
  });

  it('restoring: the mirror words are untouched too', () => {
    expect(verdictFor('dropped "d1"', stats(3), true, 'restoring').claim).toBe(
      'CAUSAL: restoring dropped "d1" flipped the outcome in 3/3 seeded reruns ' +
        '(mean similarity to original 0.500 ± 0.100).',
    );
    expect(verdictFor('dropped "d1"', stats(3), false, 'restoring').claim).toBe(
      'INCONCLUSIVE: the un-restored baseline itself changed outcome across seeded reruns — ' +
        'no restoration verdict for dropped "d1" is trustworthy on an unstable scenario.',
    );
  });

  it('the default action is still `ablating` — no caller had to change', () => {
    expect(verdictFor('X', stats(3), true).claim).toBe(
      verdictFor('X', stats(3), true, 'ablating').claim,
    );
  });
});
