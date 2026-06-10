/**
 * canonicalJson — unit tests for the `afp-cjson/1` contract.
 *
 * These rules ARE the audit-chain byte contract (backlog #20): every
 * behavior asserted here is load-bearing for hash stability. A change
 * that breaks one of these tests breaks verification of every bundle
 * already exported — bump `CANONICAL_JSON_VERSION` instead.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJson, CANONICAL_JSON_VERSION } from '../../src/lib/canonicalJson.js';

describe('canonicalJson — afp-cjson/1', () => {
  it('names its rules version', () => {
    expect(CANONICAL_JSON_VERSION).toBe('afp-cjson/1');
  });

  it('sorts object keys lexicographically by UTF-16 code unit, recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    // Uppercase sorts before lowercase (code-unit order, not locale).
    expect(canonicalJson({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
  });

  it('is insertion-order independent (the property hashing depends on)', () => {
    const one = JSON.parse('{"x":1,"y":[{"b":2,"a":3}]}') as unknown;
    const two = JSON.parse('{"y":[{"a":3,"b":2}],"x":1}') as unknown;
    expect(canonicalJson(one)).toBe(canonicalJson(two));
  });

  it('emits no whitespace and preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson({ k: [true, false, null] })).toBe('{"k":[true,false,null]}');
  });

  it('serializes strings with JSON.stringify escaping', () => {
    expect(canonicalJson('a"b\\c\nd')).toBe(JSON.stringify('a"b\\c\nd'));
    expect(canonicalJson('café ☕')).toBe(JSON.stringify('café ☕'));
  });

  it('numbers: JSON.stringify parity (shortest round-trip, NaN/Infinity → null, -0 → 0)', () => {
    for (const n of [0, -0, 1, -1.5, 1e21, 5e-324, 0.1 + 0.2, Number.MAX_SAFE_INTEGER]) {
      expect(canonicalJson(n)).toBe(JSON.stringify(n));
    }
    expect(canonicalJson(NaN)).toBe('null');
    expect(canonicalJson(Infinity)).toBe('null');
    expect(canonicalJson(-Infinity)).toBe('null');
    expect(canonicalJson(-0)).toBe('0');
  });

  it('undefined/function/symbol: omitted as object props, null in arrays, null at top level', () => {
    expect(canonicalJson({ a: undefined, b: 1, c: () => 1, d: Symbol('s') })).toBe('{"b":1}');
    expect(canonicalJson([undefined, () => 1, Symbol('s')])).toBe('[null,null,null]');
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('honors toJSON (Date → ISO-8601, like JSON.stringify)', () => {
    const date = new Date('2026-06-10T12:00:00.000Z');
    expect(canonicalJson(date)).toBe('"2026-06-10T12:00:00.000Z"');
    expect(canonicalJson({ at: date })).toBe('{"at":"2026-06-10T12:00:00.000Z"}');
  });

  it('throws on bigint (JSON.stringify parity)', () => {
    expect(() => canonicalJson({ n: 10n })).toThrow(TypeError);
  });

  it('throws on circular references', () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(() => canonicalJson(cyc)).toThrow(/circular/);
  });

  it('shared (non-circular) references are fine — DAGs re-serialize per occurrence', () => {
    const shared = { v: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"v":1},"b":{"v":1}}');
  });

  it('round-trip stability: canonicalJson(JSON.parse(canonicalJson(x))) is a fixed point', () => {
    const value = { z: [1, { b: 'x', a: null }], a: 'é', n: 1.25 };
    const once = canonicalJson(value);
    expect(canonicalJson(JSON.parse(once))).toBe(once);
  });
});
