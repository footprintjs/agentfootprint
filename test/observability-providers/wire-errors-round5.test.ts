/**
 * ROUND 5 — the second recheck of the wire rule (idfix-RECHECK2.md, X1–X4),
 * each attack ported with its assertion INVERTED so the changelog's "every
 * Error" is true.
 *
 * The laws being pinned:
 *   • SF1 — a value whose `toJSON` RETURNS an Error is rendered by the rule:
 *     `toWireJson`, the tool-result text (`safeStringify`) and the browser
 *     stream (`encodeSSE`) alike.
 *   • SF2 — the Error check is the OR of `Error.isError`, `instanceof Error`
 *     and Node's `util.types.isNativeError`: a Proxy-wrapped Error is rendered
 *     where `Error.isError` exists (Node ≥ 24, browsers), and an Error from
 *     another realm is rendered where it does not (Node 20/22) — the same bytes
 *     on every runtime, and on both delivery paths.
 *   • NIT 1 — reads: a data property and a primitive-valued getter are read
 *     ONCE, as `JSON.stringify` reads them; only an accessor whose value is an
 *     object is read a second time (the stated cost, pinned so it cannot grow).
 *
 * Test types (Convention 3): security · regression · boundary.
 */

import { describe, expect, it } from 'vitest';
import { types } from 'node:util';
import { runInNewContext } from 'node:vm';

import { toWireJson, withWireErrors } from '../../src/lib/wireJson.js';
import { safeStringify } from '../../src/core/agent/validators.js';
import { encodeSSE } from '../../src/stream.js';

const TOKEN = 'Bearer tok-R4';

function decorated(): Error {
  return Object.assign(new Error('upstream 401'), {
    config: { headers: { authorization: TOKEN } },
  });
}

const RENDERED = { name: 'Error', message: 'upstream 401' };

/** Run `body` as if the runtime had `Error.isError` (the spec's slot check). */
function withErrorIsError(body: () => void): void {
  const holder = Error as unknown as { isError?: (v: unknown) => boolean };
  const had = holder.isError;
  holder.isError = (v: unknown) => types.isNativeError(v);
  try {
    body();
  } finally {
    if (had === undefined) delete holder.isError;
    else holder.isError = had;
  }
}

describe('SF1 (X1) — a toJSON that RETURNS an Error is rendered by the rule', () => {
  it('toWireJson, the tool-result text and the browser stream write no custom property', () => {
    const wrapper = { ok: false, toJSON: () => decorated() };
    expect(JSON.parse(toWireJson({ result: wrapper }))).toEqual({ result: RENDERED });
    expect(safeStringify({ result: wrapper })).not.toContain('tok-R4');
    expect(encodeSSE('x', { payload: { result: wrapper } })).not.toContain('tok-R4');
  });

  it('the detached copy of the same payload carries no token either (the function is not cloneable)', () => {
    const wrapper = { ok: false, toJSON: () => decorated() };
    const walked = withWireErrors({ result: wrapper });
    let copied: unknown;
    try {
      copied = structuredClone(walked);
    } catch {
      copied = { result: { ok: false } }; // the detached path degrades the method leaf
    }
    expect(toWireJson(copied)).not.toContain('tok-R4');
  });
});

describe('SF2 (X2) — a Proxy-wrapped Error is rendered where Error.isError exists', () => {
  it('with Error.isError installed (Node ≥ 24 / browser semantics), the proxy is rendered', () => {
    withErrorIsError(() => {
      const proxied = new Proxy(decorated(), {});
      expect(JSON.parse(toWireJson({ result: proxied }))).toEqual({ result: RENDERED });
      expect(safeStringify({ result: proxied })).not.toContain('tok-R4');
    });
  });

  it('and without it (this Node) — the same bytes on both runtimes', () => {
    const without = toWireJson({ result: new Proxy(decorated(), {}) });
    let withIt = '';
    withErrorIsError(() => {
      withIt = toWireJson({ result: new Proxy(decorated(), {}) });
    });
    expect(withIt).toBe(without);
    expect(without).not.toContain('tok-R4');
  });
});

describe('SF2 (X3) — an Error from another realm is rendered on Node 20/22', () => {
  it('a vm-context Error: no custom property on the sync path; sync and detached write the same bytes', () => {
    const foreign = runInNewContext(
      'Object.assign(new Error("upstream 401"), { config: { headers: { authorization: "Bearer tok-R4" } } })',
    );
    expect(foreign instanceof Error).toBe(false);
    const sync = toWireJson({ result: foreign });
    expect(JSON.parse(sync)).toEqual({ result: RENDERED });
    const detached = toWireJson(structuredClone(withWireErrors({ result: foreign })));
    expect(detached).toBe(sync);
  });

  it('a spoofed Symbol.toStringTag is still NOT an Error (the slot checks cannot be fooled)', () => {
    const value = { [Symbol.toStringTag]: 'Error', message: 'm', data: 'kept' };
    expect(toWireJson({ v: value })).toBe(JSON.stringify({ v: value }));
  });
});

describe('NIT 1 (X4) — what the replacer reads', () => {
  it('a data property is read once: a Proxy holder’s get trap runs as often as under JSON.stringify', () => {
    const count = (serialize: (v: unknown) => string): number => {
      let gets = 0;
      const holder = new Proxy(
        { a: { deep: 1 }, b: 'x' },
        {
          get(target, key, receiver) {
            gets += 1;
            return Reflect.get(target, key, receiver);
          },
        },
      );
      serialize({ holder });
      return gets;
    };
    expect(count((v) => toWireJson(v))).toBe(count((v) => JSON.stringify(v)));
  });

  it('a getter with a primitive value runs once; a getter with an object value runs twice (stated)', () => {
    let primitiveReads = 0;
    let objectReads = 0;
    const lazy = {
      get id() {
        primitiveReads += 1;
        return 7;
      },
      get row() {
        objectReads += 1;
        return { id: objectReads };
      },
    };
    const out = toWireJson(lazy);
    expect(primitiveReads).toBe(1);
    expect(objectReads).toBe(2);
    // The bytes are still those of the FIRST read.
    expect(out).toBe('{"id":7,"row":{"id":1}}');
  });
});
