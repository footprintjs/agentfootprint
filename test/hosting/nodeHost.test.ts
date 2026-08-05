/**
 * nodeHost — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The host contract itself is covered by `host-contract.test.ts`, which runs
 * the shared conformance suite against this adapter and against an in-process
 * one. What is left here is what belongs to THIS adapter and to no port: its
 * paths, its JSON bodies, its status codes, its SSE framing.
 *
 * The paths get their own test because they are the part most likely to be
 * dictated by whatever sits in front of the process, and because a default that
 * quietly matched one particular runtime's container contract would be that
 * runtime leaking into a library that promises not to know about it.
 */

import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { nodeHost } from '../../src/hosting/index.js';
import type { HostHandler } from '../../src/hosting/index.js';
import { ConcurrentRunError, PauseNotCarriedError } from '../../src/hosting/index.js';

const echo: HostHandler = (request, reply) => {
  reply.complete(`echo:${request.input}`);
};

async function serving(handler: HostHandler = echo, options = {}) {
  return nodeHost({ port: 0, hostname: '127.0.0.1', ...options }).serve(handler);
}

describe('nodeHost — the routes it serves', () => {
  it('defaults to POST /invoke and GET /health', async () => {
    const handle = await serving();
    try {
      const health = await fetch(`${handle.url}/health`);
      expect(health.status).toBe(200);
      expect((await health.json()) as Record<string, unknown>).toMatchObject({ status: 'ok' });

      const invoked = await post(handle.url, '/invoke', { input: 'hi' });
      expect(invoked.status).toBe(200);
      expect(await invoked.json()).toEqual({ output: 'echo:hi' });
    } finally {
      await handle.close();
    }
  });

  it('takes both paths as options — a path is a deployment detail, not a contract', async () => {
    const handle = await serving(echo, { invokePath: '/v1/messages', healthPath: '/healthz' });
    try {
      expect((await fetch(`${handle.url}/healthz`)).status).toBe(200);
      const invoked = await post(handle.url, '/v1/messages', { input: 'custom' });
      expect(await invoked.json()).toEqual({ output: 'echo:custom' });
      // …and the defaults are gone once you name your own.
      expect((await post(handle.url, '/invoke', { input: 'x' })).status).toBe(404);
      expect((await fetch(`${handle.url}/health`)).status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it('404s an unknown route and says which one', async () => {
    const handle = await serving();
    try {
      const missing = await fetch(`${handle.url}/nope`);
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as { error: string }).error).toContain('/nope');
    } finally {
      await handle.close();
    }
  });

  it('ignores a query string when matching', async () => {
    const handle = await serving();
    try {
      expect((await fetch(`${handle.url}/health?probe=1`)).status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it('binds every interface by default, and reports a URL you can actually call', async () => {
    // '0.0.0.0' is what a container wants to bind, and what nobody can dial —
    // so the handle reports a loopback URL instead of echoing the wildcard.
    const handle = await nodeHost({ port: 0 }).serve(echo);
    try {
      expect(handle.url).toContain('127.0.0.1');
      expect((await fetch(`${handle.url}/health`)).status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it('reports the port it actually bound when asked for an ephemeral one', async () => {
    const handle = await serving();
    try {
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.url).toContain(`:${handle.port}`);
    } finally {
      await handle.close();
    }
  });
});

describe('nodeHost — a socket the caller owns', () => {
  // The machinery and its laws live in httpHost.test.ts; what is asserted here
  // is that THIS adapter passes the option through rather than quietly binding
  // a second socket — the mistake that would make the whole option a no-op.
  it('attaches its two routes to a server you already listened on', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;
    const handle = await nodeHost({ server }).serve(echo);
    try {
      expect(handle.port).toBe(port);
      expect(handle.url).toBe(base);
      expect((await fetch(`${base}/health`)).status).toBe(200);
      const invoked = await fetch(`${base}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'shared' }),
      });
      expect(await invoked.json()).toEqual({ output: 'echo:shared' });
    } finally {
      await handle.close();
      // close() left the socket alone, which is the caller's to release.
      expect(server.listening).toBe(true);
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    }
  });

  it('refuses a port beside it rather than pick which one it meant', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    try {
      expect(() => nodeHost({ server, port: 8080 })).toThrow(/both a caller-owned/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('nodeHost — what arrives at the handler', () => {
  it('takes sessionId from the body, or from a header when the body omits it', async () => {
    const seen: (string | undefined)[] = [];
    const handle = await serving((request, reply) => {
      seen.push(request.sessionId);
      reply.complete('ok');
    });
    try {
      await post(handle.url, '/invoke', { input: 'a', sessionId: 'from-body' });
      await post(handle.url, '/invoke', { input: 'b' }, { 'x-session-id': 'from-header' });
      // The body wins, so a caller that sets both is never surprised.
      await post(
        handle.url,
        '/invoke',
        { input: 'c', sessionId: 'body' },
        { 'x-session-id': 'hdr' },
      );
      await post(handle.url, '/invoke', { input: 'd' });
      expect(seen).toEqual(['from-body', 'from-header', 'body', undefined]);
    } finally {
      await handle.close();
    }
  });

  it('lower-cases header names and passes them through', async () => {
    let headers: Readonly<Record<string, string>> | undefined;
    const handle = await serving((request, reply) => {
      headers = request.headers;
      reply.complete('ok');
    });
    try {
      await post(handle.url, '/invoke', { input: 'a' }, { 'X-Mixed-Case': 'kept' });
      expect(headers?.['x-mixed-case']).toBe('kept');
    } finally {
      await handle.close();
    }
  });

  it('aborts the request signal when the caller hangs up', async () => {
    const reached = deferred();
    let aborted: Promise<void> | undefined;
    const handle = await serving(async (request, reply) => {
      aborted = new Promise<void>((resolve) => {
        request.signal?.addEventListener('abort', () => resolve());
      });
      reached.resolve();
      // Park long enough for the caller to give up on us.
      await new Promise((r) => setTimeout(r, 300));
      reply.complete('too late anyway');
    });
    try {
      const caller = new AbortController();
      const inFlight = fetch(`${handle.url}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'hello' }),
        signal: caller.signal,
      });
      await reached.promise;
      caller.abort();
      await expect(inFlight).rejects.toThrow();
      await expect(aborted).resolves.toBeUndefined();
    } finally {
      await handle.close();
    }
  });

  it('treats a non-string input as empty rather than crashing', async () => {
    const handle = await serving();
    try {
      const reply = await post(handle.url, '/invoke', { input: { not: 'a string' } });
      expect(await reply.json()).toEqual({ output: 'echo:' });
    } finally {
      await handle.close();
    }
  });

  it('400s a body that is not JSON, naming the problem', async () => {
    const handle = await serving();
    try {
      const reply = await fetch(`${handle.url}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json at all',
      });
      expect(reply.status).toBe(400);
      expect(((await reply.json()) as { error: string }).error).toContain('invalid JSON body');
    } finally {
      await handle.close();
    }
  });

  it('accepts an empty body as an empty input', async () => {
    const handle = await serving();
    try {
      const reply = await fetch(`${handle.url}/invoke`, { method: 'POST' });
      expect(await reply.json()).toEqual({ output: 'echo:' });
    } finally {
      await handle.close();
    }
  });
});

describe('nodeHost — status codes say what kind of "no" this is', () => {
  it('a refusal is never a 5xx: a concurrent turn is a 409', async () => {
    const handle = await serving((_request, reply) => {
      reply.fail(new ConcurrentRunError('busy', 'run-7'));
    });
    try {
      const reply = await post(handle.url, '/invoke', { input: 'a' });
      expect(reply.status).toBe(409);
      expect((await reply.json()) as { code: string }).toMatchObject({
        code: 'ERR_CONCURRENT_RUN',
      });
    } finally {
      await handle.close();
    }
  });

  it('a pause is a 409 too — unfinished work, not a broken agent', async () => {
    const handle = await serving((_request, reply) => {
      reply.fail(new PauseNotCarriedError('approve_refund', 's-1'));
    });
    try {
      const reply = await post(handle.url, '/invoke', { input: 'a' });
      expect(reply.status).toBe(409);
      const body = (await reply.json()) as { error: string; code: string };
      expect(body.code).toBe('ERR_PAUSE_NOT_CARRIED');
      expect(body.error).toContain('did not fail');
    } finally {
      await handle.close();
    }
  });

  it('an ordinary failure is a 500', async () => {
    const handle = await serving((_request, reply) => {
      reply.fail(new Error('something broke'));
    });
    try {
      const reply = await post(handle.url, '/invoke', { input: 'a' });
      expect(reply.status).toBe(500);
      expect(await reply.json()).toEqual({ error: 'something broke' });
    } finally {
      await handle.close();
    }
  });

  it('an unknown error code is still a 500, not a guess', async () => {
    const handle = await serving((_request, reply) => {
      const err = Object.assign(new Error('novel'), { code: 'ERR_SOMETHING_NEW' });
      reply.fail(err);
    });
    try {
      expect((await post(handle.url, '/invoke', { input: 'a' })).status).toBe(500);
    } finally {
      await handle.close();
    }
  });

  it('a closed host answers 503', async () => {
    const gate = deferred();
    const handle = await serving(async (_request, reply) => {
      await gate.promise;
      reply.complete('done');
    });
    const inFlight = post(handle.url, '/invoke', { input: 'slow' });
    await new Promise((r) => setTimeout(r, 20));
    const closing = handle.close();
    const refused = await post(handle.url, '/invoke', { input: 'late' });
    expect(refused.status).toBe(503);
    expect((await refused.json()) as { code: string }).toMatchObject({ code: 'ERR_HOST_CLOSED' });
    gate.resolve();
    await closing;
    expect(await (await inFlight).json()).toEqual({ output: 'done' });
  });
});

describe('nodeHost — streaming is the caller’s choice', () => {
  const streamer: HostHandler = (request, reply) => {
    reply.emit?.('one ');
    reply.emit?.('two');
    reply.complete(`final:${request.input}`);
  };

  it('declares the capabilities it actually has', () => {
    // Both, and both honoured: SSE when the caller asks for it, and a
    // conversation door on a path this adapter chose. A name is in this list
    // only when the shipped adapter can keep the promise with nothing installed.
    expect(nodeHost().capabilities).toEqual(['streaming', 'conversation']);
  });

  it('sends Server-Sent Events when the caller asks for them', async () => {
    const handle = await serving(streamer);
    try {
      const reply = await post(
        handle.url,
        '/invoke',
        { input: 'x' },
        { accept: 'text/event-stream' },
      );
      expect(reply.headers.get('content-type')).toContain('text/event-stream');
      const body = await reply.text();
      expect(body).toContain('event: chunk');
      expect(body).toContain('"text":"one "');
      expect(body).toContain('event: complete');
      expect(body).toContain('"output":"final:x"');
    } finally {
      await handle.close();
    }
  });

  it('sends one JSON body when the caller does not — same answer, no duplication', async () => {
    const handle = await serving(streamer);
    try {
      const reply = await post(handle.url, '/invoke', { input: 'x' });
      // The chunks were a preview of this text; they are settled by the
      // completion, never delivered alongside it.
      expect(await reply.json()).toEqual({ output: 'final:x' });
    } finally {
      await handle.close();
    }
  });

  it('reports a failure on the event stream too', async () => {
    const handle = await serving((_request, reply) => reply.fail(new Error('stream broke')));
    try {
      const reply = await post(
        handle.url,
        '/invoke',
        { input: 'x' },
        { accept: 'text/event-stream' },
      );
      const body = await reply.text();
      expect(body).toContain('event: error');
      expect(body).toContain('stream broke');
    } finally {
      await handle.close();
    }
  });

  it('ignores a second answer instead of corrupting the wire', async () => {
    const handle = await serving((_request, reply) => {
      reply.complete('first');
      reply.complete('second');
      reply.fail(new Error('and a failure for good measure'));
      reply.emit?.('and a chunk');
    });
    try {
      expect(await (await post(handle.url, '/invoke', { input: 'x' })).json()).toEqual({
        output: 'first',
      });
    } finally {
      await handle.close();
    }
  });
});

// ─── helpers ─────────────────────────────────────────────────────────

function post(
  base: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
