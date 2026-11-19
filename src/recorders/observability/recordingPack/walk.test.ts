import { describe, expect, it, vi } from 'vitest';

import { toWireJson } from '../../../lib/wireJson.js';
import { normalize, reader, SKIP } from './walk.js';

const normalized = (value: unknown): unknown => normalize({ value }, 'value', value);

describe('the value JSON and the wire rule read', () => {
  it('retains JSON primitives and maps non-finite numbers to null', () => {
    for (const value of [null, true, false, '', 'text', 42, -0]) {
      expect(normalized(value)).toBe(value);
    }
    for (const value of [NaN, Infinity, -Infinity]) expect(normalized(value)).toBeNull();
  });

  it('returns the single SKIP identity for every value JSON omits', () => {
    for (const value of [undefined, () => 1, Symbol('not data')]) {
      expect(normalized(value)).toBe(SKIP);
    }
  });

  it('reads toJSON once and calls it with the value as receiver and the member key', () => {
    const calls: string[] = [];
    const value = Object.defineProperty({}, 'toJSON', {
      get() {
        calls.push('lookup');
        return function (this: unknown, key: string) {
          expect(this).toBe(value);
          expect(key).toBe('named');
          calls.push('call');
          return 7;
        };
      },
    });
    expect(normalize({ named: value }, 'named', value)).toBe(7);
    expect(calls).toEqual(['lookup', 'call']);
  });

  it('also honors toJSON on a function', () => {
    const fn = Object.assign(() => 0, {
      toJSON(this: unknown, key: string) {
        expect(this).toBe(fn);
        expect(key).toBe('value');
        return 'function value';
      },
    });
    expect(normalized(fn)).toBe('function value');
  });

  it('applies the wire rule after an Error toJSON returns custom properties', () => {
    const toJSON = vi.fn(() => ({
      privateField: 'not for the record',
      stack: 'not for the record',
    }));
    const error = Object.assign(new Error('request failed'), { code: 'E_REQUEST', toJSON });
    const holder = { failure: error };
    const result = normalize(holder, 'failure', error);
    expect(toJSON).toHaveBeenCalledOnce();
    expect(toJSON).toHaveBeenCalledWith('failure');
    expect(result).toEqual({ name: 'Error', message: 'request failed', code: 'E_REQUEST' });
    expect(JSON.stringify({ failure: result })).toBe(toWireJson(holder));
  });

  it('renders an Error returned by an ordinary object toJSON', () => {
    const error = Object.assign(new Error('converted failure'), { privateField: 'discard me' });
    const value = { toJSON: () => error };
    expect(normalized(value)).toEqual({ name: 'Error', message: 'converted failure' });
  });

  it('does not call toJSON again on the value returned by toJSON', () => {
    const again = vi.fn(() => 'would be a second conversion');
    const returned = { kept: true, toJSON: again };
    expect(normalized({ toJSON: () => returned })).toBe(returned);
    expect(again).not.toHaveBeenCalled();
  });

  it('reads genuine number, string and boolean boxes as their primitive values', () => {
    expect(normalized(new Number(3))).toBe(3);
    expect(normalized(new String('boxed'))).toBe('boxed');
    expect(normalized(new Boolean(false))).toBe(false);
    expect(normalized(new Number(Infinity))).toBeNull();
  });

  it('keeps a Number.prototype lookalike as an object without a numeric slot', () => {
    const lookalike = Object.assign(Object.create(Number.prototype) as object, { kept: 1 });
    expect(normalized(lookalike)).toBe(lookalike);
    expect(JSON.stringify(normalized(lookalike))).toBe(toWireJson(lookalike));
  });

  it('a boolean box retains its internal slot with a null prototype', () => {
    const value = Object.setPrototypeOf(new Boolean(true), null) as object;
    expect(normalized(value)).toBe(true);
  });

  it('a number box with a null prototype fails conversion just as JSON does', () => {
    const value = Object.setPrototypeOf(new Number(3), null) as object;
    expect(() => JSON.stringify(value)).toThrow(TypeError);
    expect(() => normalized(value)).toThrow(TypeError);
  });

  it('refuses a primitive or boxed BigInt with the existing error', () => {
    for (const value of [1n, Object(1n)]) {
      expect(() => normalized(value)).toThrow(TypeError);
      expect(() => normalized(value)).toThrow('a BigInt value cannot be serialized to JSON');
    }
  });

  it('keeps ordinary objects by reference without invoking their conversion methods', () => {
    const valueOf = vi.fn(() => 4);
    const value = { kept: true, valueOf };
    expect(normalized(value)).toBe(value);
    expect(valueOf).not.toHaveBeenCalled();
  });
});

describe('members and measured work', () => {
  it('keeps one SKIP per array hole or omitted value, counts every position and does not fill the input holes', () => {
    const input: unknown[] = [1];
    input.length = 6;
    input[2] = undefined;
    input[3] = () => 1;
    input[4] = Symbol('not data');
    input[5] = NaN;
    const work = { members: 2 };
    const members = reader(work).array(input);
    expect(members).toEqual([1, SKIP, SKIP, SKIP, SKIP, null]);
    expect(Object.hasOwn(members, 1)).toBe(true);
    expect(Object.hasOwn(input, 1)).toBe(false);
    expect(work.members).toBe(8);
    expect(JSON.stringify(members)).toBe(toWireJson(input));
  });

  it('omits SKIP object members but counts all visited keys, including omitted ones', () => {
    const input = { kept: 1, absent: undefined, fn: () => 1, symbol: Symbol('not data') };
    const work = { members: 7 };
    expect(reader(work).object(input)).toEqual([['kept', 1]]);
    expect(work.members).toBe(11);
    expect(Object.keys(input)).toEqual(['kept', 'absent', 'fn', 'symbol']);
  });

  it('uses own enumerable string-key order without inherited, non-enumerable or symbol keys', () => {
    const input = Object.assign(Object.create({ inherited: 1 }) as object, {
      10: 'ten',
      2: 'two',
      b: 'bee',
      a: 'aye',
      [Symbol('not a string key')]: 5,
    });
    Object.defineProperty(input, 'hidden', { value: 6 });
    const work = { members: 0 };
    expect(reader(work).object(input)).toEqual([
      ['2', 'two'],
      ['10', 'ten'],
      ['b', 'bee'],
      ['a', 'aye'],
    ]);
    expect(work.members).toBe(4);
  });

  it('reads primitive getters once, object getters twice, and primitive-returning toJSON getters once', () => {
    const held = { kept: true };
    const primitive = vi.fn(() => 1);
    const object = vi.fn(() => held);
    const converted = vi.fn(() => ({ toJSON: () => 'converted' }));
    const input = Object.defineProperties(
      {},
      {
        primitive: { enumerable: true, get: primitive },
        object: { enumerable: true, get: object },
        converted: { enumerable: true, get: converted },
      },
    );
    const work = { members: 0 };
    expect(reader(work).object(input)).toEqual([
      ['primitive', 1],
      ['object', held],
      ['converted', 'converted'],
    ]);
    expect(primitive).toHaveBeenCalledTimes(1);
    expect(object).toHaveBeenCalledTimes(2);
    expect(converted).toHaveBeenCalledTimes(1);
    expect(work.members).toBe(3);
  });

  it('array accessors use the same wire getter rule and retain object references', () => {
    const held = { kept: true };
    const object = vi.fn(() => held);
    const primitive = vi.fn(() => 2);
    const input = Object.defineProperties([], {
      0: { enumerable: true, get: object },
      1: { enumerable: true, get: primitive },
    });
    const work = { members: 0 };
    const members = reader(work).array(input);
    expect(members).toEqual([held, 2]);
    expect(members[0]).toBe(held);
    expect(object).toHaveBeenCalledTimes(2);
    expect(primitive).toHaveBeenCalledTimes(1);
    expect(work.members).toBe(2);
  });

  it('propagates a member getter failure without adding a completed object count', () => {
    const failure = new Error('getter failed');
    const getter = vi.fn(() => {
      throw failure;
    });
    const input = Object.defineProperty({ earlier: 1 }, 'later', { enumerable: true, get: getter });
    const work = { members: 9 };
    expect(() => reader(work).object(input)).toThrow(failure);
    expect(getter).toHaveBeenCalledTimes(1);
    expect(work.members).toBe(9);
  });

  it('propagates toJSON failure without adding a completed array count', () => {
    const failure = new Error('toJSON failed');
    const toJSON = vi.fn(() => {
      throw failure;
    });
    const work = { members: 9 };
    expect(() => reader(work).array([1, { toJSON }])).toThrow(failure);
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(work.members).toBe(9);
  });

  it('the optional work counter changes no returned member values', () => {
    const input = { first: 1, absent: undefined, last: null };
    expect(reader(undefined).object(input)).toEqual([
      ['first', 1],
      ['last', null],
    ]);
    expect(reader(undefined).array([1, undefined])).toEqual([1, SKIP]);
  });
});
