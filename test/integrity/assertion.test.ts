/**
 * The assertion algebra — exclusion with its four fences (T6's shape,
 * pinned before any seam exists).
 *
 * The fences matter more than the detection: history is quotation (never
 * fires), unknowns never compare (honest absence), different predicates
 * never share a key (uncertainty is not contradiction), unstamped subjects
 * are incomparable. Each fence is what keeps a detector from becoming a
 * noise channel.
 *
 * Test types (Convention 3): unit (keying, participation) / contract (the
 * false-positive fences) / functional (the recorded suspended-tools shape).
 */

import { describe, expect, it } from 'vitest';
import { conflictsOf } from '../../src/integrity/assertion/conflicts.js';
import type { Assertion } from '../../src/integrity/assertion/types.js';
import { known, unknown } from '../../src/lib/claim/claim.js';
import {
  contextErrorIdentity,
  dedupeContextErrors,
  type ContextError,
} from '../../src/integrity/finding/types.js';

const a = (over: Partial<Assertion>): Assertion => ({
  subject: { kind: 'map', id: 'audit' },
  predicate: 'status',
  value: 'suspended',
  stratum: 'asserted',
  provenance: 'test',
  ...over,
});

describe('functional: the recorded suspended-tools shape fires once', () => {
  it('two asserted values on one single-valued key conflict, with both witnesses', () => {
    const conflicts = conflictsOf([
      a({ value: 'suspended', provenance: 'engagement write' }),
      a({ value: 'active', provenance: 'serving-entailment: offered(t1..t4)' }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.assertions).toHaveLength(2);
  });

  it('a known Claim compares by its value — known(suspended) conflicts with active', () => {
    const conflicts = conflictsOf([
      a({ value: known('suspended', 'kernel record') }),
      a({ value: 'active' }),
    ]);
    expect(conflicts).toHaveLength(1);
  });
});

describe('contract: the four false-positive fences', () => {
  it('history is quotation — a quoted stratum never fires', () => {
    expect(conflictsOf([a({ value: 'v3', stratum: 'quoted' }), a({ value: 'v4' })])).toHaveLength(
      0,
    );
  });

  it('unknowns never participate — an unknown neither corroborates nor contradicts', () => {
    expect(
      conflictsOf([a({ value: unknown('meter offline') }), a({ value: 'active' })]),
    ).toHaveLength(0);
  });

  it('different predicates never share a key — claimed vs observed is not a defect', () => {
    expect(
      conflictsOf([
        a({ predicate: 'claimed', value: 'yes' }),
        a({ predicate: 'observed', value: 'unobservable' }),
      ]),
    ).toHaveLength(0);
  });

  it('different epochs are history; the same epoch with two values is not', () => {
    expect(conflictsOf([a({ value: 'p1', epoch: 3 }), a({ value: 'p2', epoch: 4 })])).toHaveLength(
      0,
    );
    expect(conflictsOf([a({ value: 'p1', epoch: 4 }), a({ value: 'p2', epoch: 4 })])).toHaveLength(
      1,
    );
  });

  it('unstamped-different subjects are incomparable — silence, not a guess', () => {
    expect(
      conflictsOf([
        a({ subject: { kind: 'map', id: 'A' } }),
        a({ subject: { kind: 'map', id: 'B' }, value: 'active' }),
      ]),
    ).toHaveLength(0);
  });

  it('a declared multi-valued predicate is the exception, by declaration', () => {
    const two = [a({ predicate: 'tags', value: 'x' }), a({ predicate: 'tags', value: 'y' })];
    expect(conflictsOf(two)).toHaveLength(1);
    expect(conflictsOf(two, new Set(['tags']))).toHaveLength(0);
  });
});

describe('unit: findings deduplicate by identity — one defect, one finding', () => {
  it('the same kind+seam+subjects+epoch is one finding across ten filings', () => {
    const finding: ContextError = {
      kind: 'invariant-violation',
      seam: 'write',
      subjects: [{ kind: 'map', id: 'audit' }],
      witnesses: [a({}), a({ value: 'active' })],
      epoch: 4,
      message: 'status(audit) asserted both suspended and active',
    };
    const filings = Array.from({ length: 10 }, () => ({ ...finding }));
    expect(dedupeContextErrors(filings)).toHaveLength(1);
    // Subject order does not split identity.
    const flipped: ContextError = {
      ...finding,
      subjects: [
        { kind: 'tool', id: 't1' },
        { kind: 'map', id: 'audit' },
      ],
    };
    const sameFlipped: ContextError = {
      ...finding,
      subjects: [
        { kind: 'map', id: 'audit' },
        { kind: 'tool', id: 't1' },
      ],
    };
    expect(contextErrorIdentity(flipped)).toBe(contextErrorIdentity(sameFlipped));
  });
});
