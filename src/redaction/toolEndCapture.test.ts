import { describe, expect, it, vi } from 'vitest';
import { toWireJson } from '../lib/wireJson.js';
import { prepareToolEndCapture } from './toolEndCapture.js';

describe('tool-end capture', () => {
  it('keeps the wire shape and private input when a plain result carries callables', () => {
    const callback = vi.fn();
    const shared = { content: 'fixture', callback };
    const payload = { toolCallId: 'call', result: [shared, shared, callback], durationMs: 10 };

    const captured = prepareToolEndCapture(payload) as typeof payload;
    expect(captured.result[0]).toBe(captured.result[1]);
    expect(Object.hasOwn(captured, 'modelResult')).toBe(false);
    expect(structuredClone(captured).result[0]).toEqual({ content: 'fixture' });
    expect(toWireJson(captured)).toBe(toWireJson(payload));
    expect(payload.result[0]).toBe(shared);
    expect(shared.callback).toBe(callback);
    expect(callback).not.toHaveBeenCalled();
  });

  it('leaves native values, opaque results and wholly plain data with their original owners', () => {
    const read = vi.fn();
    const accessor = Object.defineProperty({}, 'private', { get: read, enumerable: true });
    const custom = { toJSON: read };
    const decoratedArray = Object.defineProperty([read, read], '0', {
      get: read,
      enumerable: false,
    });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const data = [
      new Map(),
      new Set(),
      new Uint8Array(),
      new Error(),
      accessor,
      custom,
      decoratedArray,
      cyclic,
      { plain: true },
    ];

    for (const result of data) {
      const payload = { result, modelResult: result };
      expect(prepareToolEndCapture(payload)).toBe(payload);
    }
    expect(read).not.toHaveBeenCalled();
  });
});
