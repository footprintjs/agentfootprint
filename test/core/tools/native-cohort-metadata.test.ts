import { describe, expect, it } from 'vitest';
import {
  assertNativeReadWindowMetadata,
  type NativeWindowAddition,
} from './native-cohort-metadata.js';

const additions: NativeWindowAddition[] = [
  { pointer: '/commitLog/1/beganAt', value: '<volatile>' },
  { pointer: '/commitLog/1/sawUntil', value: 3 },
];
const raw = (patch: Record<string, unknown> = {}) => ({
  commitLog: [{ idx: 0 }, { idx: 3, beganAt: 0, sawUntil: 3, ...patch }],
});

describe('native read-window metadata before normalization', () => {
  it('accepts sawUntil equal to idx and keeps the whole raw snapshot unchanged', () => {
    const snapshot = raw();
    const before = structuredClone(snapshot);
    expect(() => assertNativeReadWindowMetadata(snapshot, additions)).not.toThrow();
    expect(snapshot).toEqual(before);
  });

  it('accepts a single earlier look without a later look', () => {
    expect(() =>
      assertNativeReadWindowMetadata(raw({ sawUntil: undefined }), additions.slice(0, 1)),
    ).not.toThrow();
  });

  it('accepts the documented position fallback when a bundle says no index', () => {
    const snapshot = { commitLog: [{ idx: 2 }, { beganAt: 1, sawUntil: 3 }] };
    expect(() => assertNativeReadWindowMetadata(snapshot, additions)).not.toThrow();
  });

  it.each([
    ['clock/string', '<volatile>'],
    ['negative', -1],
    ['fraction', 0.5],
    ['NaN', NaN],
    ['infinite', Infinity],
    ['own position', 3],
    ['after own position', 4],
    ['undefined', undefined],
  ])('refuses a %s beganAt before the normalizer could hide it', (_name, beganAt) => {
    expect(() => assertNativeReadWindowMetadata(raw({ beganAt }), additions)).toThrow();
  });

  it.each([
    ['not a count', '3'],
    ['negative', -1],
    ['fraction', 1.5],
    ['NaN', NaN],
    ['infinite', Infinity],
    ['not after beganAt', 0],
    ['past own position', 4],
    ['different valid count', 2],
  ])('refuses a %s sawUntil', (_name, sawUntil) => {
    expect(() => assertNativeReadWindowMetadata(raw({ sawUntil }), additions)).toThrow();
  });

  it.each([0, -1, 2.5, Infinity, 2 ** 52 + 1])('refuses invalid stamped idx %s', (idx) => {
    expect(() => assertNativeReadWindowMetadata(raw({ idx }), additions)).toThrow();
  });

  it('does not treat a missing required beganAt as an older unstamped bundle', () => {
    expect(() =>
      assertNativeReadWindowMetadata({ commitLog: [{ idx: 0 }, { idx: 3 }] }, additions),
    ).toThrow('required raw metadata is missing');
  });

  it('rejects missing, duplicate and payload pointers instead of ignoring them', () => {
    for (const expected of [
      [{ pointer: '/commitLog/99/beganAt', value: '<volatile>' }],
      [additions[0], additions[0]],
      [{ pointer: '/commitLog/1/overwrite/beganAt', value: '<volatile>' }],
    ])
      expect(() =>
        assertNativeReadWindowMetadata(raw(), expected as NativeWindowAddition[]),
      ).toThrow();
  });

  it('leaves business fields named beganAt and sawUntil alone', () => {
    const snapshot = {
      commitLog: [{ idx: 0, overwrite: { beganAt: 'business label', sawUntil: -100 } }],
      served: [{ view: { beganAt: 'business label', sawUntil: -100 } }],
    };
    const before = structuredClone(snapshot);
    expect(() => assertNativeReadWindowMetadata(snapshot, [])).not.toThrow();
    expect(snapshot).toEqual(before);
  });
});
