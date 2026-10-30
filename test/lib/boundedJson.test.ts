import { describe, expect, it, vi } from 'vitest';
import {
  copyJson,
  cutToJsonBytes,
  jsonBytes,
  ownData,
  readOwnList,
} from '../../src/lib/boundedJson.js';

describe('shared bounded JSON copy preserves the answer-validation contract', () => {
  it('keeps own prototype-named data and detaches every shared child', () => {
    const child = { value: 3 };
    const source = JSON.parse('{"__proto__":{"label":"data"}}');
    source.left = child;
    source.right = child;
    const result = copyJson(source, 1024, false) as typeof source;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(result.__proto__).toEqual({ label: 'data' });
    expect(result.left).not.toBe(child);
    expect(result.right).not.toBe(result.left);
    expect(Object.isFrozen(result.left)).toBe(false);
    result.left.value = 7;
    expect(child.value).toBe(3);
    expect(result.right.value).toBe(3);
  });

  it('freezes copied arrays and objects without freezing the source', () => {
    const source = { rows: [{ value: null }] };
    const result = copyJson(source, 1024, true) as typeof source;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rows)).toBe(true);
    expect(Object.isFrozen(result.rows[0])).toBe(true);
    expect(Object.isFrozen(source.rows[0])).toBe(false);
  });

  it('counts UTF-8 JSON bytes at the exact boundary', () => {
    const source = { value: '😀\n' };
    const bytes = new TextEncoder().encode(JSON.stringify(source)).byteLength;
    expect(copyJson(source, bytes, false)).toEqual(source);
    expect(() => copyJson(source, bytes - 1, false)).toThrow('JSON byte limit.');
  });

  it('retains the original depth boundary', () => {
    const nested = (depth: number): unknown => {
      let result: unknown = null;
      for (let index = 0; index < depth; index++) result = [result];
      return result;
    };
    expect(copyJson(nested(100), 1024, false)).toEqual(nested(100));
    expect(() => copyJson(nested(101), 1024, false)).toThrow('JSON nesting limit.');
  });

  it('never invokes accessors or toJSON to make non-data values acceptable', () => {
    const getter = vi.fn(() => 'PRIVATE_VALUE');
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
    const toJSON = vi.fn(() => ({}));
    expect(() => copyJson(accessor, 1024, false)).toThrow('Expected an enumerable data property.');
    expect(() => copyJson({ toJSON }, 1024, false)).toThrow('Non-JSON value.');
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('keeps strict own-data admission separate from recursive JSON validation', () => {
    const fn = () => undefined;
    const source = Object.assign(Object.create(null), { validate: fn });
    const result = ownData(source, ['validate']);
    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(result.validate).toBe(fn);
    expect(() => ownData({ extra: 1 }, ['validate'])).toThrow('Unknown property.');
    expect(() => ownData(Object.create({ validate: fn }))).toThrow('Expected a plain data object.');
    expect(() => ownData({ [Symbol('private')]: 1 })).toThrow('Unknown property.');
  });
});

describe('readOwnList — a list read the way copyJson reads an array, by a reader that never refuses', () => {
  it('reads a plain array by index: a hole and an accessor entry read as undefined, the getter never called', () => {
    const getter = vi.fn(() => 'PRIVATE_VALUE');
    const list: unknown[] = ['a'];
    list.length = 3; // index 1 is a hole
    Object.defineProperty(list, 2, { enumerable: true, get: getter });
    expect(readOwnList(list, 10)).toEqual({ entries: ['a', undefined, undefined], unread: 0 });
    expect(getter).not.toHaveBeenCalled();
  });

  it('never calls the list’s iterator or a method on it', () => {
    const iterate = vi.fn(function* () {
      yield 'not an entry';
    });
    const list = Object.defineProperty(['a', 'b'], Symbol.iterator, { value: iterate });
    const map = vi.fn();
    Object.defineProperty(list, 'map', { value: map });
    expect(readOwnList(list, 10)).toEqual({ entries: ['a', 'b'], unread: 0 });
    expect(iterate).not.toHaveBeenCalled();
    expect(map).not.toHaveBeenCalled();
  });

  it('reads at most maxEntries and counts the rest — a claimed length is never walked', () => {
    expect(readOwnList(['a', 'b', 'c'], 2)).toEqual({ entries: ['a', 'b'], unread: 1 });
    const list: unknown[] = [];
    list.length = 2 ** 32 - 1;
    const read = readOwnList(list, 1_000);
    expect(read?.entries).toHaveLength(1_000);
    expect(read?.unread).toBe(2 ** 32 - 1 - 1_000);
  });

  it('a value that is not a plain array is no list at all', () => {
    for (const value of [
      undefined,
      null,
      'ab',
      { 0: 'a', length: 1 },
      Object.setPrototypeOf(['a'], null),
      new (class Rows extends Array {})(),
    ]) {
      expect(readOwnList(value, 10)).toBeUndefined();
    }
  });
});

describe('jsonBytes — the one serialized-size measure: UTF-8 bytes of the JSON, escaping included', () => {
  /** An independent measure: what a host would write. */
  const wire = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

  it('counts what JSON writes, not characters: escapes, UTF-8 width, surrogates', () => {
    for (const [text, bytes] of [
      ['abc', 5],
      ['\u0001', 8], // "\u0001": six bytes and the quotes
      ['"', 4], // "\""
      ['\\', 4], // "\\\\"
      ['\n', 4], // "\\n"
      ['\u00e9', 4], // two UTF-8 bytes
      ['\uffff', 5], // three UTF-8 bytes
      ['\u{10FFFF}', 6], // four UTF-8 bytes, two code units
      ['\ud800', 8], // a lone surrogate JSON escapes
      ['\u2028', 5], // written raw by JSON, three UTF-8 bytes
    ] as const) {
      expect(jsonBytes(text), JSON.stringify(text)).toBe(bytes);
      expect(jsonBytes(text)).toBe(wire(text));
    }
    expect(jsonBytes(undefined)).toBe(0);
    const value = { a: ['\u0001'.repeat(3), '\uffff', { b: null, c: 1.5 }], d: true };
    expect(jsonBytes(value)).toBe(wire(value));
  });

  it('is the measure copyJson spends: a string at the exact byte boundary', () => {
    const text = '\u0001'.repeat(10);
    expect(() => copyJson(text, jsonBytes(text), false)).not.toThrow();
    expect(() => copyJson(text, jsonBytes(text) - 1, false)).toThrow('JSON byte limit.');
  });
});

describe('cutToJsonBytes — the longest prefix, in whole code points, within a serialized size', () => {
  it('cuts by what JSON writes: six bytes a control character, four an astral one, never half of one', () => {
    expect(cutToJsonBytes('abc', 2)).toBe('ab');
    expect(cutToJsonBytes('abc', 3)).toBe('abc');
    expect(cutToJsonBytes('\u0001\u0001', 11)).toBe('\u0001');
    expect(cutToJsonBytes('\u0001\u0001', 12)).toBe('\u0001\u0001');
    expect(cutToJsonBytes('\u{10FFFF}x', 3)).toBe('');
    expect(cutToJsonBytes('\u{10FFFF}x', 4)).toBe('\u{10FFFF}');
    expect(cutToJsonBytes('\ud800x', 6)).toBe('\ud800');
  });

  it('every cut is within its size and a prefix — and nothing longer would be', () => {
    const units = ['a', '\u0001', '"', '\u00e9', '\uffff', '\u{10FFFF}', '\ud800', '\u2028'];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let round = 0; round < 300; round++) {
      const text = Array.from({ length: next() % 40 }, () => units[next() % units.length]).join('');
      const max = next() % 120;
      const cut = cutToJsonBytes(text, max);
      expect(text.startsWith(cut)).toBe(true);
      expect(jsonBytes(cut) - 2).toBeLessThanOrEqual(max);
      if (cut.length < text.length) {
        const unit = text.codePointAt(cut.length)! > 0xffff ? 2 : 1;
        expect(jsonBytes(text.slice(0, cut.length + unit)) - 2).toBeGreaterThan(max);
      }
    }
  });
});
