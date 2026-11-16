import { describe, expect, it, vi } from 'vitest';
import { isThenable, plainJson } from './readerAnswer.js';

describe('reader answer thenability', () => {
  it('declines nullish, primitive and non-callable then values', () => {
    for (const value of [null, undefined, 0, false, '', Symbol('s'), 1n, {}, { then: 1 }]) {
      expect(isThenable(value)).toBe(false);
    }
  });

  it('recognizes a Promise and callable own or inherited then without invoking it', () => {
    const then = vi.fn(() => undefined);
    expect(isThenable(Promise.resolve())).toBe(true);
    expect(isThenable({ then })).toBe(true);
    expect(isThenable(Object.create({ then }))).toBe(true);
    expect(isThenable(Object.assign(() => undefined, { then }))).toBe(true);
    expect(then).not.toHaveBeenCalled();
  });

  it('reads a then getter once per check, with the original receiver', () => {
    const then = vi.fn(() => undefined);
    const receivers: unknown[] = [];
    const value = {
      get then() {
        receivers.push(this);
        return receivers.length === 1 ? then : null;
      },
    };
    expect(isThenable(value)).toBe(true);
    expect(receivers).toEqual([value]);
    expect(isThenable(value)).toBe(false);
    expect(receivers).toEqual([value, value]);
    expect(then).not.toHaveBeenCalled();
  });

  it('propagates a then getter failure for the caller to classify', () => {
    const failure = new Error('reader failed');
    const value = {
      get then() {
        throw failure;
      },
    };
    expect(() => isThenable(value)).toThrow(failure);
  });

  it('uses the Proxy property read without enumerating or calling the answer', () => {
    const reads: { key: PropertyKey; ownTarget: boolean; ownReceiver: boolean }[] = [];
    const ownKeys = vi.fn(() => []);
    const target = {};
    const value = new Proxy(target, {
      get(actualTarget, key, receiver) {
        reads.push({ key, ownTarget: actualTarget === target, ownReceiver: receiver === value });
        return () => undefined;
      },
      ownKeys,
    });
    expect(isThenable(value)).toBe(true);
    expect(reads).toEqual([{ key: 'then', ownTarget: true, ownReceiver: true }]);
    expect(ownKeys).not.toHaveBeenCalled();
  });
});

describe('a reader answer copied as plain JSON', () => {
  it('detaches nested arrays and objects, with no references retained in either direction', () => {
    const original = { state: { count: 1 }, messages: [{ content: 'first' }] };
    const copy = plainJson(original) as typeof original;
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.state).not.toBe(original.state);
    expect(copy.messages).not.toBe(original.messages);
    expect(copy.messages[0]).not.toBe(original.messages[0]);
    original.messages[0]!.content = 'changed';
    copy.state.count = 2;
    expect(copy.messages[0]!.content).toBe('first');
    expect(original.state.count).toBe(1);
  });

  it('reads each enumerable getter once and retains only the observed data', () => {
    let reads = 0;
    const original = {
      get content() {
        return ++reads === 1 ? 'allowed' : 'changed';
      },
    };
    const copy = plainJson(original) as { content: string };
    expect(copy.content).toBe('allowed');
    expect(copy.content).toBe('allowed');
    expect(reads).toBe(1);
    expect(Object.getOwnPropertyDescriptor(copy, 'content')).toEqual({
      value: 'allowed',
      enumerable: true,
      writable: true,
      configurable: true,
    });
  });

  it('reads Proxy values once and leaves no live Proxy behind', () => {
    const keys: PropertyKey[] = [];
    let contentReads = 0;
    const original = new Proxy(
      { content: 'unused' },
      {
        get(target, key, receiver) {
          keys.push(key);
          return key === 'content'
            ? ++contentReads === 1
              ? 'first'
              : 'later'
            : Reflect.get(target, key, receiver);
        },
      },
    );
    const copy = plainJson(original) as { content: string };
    expect(copy.content).toBe('first');
    expect(copy.content).toBe('first');
    expect(contentReads).toBe(1);
    expect(keys).toEqual(['toJSON', 'content']);
  });

  it('calls toJSON with its receiver and key before reading the returned properties', () => {
    const order: string[] = [];
    const child = {
      toJSON(this: unknown, key: string) {
        expect(this).toBe(child);
        order.push(`child:${key}`);
        return {
          get content() {
            order.push('content');
            return 'read';
          },
        };
      },
    };
    const original = {
      toJSON(this: unknown, key: string) {
        expect(this).toBe(original);
        order.push(`root:${key}`);
        return { child };
      },
    };
    expect(plainJson(original)).toEqual({ child: { content: 'read' } });
    expect(order).toEqual(['root:', 'child:child', 'content']);
  });

  it('keeps an own __proto__ key as data without changing any prototype', () => {
    const original = Object.defineProperty({}, '__proto__', {
      enumerable: true,
      value: { answer: 'data' },
    });
    const copy = plainJson(original) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(copy, '__proto__')).toBe(true);
    expect(copy['__proto__']).toEqual({ answer: 'data' });
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(original)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['answer']).toBeUndefined();
  });

  it('keeps JSON scalars, normalizes negative zero, and maps non-finite numbers to null', () => {
    for (const value of [null, true, false, 0, 2.5, '', 'answer']) {
      expect(plainJson(value)).toBe(value);
    }
    expect(Object.is(plainJson(-0), 0)).toBe(true);
    for (const value of [NaN, Infinity, -Infinity]) expect(plainJson(value)).toBeNull();
  });

  it('returns undefined when JSON omits the entire answer', () => {
    for (const value of [undefined, () => undefined, Symbol('s'), { toJSON: () => undefined }]) {
      expect(plainJson(value)).toBeUndefined();
    }
  });

  it('omits unsupported object values, inherited and non-enumerable fields, and symbol keys', () => {
    const original = Object.assign(Object.create({ inherited: 1 }), {
      kept: 'yes',
      absent: undefined,
      fn: () => undefined,
      symbol: Symbol('s'),
      [Symbol('key')]: 2,
    });
    Object.defineProperty(original, 'hidden', { value: 3 });
    expect(plainJson(original)).toEqual({ kept: 'yes' });
  });

  it('writes array holes and unsupported values as null without filling the source hole', () => {
    const original: unknown[] = [undefined, undefined, () => undefined, Symbol('s'), NaN, 4];
    delete original[0];
    expect(plainJson(original)).toEqual([null, null, null, null, null, 4]);
    expect(0 in original).toBe(false);
  });

  it('uses JSON date and boxed-primitive conversion rather than retaining class instances', () => {
    expect(
      plainJson({ date: new Date('2026-01-01T00:00:00Z'), number: Object(3), bool: Object(false) }),
    ).toEqual({
      date: '2026-01-01T00:00:00.000Z',
      number: 3,
      bool: false,
    });
  });

  it('throws on cycles and BigInt instead of returning a partially copied answer', () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => plainJson(cycle)).toThrow(TypeError);
    expect(() => plainJson(1n)).toThrow(TypeError);
    expect(() => plainJson({ count: 1n })).toThrow(TypeError);
  });

  it('preserves thrown getter and toJSON failures for the caller to classify', () => {
    const failure = new Error('reader failed');
    expect(() =>
      plainJson({
        get content() {
          throw failure;
        },
      }),
    ).toThrow(failure);
    expect(() =>
      plainJson({
        toJSON() {
          throw failure;
        },
      }),
    ).toThrow(failure);
    expect(() =>
      plainJson(
        new Proxy(
          {},
          {
            ownKeys() {
              throw failure;
            },
          },
        ),
      ),
    ).toThrow(failure);
  });
});
