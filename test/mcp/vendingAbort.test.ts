/**
 * The vending fetch honours the request's abort signal (L-43).
 *
 * `gatewayTransport` vends a credential inside every request's `fetch`. That
 * vend is a wait like any other, and it used to be a deaf one: the provider was
 * asked with no signal, and nothing looked at the signal once the credential
 * came back. So a stalled provider stayed pending after the call was aborted,
 * and a credential that arrived after a timeout could still SEND the request.
 *
 * The law these tests pin (`lib/abort.ts`):
 *
 *   1. the provider is handed the request's signal (`CredentialRequest.signal`),
 *      so one that honours it stops;
 *   2. the wait for the credential ends at the abort, with the abort, so one
 *      that ignores it cannot hold the request open;
 *   3. the signal is checked again after the credential arrives, before the
 *      request is handed on: an aborted request is never sent, however late
 *      the credential;
 *   4. with no abort, the request is vended and sent exactly as before.
 *
 * Unit tests drive `createVendingFetch` directly; the scenario tests drive the
 * real `mcpClient` path, where the call's cancellation and the retry series'
 * deadline reach the vending fetch as the request's signal.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../src/index.js';
import {
  createVendingFetch,
  gatewayTransport,
  type FetchLike,
} from '../../src/mcp/gatewayTransport.js';
import { mcpClient } from '../../src/tool-providers/index.js';
import { bearer } from '../../src/identity/kinds.js';
import { withCredentialRetry } from '../../src/identity/withCredentialRetry.js';
import type {
  CredentialProvider,
  CredentialRequest,
  CredentialResult,
} from '../../src/identity/types.js';

const SECRET = 'sk-vend-abort-secret-0987654321';
const URL_ = 'https://gw.example.test/mcp';
const ISSUED: CredentialResult = { status: 'issued', credential: bearer(SECRET) };

afterEach(() => vi.restoreAllMocks());

// ─── Stand-ins ────────────────────────────────────────────────────

/**
 * A provider whose vends wait until the test releases them — or forever. With
 * `honours`, a vend also listens to its request's signal and stops there, the
 * way a provider that passes the signal to its own fetch does.
 */
function heldProvider(honours = false) {
  const asked: CredentialRequest[] = [];
  const waiting: Array<(result: CredentialResult) => void> = [];
  let stopped = 0;
  const provider: CredentialProvider = {
    id: 'held',
    getCredential(req) {
      asked.push(req);
      return new Promise<CredentialResult>((resolve, reject) => {
        waiting.push(resolve);
        const signal = req.signal;
        if (honours && signal !== undefined) {
          signal.addEventListener(
            'abort',
            () => {
              stopped += 1;
              reject(signal.reason);
            },
            { once: true },
          );
        }
      });
    },
  };
  return {
    provider,
    asked,
    stopped: (): number => stopped,
    /** Every vend still waiting answers now: a credential arriving late. */
    release(): void {
      for (const resolve of waiting.splice(0)) resolve(ISSUED);
    },
  };
}

/** The network: records every request it is handed, and answers 200. */
function recordingBase(): FetchLike & { readonly sent: RequestInit[] } {
  const sent: RequestInit[] = [];
  const base = (async (_input, init) => {
    sent.push(init ?? {});
    return new Response('{}', { status: 200 });
  }) as FetchLike & { sent: RequestInit[] };
  base.sent = sent;
  return base;
}

/** `pending`, or a failure naming the wait, if it has not settled within `ms`. */
function settlesWithin<T>(pending: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the vending fetch had not settled ${ms} ms after the abort`)),
      ms,
    );
  });
  return Promise.race([pending, late]).finally(() => clearTimeout(timer));
}

/** Let every timer and microtask that is due run. */
const drain = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait, on the clock, until `condition` holds — up to five seconds. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition() && Date.now() < deadline) await drain(2);
  expect(condition(), 'the condition never held').toBe(true);
}

// ─── Unit: createVendingFetch ─────────────────────────────────────

describe('vending fetch — the abort reaches the credential wait', () => {
  it('a hung provider and an abort: nothing is sent, and the caller gets the abort', async () => {
    const held = heldProvider();
    const base = recordingBase();
    const controller = new AbortController();
    const reason = new Error('the caller gave up');

    const sending = createVendingFetch(
      gatewayTransport({ url: URL_, credentials: held.provider }),
      base,
    )(URL_, { method: 'POST', body: '{}', signal: controller.signal });
    await until(() => held.asked.length === 1);
    controller.abort(reason);

    await expect(settlesWithin(sending, 500)).rejects.toBe(reason);
    expect(base.sent).toEqual([]);
  });

  it("the provider is handed the request's signal, and one that honours it stops", async () => {
    const held = heldProvider(true);
    const base = recordingBase();
    const controller = new AbortController();
    const reason = new Error('cancelled');

    const sending = createVendingFetch(
      gatewayTransport({ url: URL_, credentials: held.provider, service: 'tools' }),
      base,
    )(URL_, { method: 'POST', body: '{}', signal: controller.signal });
    await until(() => held.asked.length === 1);
    expect(held.asked[0]!.signal).toBe(controller.signal);
    controller.abort(reason);

    await expect(settlesWithin(sending, 500)).rejects.toBe(reason);
    expect(held.stopped()).toBe(1);
    expect(base.sent).toEqual([]);
  });

  it('a provider that ignores the signal and answers late: the late credential is never used', async () => {
    const held = heldProvider();
    const base = recordingBase();
    const controller = new AbortController();
    const reason = new Error('timed out');

    const sending = createVendingFetch(
      gatewayTransport({ url: URL_, credentials: held.provider }),
      base,
    )(URL_, { method: 'POST', body: '{"id":1}', signal: controller.signal });
    await until(() => held.asked.length === 1);
    controller.abort(reason);
    const settled = settlesWithin(sending, 500).catch((error: unknown) => error);

    held.release();
    await drain();

    // The late credential arrived — and the request was not handed on.
    expect(base.sent).toEqual([]);
    expect(await settled).toBe(reason);
  });

  it('a credential that lands in the same turn as the abort is still not used', async () => {
    // The credential is already there; the abort fires before the vending fetch
    // resumes. Only the check AFTER the credential arrives can refuse this one.
    const asked: CredentialRequest[] = [];
    const provider: CredentialProvider = {
      id: 'instant',
      getCredential: (req) => {
        asked.push(req);
        return Promise.resolve(ISSUED);
      },
    };
    const base = recordingBase();
    const controller = new AbortController();
    const reason = new Error('aborted between the credential and the send');

    const sending = createVendingFetch(
      gatewayTransport({ url: URL_, credentials: provider }),
      base,
    )(URL_, { method: 'POST', body: '{}', signal: controller.signal });
    queueMicrotask(() => controller.abort(reason));

    await expect(sending).rejects.toBe(reason);
    expect(asked).toHaveLength(1);
    expect(base.sent).toEqual([]);
  });

  it('an already-aborted request asks no provider and sends nothing', async () => {
    const held = heldProvider();
    const base = recordingBase();
    const controller = new AbortController();
    const reason = new Error('already gone');
    controller.abort(reason);

    await expect(
      settlesWithin(
        createVendingFetch(gatewayTransport({ url: URL_, credentials: held.provider }), base)(
          URL_,
          { method: 'POST', body: '{}', signal: controller.signal },
        ),
        500,
      ),
    ).rejects.toBe(reason);
    expect(held.asked).toEqual([]);
    expect(base.sent).toEqual([]);
  });

  it('a non-Error abort reason reaches the caller as an AbortError carrying it', async () => {
    const held = heldProvider();
    const base = recordingBase();
    const controller = new AbortController();

    const sending = createVendingFetch(
      gatewayTransport({ url: URL_, credentials: held.provider }),
      base,
    )(URL_, { signal: controller.signal });
    await until(() => held.asked.length === 1);
    controller.abort('user-left');

    await expect(settlesWithin(sending, 500)).rejects.toMatchObject({
      name: 'AbortError',
      cause: 'user-left',
    });
    expect(base.sent).toEqual([]);
  });
});

describe('vending fetch — the normal path is unchanged', () => {
  it('no signal: the provider is asked exactly as before, and the request is sent once', async () => {
    const asked: CredentialRequest[] = [];
    const provider: CredentialProvider = {
      id: 'spy',
      getCredential: async (req) => {
        asked.push(req);
        return ISSUED;
      },
    };
    const base = recordingBase();

    await createVendingFetch(
      gatewayTransport({ url: URL_, credentials: provider, scopes: ['read'], mode: 'user' }),
      base,
    )(URL_, { method: 'POST', body: '{"a":1}' });

    expect(asked).toEqual([{ service: 'gateway', scopes: ['read'], mode: 'user' }]);
    expect(Object.keys(asked[0]!)).not.toContain('signal');
    expect(base.sent).toHaveLength(1);
    expect(base.sent[0]!.body).toBe('{"a":1}');
    expect(new Headers(base.sent[0]!.headers).get('authorization')).toBe(`Bearer ${SECRET}`);
  });

  it('a live signal: the provider gets it, the request is sent with it, nothing else differs', async () => {
    const asked: CredentialRequest[] = [];
    const provider: CredentialProvider = {
      id: 'spy',
      getCredential: async (req) => {
        asked.push(req);
        return ISSUED;
      },
    };
    const base = recordingBase();
    const controller = new AbortController();

    const response = await createVendingFetch(
      gatewayTransport({ url: URL_, credentials: provider }),
      base,
    )(URL_, { method: 'POST', body: '{}', signal: controller.signal });

    expect(response.status).toBe(200);
    expect(asked).toEqual([{ service: 'gateway', signal: controller.signal }]);
    expect(base.sent).toHaveLength(1);
    expect(base.sent[0]!.signal).toBe(controller.signal);
    expect(new Headers(base.sent[0]!.headers).get('authorization')).toBe(`Bearer ${SECRET}`);
  });
});

// ─── Scenario: through mcpClient, the series' signal reaches the vend ──

/** One MCP endpoint in this process, reached only through the gateway's `fetch` seam. */
function endpoint() {
  const methods: string[] = [];
  const fetch: FetchLike = async (_input, init) => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'POST')
      return new Response(null, { status: 405 });
    const message = JSON.parse(String(init?.body)) as { method?: string; id?: unknown };
    methods.push(String(message.method));
    const result = (value: unknown): Response =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: value }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    switch (message.method) {
      case 'initialize':
        return result({
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'gw', version: '1.0.0' },
        });
      case 'tools/list':
        return result({ tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] });
      case 'tools/call':
        return result({ content: [{ type: 'text', text: 'looked up' }] });
      default:
        return new Response(null, { status: 202 });
    }
  };
  return { fetch, methods, calls: () => methods.filter((m) => m === 'tools/call').length };
}

/** A provider that vends at once, until `holdNext()`: then the next vend waits for `release()`. */
function switchableProvider() {
  let hold = false;
  const held: Array<{ req: CredentialRequest; resolve: (r: CredentialResult) => void }> = [];
  const provider: CredentialProvider = {
    id: 'switchable',
    getCredential(req) {
      if (!hold) return Promise.resolve(ISSUED);
      hold = false;
      return new Promise((resolve) => held.push({ req, resolve }));
    },
  };
  return {
    provider,
    held,
    holdNext: (): void => {
      hold = true;
    },
    release: (): void => {
      for (const h of held.splice(0)) h.resolve(ISSUED);
    },
  };
}

const CALL_CONTEXT = { toolCallId: 'tc-vend', iteration: 1 } as unknown as ToolExecutionContext;

describe('vending fetch — through mcpClient', () => {
  it('a call aborted while its credential is pending sends nothing, even when the credential comes late', async () => {
    const server = endpoint();
    const credentials = switchableProvider();
    const client = await mcpClient({
      name: 'gw',
      transport: gatewayTransport({
        url: URL_,
        credentials: credentials.provider,
        fetch: server.fetch,
      }),
    });
    try {
      const [lookup] = await client.tools();
      credentials.holdNext();
      const controller = new AbortController();
      const reason = new Error('the person closed the tab');
      const call = lookup!
        .execute({ q: 'x' }, { ...CALL_CONTEXT, signal: controller.signal })
        .catch((error: unknown) => error);
      await until(() => credentials.held.length === 1);
      const handed = credentials.held[0]!.req.signal;
      const firedBeforeAbort = handed?.aborted;

      controller.abort(reason);
      // The SDK delivers a cancelled request as its own error, carrying the reason.
      expect(String(await settlesWithin(call, 1_000))).toContain('the person closed the tab');

      credentials.release();
      await drain(30);
      // The credential came late; the call it was vended for never left.
      expect(server.calls()).toBe(0);
      // The provider was handed the call's cancellation, linked by the series.
      expect(handed).toBeInstanceOf(AbortSignal);
      expect(firedBeforeAbort).toBe(false);
      expect(handed!.aborted).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('a call whose series deadline passes while its credential is pending sends nothing', async () => {
    const server = endpoint();
    const credentials = switchableProvider();
    const client = await mcpClient({
      name: 'gw',
      transport: gatewayTransport({
        url: URL_,
        credentials: credentials.provider,
        fetch: server.fetch,
      }),
      retryOnThrottle: { maxElapsedMs: 40 },
    });
    try {
      const [lookup] = await client.tools();
      credentials.holdNext();
      const call = lookup!.execute({ q: 'x' }, CALL_CONTEXT).catch((error: unknown) => error);
      await until(() => credentials.held.length === 1);

      const handed = credentials.held[0]!.req.signal;
      // The deadline cuts the attempt; the caller gets a failure, not a hang.
      expect(await settlesWithin(call, 2_000)).toBeInstanceOf(Error);

      credentials.release();
      await drain(30);
      expect(server.calls()).toBe(0);
      // What the provider was handed is the signal the deadline fired.
      expect(handed?.aborted).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('with no abort, the call is vended and sent as before', async () => {
    const server = endpoint();
    const credentials = switchableProvider();
    const client = await mcpClient({
      name: 'gw',
      transport: gatewayTransport({
        url: URL_,
        credentials: credentials.provider,
        fetch: server.fetch,
      }),
    });
    try {
      const [lookup] = await client.tools();
      expect(await lookup!.execute({ q: 'x' }, CALL_CONTEXT)).toBe('looked up');
      expect(server.calls()).toBe(1);
    } finally {
      await client.close();
    }
  });
});

// ─── The library's own credential decorator honours the same signal ──

describe('withCredentialRetry — the request signal', () => {
  const transient = (): Error => Object.assign(new Error('upstream 503'), { status: 503 });

  it('passes the signal through to the provider it wraps', async () => {
    const asked: CredentialRequest[] = [];
    const inner: CredentialProvider = {
      id: 'inner',
      getCredential: async (req) => {
        asked.push(req);
        return ISSUED;
      },
    };
    const controller = new AbortController();

    await withCredentialRetry(inner).getCredential({ service: 'gw', signal: controller.signal });
    expect(asked[0]!.signal).toBe(controller.signal);
  });

  it('an abort during the backoff wait ends it with the abort: no further attempt', async () => {
    let attempts = 0;
    const inner: CredentialProvider = {
      id: 'flaky',
      getCredential: async () => {
        attempts += 1;
        throw transient();
      },
    };
    const controller = new AbortController();
    const reason = new Error('stop retrying');

    const vending = withCredentialRetry(inner, { initialDelayMs: 1_000 }).getCredential({
      service: 'gw',
      signal: controller.signal,
    });
    await until(() => attempts === 1);
    controller.abort(reason);

    await expect(settlesWithin(vending, 500)).rejects.toBe(reason);
    await drain(30);
    expect(attempts).toBe(1);
  });

  // A zero wait never consults the signal, and a spent budget never waits, so
  // only the check before the retry decision can turn these into the abort.
  it.each([
    ['a retry with no wait', { initialDelayMs: 0 }],
    ['no retry left', { maxAttempts: 1 }],
  ])(
    'a failure that lands after the abort is the abort, never retried (%s)',
    async (_, options) => {
      let attempts = 0;
      const controller = new AbortController();
      const reason = new Error('cancelled first');
      const inner: CredentialProvider = {
        id: 'deaf',
        getCredential: async () => {
          attempts += 1;
          controller.abort(reason);
          throw transient();
        },
      };

      await expect(
        withCredentialRetry(inner, options).getCredential({
          service: 'gw',
          signal: controller.signal,
        }),
      ).rejects.toBe(reason);
      expect(attempts).toBe(1);
    },
  );
});
