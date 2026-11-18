/** Pure identity controls; runtime behavior lives in governedResultRowsets.test.ts. */
import { describe, expect, it } from 'vitest';
import {
  contextErrorIdentity,
  dedupeContextErrors,
  type ContextError,
} from '../../src/integrity/finding/types.js';

const legacy: ContextError = {
  kind: 'column-type-mismatch',
  seam: 'write',
  subjects: [{ kind: 'tool', id: 'read_vm_disks' }],
  predicate: 'capacity_gb',
  witnesses: [],
  epoch: 2,
  message: 'Synthetic identity fixture.',
};
const expectedLegacy = 'column-type-mismatch @write [tool read_vm_disks] capacity_gb 2';
// Structural input executes the unchanged baseline helper; no proposed public
// symbol or source implementation is needed to observe its ignored rowset.
const named = (predicate: string, rowset: string) => ({ ...legacy, predicate, rowset });

describe('baseline controls: optional rowset absence preserves exact legacy identity bytes', () => {
  it('keeps the established absent-discriminator bytes and dedup rule', () => {
    expect(contextErrorIdentity(legacy)).toBe(expectedLegacy);
    const explicitUndefined = { ...legacy, rowset: undefined };
    expect(contextErrorIdentity(explicitUndefined)).toBe(expectedLegacy);
    expect(dedupeContextErrors([legacy, { ...legacy, message: 'Same defect again.' }])).toEqual([
      legacy,
    ]);
  });

  it('keeps column components distinct before and after a rowset discriminator exists', () => {
    const left = named('capacity_gb|left', 'right');
    const right = named('capacity_gb', 'left|right');
    // A naive predicate + '|' + rowset join maps both to the same string.
    expect(`${left.predicate}|${left.rowset}`).toBe(`${right.predicate}|${right.rowset}`);
    expect(contextErrorIdentity(left)).not.toBe(contextErrorIdentity(right));
    expect(dedupeContextErrors([left, right])).toEqual([left, right]);
  });
});

describe('new RED expectation: named rowsets are an injective identity component', () => {
  it('separates named/legacy and delimiter-like names for the same native defect', () => {
    const left = named('capacity_gb', 'disks:a|b');
    const right = named('capacity_gb', 'disks:a%7Cb');
    expect(contextErrorIdentity(left)).not.toBe(expectedLegacy);
    expect(contextErrorIdentity(left)).not.toBe(contextErrorIdentity(right));
    expect(dedupeContextErrors([legacy, left, right])).toEqual([legacy, left, right]);
  });
});
