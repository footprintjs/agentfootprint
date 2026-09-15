import { describe, expect, it, vi } from 'vitest';
import { measureRequest } from '../../../src/lib/time-travel/requestMeasurement.js';

const size = (value: unknown) => {
  const json = JSON.stringify(value);
  return { jsonChars: json.length, jsonBytes: Buffer.byteLength(json, 'utf8') };
};

describe('initial prepared request measurements', () => {
  it('counts full schemas, Unicode, request-only messages and knobs without retaining content', () => {
    const request = {
      model: 'mock',
      systemPrompt: 'Private café 🧭',
      messages: [{ role: 'user', content: '查找\n"quoted"' }],
      tools: [
        { name: 'lookup', description: 'Find', inputSchema: { enum: ['秘密'.repeat(1000)] } },
      ],
      maxTokens: 123,
    };
    const before = structuredClone(request);
    const result = measureRequest(request);
    expect(result).toEqual({
      boundary: 'initial-prepared-request',
      format: 'json-utf8-v1',
      status: 'measured',
      total: size(request),
      slots: {
        systemPrompt: size(request.systemPrompt),
        messages: size(request.messages),
        tools: size(request.tools),
      },
    });
    expect(request).toEqual(before);
    expect(JSON.stringify(result)).not.toMatch(/Private|lookup|秘密|查找/);
  });

  it('excludes only the root transport signal and distinguishes absent from empty slots', () => {
    const signal = vi.fn(() => {
      throw new Error('signal must not be read');
    });
    const request = { model: 'm', messages: [], tools: undefined };
    Object.defineProperty(request, 'signal', { enumerable: true, get: signal });
    expect(measureRequest(request)).toMatchObject({
      status: 'measured',
      total: size({ model: 'm', messages: [] }),
      slots: { messages: size([]) },
    });
    expect(signal).not.toHaveBeenCalled();
    expect(measureRequest({ model: 'm', messages: [], tools: [] })).toMatchObject({
      slots: { tools: size([]) },
    });
  });

  it('uses JSON semantics for sparse arrays, undefined, non-finite numbers and shared values', () => {
    const shared = { id: 'same' };
    const messages = [shared, shared, undefined, undefined, null, NaN, Infinity, -0];
    delete messages[2];
    const request = {
      messages,
      omitted: undefined,
    };
    expect(measureRequest(request)).toMatchObject({ status: 'measured', total: size(request) });
  });

  it('preserves own __proto__ keys, null prototypes and nested signal data', () => {
    const request = Object.assign(Object.create(null), {
      messages: [],
      tools: [JSON.parse('{"__proto__":{"x":1},"signal":"payload"}')],
    });
    expect(measureRequest(request)).toMatchObject({ status: 'measured', total: size(request) });
  });

  it('reports cycles without throwing and does not mistake shared values for cycles', () => {
    const request: Record<string, unknown> = { messages: [] };
    request.self = request;
    expect(measureRequest(request)).toEqual({
      boundary: 'initial-prepared-request',
      format: 'json-utf8-v1',
      status: 'unavailable',
      reason: 'cyclic-value',
    });
  });

  it.each([1n, () => 1, Symbol('private'), new Date(), new Map(), /x/])(
    'declines unsupported values without including their contents (%s)',
    (value) => {
      expect(measureRequest({ messages: [value] })).toMatchObject({
        status: 'unavailable',
        reason: 'unsupported-value',
      });
    },
  );

  it('does not invoke custom accessors or toJSON', () => {
    const getter = vi.fn(() => 'private');
    const toJSON = vi.fn(() => 'private');
    const access = Object.defineProperty({}, 'content', { enumerable: true, get: getter });
    for (const value of [
      access,
      { toJSON },
      Object.create({ toJSON }),
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('private error text');
          },
        },
      ),
    ]) {
      const result = measureRequest({ messages: [value] });
      expect(result).toMatchObject({ status: 'unavailable', reason: 'unsupported-value' });
      expect(JSON.stringify(result)).not.toContain('private');
    }
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it.each([null, [], 'not a request', undefined])('declines malformed roots (%s)', (request) => {
    expect(measureRequest(request)).toMatchObject({
      status: 'unavailable',
      reason: 'unsupported-value',
    });
  });

  it('bounds measurement work for sparse, deep, string-heavy and alias-expanded data', () => {
    let deep: unknown = {};
    for (let i = 0; i < 70; i++) deep = { child: deep };
    let shared: unknown = { value: 1 };
    for (let i = 0; i < 18; i++) shared = [shared, shared];
    for (const messages of [
      new Array(100_001),
      deep,
      'a'.repeat(4_000_001),
      '\u0000'.repeat(700_000),
      shared,
    ]) {
      expect(measureRequest({ messages })).toMatchObject({
        status: 'unavailable',
        reason: 'measurement-limit',
      });
    }
  });

  it('declines inherited array indices without invoking them or miscounting holes', () => {
    const getter = vi.fn(() => 'inherited');
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, '42');
    let result;
    try {
      Object.defineProperty(Array.prototype, '42', { configurable: true, get: getter });
      result = measureRequest({ messages: new Array(50) });
    } finally {
      if (previous) Object.defineProperty(Array.prototype, '42', previous);
      else Reflect.deleteProperty(Array.prototype, '42');
    }
    expect(result).toMatchObject({ status: 'unavailable', reason: 'unsupported-value' });
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not count an inherited value as a null array hole', () => {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, '42');
    let result;
    try {
      Object.defineProperty(Object.prototype, '42', { configurable: true, value: 'inherited' });
      result = measureRequest({ messages: new Array(50) });
    } finally {
      if (previous) Object.defineProperty(Object.prototype, '42', previous);
      else Reflect.deleteProperty(Object.prototype, '42');
    }
    expect(result).toMatchObject({ status: 'unavailable', reason: 'unsupported-value' });
  });

  it('declines a wide object before materializing all its property descriptors', () => {
    let fieldReads = 0;
    const wide = new Proxy(
      {},
      {
        ownKeys: () => Array.from({ length: 100_001 }, (_, i) => `field${i}`),
        getOwnPropertyDescriptor: (_target, key) => {
          if (key === 'toJSON') return undefined;
          fieldReads++;
          return { value: 0, enumerable: true, configurable: true };
        },
      },
    );
    expect(measureRequest({ tools: [wide] })).toMatchObject({
      status: 'unavailable',
      reason: 'measurement-limit',
    });
    expect(fieldReads).toBe(0);
  });

  it('declines array element accessors without treating them as empty values', () => {
    const getter = vi.fn(() => 'private');
    const messages: unknown[] = [];
    Object.defineProperty(messages, '0', { enumerable: true, get: getter });
    expect(measureRequest({ messages })).toMatchObject({
      status: 'unavailable',
      reason: 'unsupported-value',
    });
    expect(getter).not.toHaveBeenCalled();
  });
});
