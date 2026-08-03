/**
 * httpHost — one HTTP implementation, many dialects.
 *
 * `nodeHost` and `agentCoreRuntimeHost` are both configurations of this file,
 * and their own suites cover what each one says on the wire. What is asserted
 * HERE is the seam: that a wire really does get to re-decide the five body
 * shapes and nothing else, that both paths are required rather than defaulted
 * (a default here would be inherited by every future adapter), and that
 * `headerValue` is genuinely case-insensitive — the helper that exists so no
 * adapter re-derives header matching and gets it subtly wrong.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { headerValue, httpHost, jsonWire } from '../../src/hosting/index.js';
import type { HostHandle, HttpHostHandle, HttpWire } from '../../src/hosting/index.js';

const open: HostHandle[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((h) => h.close()));
});

/** A deliberately eccentric dialect — nothing about it resembles the default. */
const oddWire: HttpWire = {
  readRequest: (facts) => {
    const say = facts.body.say;
    const sessionId = facts.query.get('thread') ?? facts.headers['x-thread'];
    return {
      input: typeof say === 'string' ? say : '',
      ...(sessionId !== null && sessionId !== undefined && { sessionId }),
    };
  },
  health: (uptimeMs) => ({ alive: true, ms: uptimeMs }),
  output: (said) => ({ said }),
  failure: (broke, code) => ({ broke, ...(code !== undefined && { code }) }),
  chunk: (bit) => ({ bit }),
};

async function serveOdd(handler = defaultHandler, paths = {}): Promise<string> {
  const handle = (await httpHost({
    name: 'oddHost',
    wire: oddWire,
    invokePath: '/say',
    healthPath: '/alive',
    port: 0,
    hostname: '127.0.0.1',
    ...paths,
  }).serve(handler)) as HttpHostHandle;
  open.push(handle);
  return handle.url;
}

const defaultHandler = (
  request: { input: string; sessionId?: string },
  reply: { complete(v: string): void },
): void => reply.complete(`${request.input}/${request.sessionId ?? 'none'}`);

// ── unit: the seam ──────────────────────────────────────────────────

describe('httpHost — the seam', () => {
  it('takes its name from the adapter, so refusals name the adapter', () => {
    const host = httpHost({
      name: 'oddHost',
      wire: oddWire,
      invokePath: '/say',
      healthPath: '/alive',
    });
    expect(host.name).toBe('oddHost');
  });

  it('lets an adapter declare fewer capabilities than the default', () => {
    const host = httpHost({
      name: 'quiet',
      wire: oddWire,
      invokePath: '/x',
      healthPath: '/y',
      capabilities: [],
    });
    expect(host.capabilities).toEqual([]);
  });

  it('exports the default dialect by name, so it can be reused rather than retyped', () => {
    expect(jsonWire.output('hi')).toEqual({ output: 'hi' });
    expect(jsonWire.health(5)).toMatchObject({ status: 'ok' });
  });
});

// ── scenario: the wire really does own the bodies ───────────────────

describe('httpHost — a custom dialect', () => {
  it('reads the input from whatever field the wire says', async () => {
    const base = await serveOdd();
    const res = await fetch(`${base}/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ say: 'hello' }),
    });
    expect(await res.json()).toEqual({ said: 'hello/none' });
  });

  it('answers the health path in the wire’s own shape', async () => {
    const base = await serveOdd();
    const body = (await (await fetch(`${base}/alive`)).json()) as { alive: boolean; ms: number };
    expect(body.alive).toBe(true);
    expect(typeof body.ms).toBe('number');
  });

  it('can take the session id from the QUERY STRING, which the default never does', async () => {
    // Proof the facts a wire receives are complete: body, headers AND query.
    const base = await serveOdd();
    const res = await fetch(`${base}/say?thread=q-1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ say: 'hi' }),
    });
    expect(await res.json()).toEqual({ said: 'hi/q-1' });
  });

  it('routes only the paths it was given — the default paths are not smuggled in', async () => {
    const base = await serveOdd();
    expect((await fetch(`${base}/health`)).status).toBe(404);
    expect((await fetch(`${base}/invoke`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('the query string never leaks into path matching', async () => {
    const base = await serveOdd();
    expect((await fetch(`${base}/alive?probe=1`)).status).toBe(200);
  });

  it('failures use the wire’s error shape, keeping the refusal code', async () => {
    const base = await serveOdd(() => {
      throw new Error('nope');
    });
    const res = await fetch(`${base}/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ say: 'x' }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ broke: 'nope' });
  });

  it('streams with the wire’s chunk shape when the caller asks', async () => {
    const base = await serveOdd((_request, reply) => {
      (reply as { emit?(c: string): void }).emit?.('piece');
      reply.complete('whole');
    });
    const body = await (
      await fetch(`${base}/say`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ say: 'x' }),
      })
    ).text();
    expect(body).toContain('"bit":"piece"');
    expect(body).toContain('"said":"whole"');
  });
});

// ── unit: headerValue, the helper adapters share ────────────────────

describe('headerValue', () => {
  const facts = {
    body: {},
    headers: { 'x-thread': 'abc', 'x-empty': '' },
    query: new URLSearchParams(),
  };

  it('finds a header whatever case you ask in', () => {
    for (const name of ['x-thread', 'X-Thread', 'X-THREAD', 'x-ThReAd']) {
      expect(headerValue(facts, name)).toBe('abc');
    }
  });

  it('treats an empty value as absent, not as an empty answer', () => {
    expect(headerValue(facts, 'x-empty')).toBeUndefined();
  });

  it('falls back through alternative spellings in order', () => {
    expect(headerValue(facts, 'x-missing', 'x-also-missing', 'x-thread')).toBe('abc');
  });

  it('returns undefined when nothing matches', () => {
    expect(headerValue(facts, 'x-nope')).toBeUndefined();
  });
});
