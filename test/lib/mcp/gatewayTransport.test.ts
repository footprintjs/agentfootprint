/**
 * gatewayTransport — MCP headers vended per request, and never kept.
 *
 * Two claims are worth testing here and they pull in opposite directions:
 *
 *   1. The token is FRESH. Every request asks the provider again, so a rotated
 *      or refreshed credential is simply the one used next — the thing a
 *      connection-lifetime header cannot do.
 *   2. The token is SECRET. It is used once and dropped: not cached, not stored
 *      on the transport, not in an event, a log, or an error message — including
 *      the errors thrown while holding one.
 *
 * The secrecy claim is asserted with a deliberately hostile observer: every
 * console channel is captured, the transport object is serialized, and every
 * thrown error is scanned. If the token appears anywhere in that haul, the test
 * fails — which is the only way to test a negative that matters.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createVendingFetch,
  gatewayTransport,
  GatewayAuthorizationRequiredError,
  type FetchLike,
} from '../../../src/lib/mcp/gatewayTransport.js';
import { bearer, apiKey } from '../../../src/identity/kinds.js';
import { staticTokens } from '../../../src/identity/staticTokens.js';
import type { CredentialProvider } from '../../../src/identity/types.js';

const SECRET = 'sk-super-secret-token-1234567890';

afterEach(() => vi.restoreAllMocks());

/** A provider that vends a different token every call, so caching is visible. */
function rotatingProvider(): CredentialProvider & { readonly vends: number } {
  let vends = 0;
  return {
    id: 'rotating',
    get vends() {
      return vends;
    },
    async getCredential() {
      vends += 1;
      return { status: 'issued' as const, credential: bearer(`${SECRET}-${vends}`) };
    },
  };
}

/** Records the headers each outgoing request actually carried. */
function recordingFetch(): FetchLike & { readonly seen: Headers[] } {
  const seen: Headers[] = [];
  const fetchLike = (async (_input, init) => {
    seen.push(new Headers(init?.headers ?? {}));
    return new Response('{}', { status: 200 });
  }) as FetchLike & { seen: Headers[] };
  fetchLike.seen = seen;
  return fetchLike;
}

// ── unit: the transport descriptor ──────────────────────────────────

describe('gatewayTransport — unit', () => {
  it('is a new member of the transport union, discriminated by name', () => {
    const transport = gatewayTransport({
      url: 'https://gw.example/mcp',
      credentials: staticTokens({ gateway: SECRET }),
    });
    expect(transport.transport).toBe('gateway');
    expect(transport.url).toBe('https://gw.example/mcp');
  });

  it('defaults the service id, and takes one when you have your own', () => {
    const credentials = staticTokens({ gateway: SECRET });
    expect(gatewayTransport({ url: 'https://x/', credentials }).service).toBe('gateway');
    expect(gatewayTransport({ url: 'https://x/', credentials, service: 'tools' }).service).toBe(
      'tools',
    );
  });

  it('carries scopes and mode only when given, so a provider sees no invented defaults', () => {
    const credentials = staticTokens({ gateway: SECRET });
    expect(gatewayTransport({ url: 'https://x/', credentials })).not.toHaveProperty('mode');
    const full = gatewayTransport({
      url: 'https://x/',
      credentials,
      scopes: ['tools:read'],
      mode: 'user',
    });
    expect(full).toMatchObject({ scopes: ['tools:read'], mode: 'user' });
  });

  it('refuses to be built without a url or without credentials', () => {
    const credentials = staticTokens({ gateway: SECRET });
    expect(() => gatewayTransport({ url: '', credentials })).toThrow(/url/);
    expect(() =>
      gatewayTransport({ url: 'https://x/' } as unknown as Parameters<typeof gatewayTransport>[0]),
    ).toThrow(/credentials/);
  });
});

// ── scenario: vended per request, which is the entire point ─────────

describe('gatewayTransport — vending', () => {
  it('applies the vended header to the outgoing request', async () => {
    const base = recordingFetch();
    const transport = gatewayTransport({
      url: 'https://gw/',
      credentials: staticTokens({ gateway: SECRET }),
    });
    await createVendingFetch(transport, base)('https://gw/');
    expect(base.seen[0].get('authorization')).toBe(`Bearer ${SECRET}`);
  });

  it('vends AGAIN on every request — this is not a cache', async () => {
    const credentials = rotatingProvider();
    const base = recordingFetch();
    const vending = createVendingFetch(gatewayTransport({ url: 'https://gw/', credentials }), base);
    await vending('https://gw/');
    await vending('https://gw/');
    await vending('https://gw/');
    expect(credentials.vends).toBe(3);
    // A standing agent outlives its bearer token; reusing the first one is the
    // burst of 401s an hour into a session that tested fine.
    expect(base.seen.map((h) => h.get('authorization'))).toEqual([
      `Bearer ${SECRET}-1`,
      `Bearer ${SECRET}-2`,
      `Bearer ${SECRET}-3`,
    ]);
  });

  it('works with any credential kind, through toHeaders() rather than a switch', async () => {
    const base = recordingFetch();
    const credentials: CredentialProvider = {
      id: 'key',
      getCredential: async () => ({
        status: 'issued',
        credential: apiKey(SECRET, 'x-api-key'),
      }),
    };
    await createVendingFetch(
      gatewayTransport({ url: 'https://gw/', credentials }),
      base,
    )('https://gw/');
    expect(base.seen[0].get('x-api-key')).toBe(SECRET);
  });

  it('sends static headers too, and never lets one shadow the credential', async () => {
    const base = recordingFetch();
    const transport = gatewayTransport({
      url: 'https://gw/',
      credentials: staticTokens({ gateway: SECRET }),
      headers: { 'x-tenant': 'acme', authorization: 'Bearer stale-and-wrong' },
    });
    await createVendingFetch(transport, base)('https://gw/');
    expect(base.seen[0].get('x-tenant')).toBe('acme');
    // The vended one is applied last, on purpose.
    expect(base.seen[0].get('authorization')).toBe(`Bearer ${SECRET}`);
  });

  it("keeps the caller's own request init — method and body survive", async () => {
    let seenMethod: string | undefined;
    const base: FetchLike = async (_input, init) => {
      seenMethod = init?.method;
      return new Response('{}');
    };
    const transport = gatewayTransport({
      url: 'https://gw/',
      credentials: staticTokens({ gateway: SECRET }),
    });
    await createVendingFetch(transport, base)('https://gw/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(seenMethod).toBe('POST');
  });

  it('passes the SDK-supplied headers through alongside the vended ones', async () => {
    const base = recordingFetch();
    const transport = gatewayTransport({
      url: 'https://gw/',
      credentials: staticTokens({ gateway: SECRET }),
    });
    await createVendingFetch(transport, base)('https://gw/', {
      headers: { accept: 'text/event-stream' },
    });
    expect(base.seen[0].get('accept')).toBe('text/event-stream');
    expect(base.seen[0].get('authorization')).toBe(`Bearer ${SECRET}`);
  });

  it('forwards the service, scopes and mode to the provider unchanged', async () => {
    const asked: unknown[] = [];
    const credentials: CredentialProvider = {
      id: 'spy',
      getCredential: async (req) => {
        asked.push(req);
        return { status: 'issued', credential: bearer(SECRET) };
      },
    };
    const transport = gatewayTransport({
      url: 'https://gw/',
      credentials,
      service: 'tools',
      scopes: ['tools:read'],
      mode: 'user',
    });
    await createVendingFetch(transport, recordingFetch())('https://gw/');
    expect(asked[0]).toEqual({ service: 'tools', scopes: ['tools:read'], mode: 'user' });
  });
});

// ── scenario: consent, which a transport cannot run ─────────────────

describe('gatewayTransport — consent', () => {
  it('throws a named, actionable error when the user must authorize first', async () => {
    const credentials: CredentialProvider = {
      id: 'needs-consent',
      getCredential: async () => ({
        status: 'authorization-required',
        authorizationUrl: 'https://auth.example/consent?x=1',
        sessionId: 's-1',
      }),
    };
    const vending = createVendingFetch(
      gatewayTransport({ url: 'https://gw/', credentials }),
      recordingFetch(),
    );
    await expect(vending('https://gw/')).rejects.toBeInstanceOf(GatewayAuthorizationRequiredError);
    await expect(vending('https://gw/')).rejects.toThrow(/authorize/);
  });

  it('carries the authorization URL so the caller can surface it', async () => {
    const credentials: CredentialProvider = {
      id: 'needs-consent',
      getCredential: async () => ({
        status: 'authorization-required',
        authorizationUrl: 'https://auth.example/consent?x=1',
        sessionId: 's-1',
      }),
    };
    const vending = createVendingFetch(
      gatewayTransport({ url: 'https://gw/', credentials }),
      recordingFetch(),
    );
    const error = await vending('https://gw/').catch((e: unknown) => e);
    expect((error as GatewayAuthorizationRequiredError).authorizationUrl).toBe(
      'https://auth.example/consent?x=1',
    );
    expect((error as GatewayAuthorizationRequiredError).code).toBe(
      'ERR_GATEWAY_AUTHORIZATION_REQUIRED',
    );
  });

  it('does not send the request when there is no credential to send with it', async () => {
    const base = recordingFetch();
    const credentials: CredentialProvider = {
      id: 'needs-consent',
      getCredential: async () => ({
        status: 'authorization-required',
        authorizationUrl: 'https://auth.example/consent',
        sessionId: 's-1',
      }),
    };
    await createVendingFetch(
      gatewayTransport({ url: 'https://gw/', credentials }),
      base,
    )('https://gw/').catch(() => undefined);
    expect(base.seen).toHaveLength(0);
  });

  it('a provider that throws fails the request rather than sending it unauthenticated', async () => {
    const base = recordingFetch();
    const credentials: CredentialProvider = {
      id: 'broken',
      getCredential: async () => {
        throw new Error('vault unreachable');
      },
    };
    const vending = createVendingFetch(gatewayTransport({ url: 'https://gw/', credentials }), base);
    await expect(vending('https://gw/')).rejects.toThrow('vault unreachable');
    expect(base.seen).toHaveLength(0);
  });
});

// ── security: THE token-secrecy law ─────────────────────────────────

describe('gatewayTransport — the token never leaks', () => {
  /** Captures every channel a library could plausibly write a secret to. */
  function hostileLogger() {
    const recorded: string[] = [];
    const capture = (...args: unknown[]) => {
      recorded.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    for (const channel of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      vi.spyOn(console, channel).mockImplementation(capture);
    }
    return {
      get haul() {
        return recorded.join('\n');
      },
    };
  }

  it('a hostile logger watching every console channel never sees the header value', async () => {
    const logger = hostileLogger();
    const transport = gatewayTransport({
      url: 'https://gw/',
      credentials: staticTokens({ gateway: SECRET }),
    });
    const vending = createVendingFetch(transport, recordingFetch());
    await vending('https://gw/');
    await vending('https://gw/');
    expect(logger.haul).not.toContain(SECRET);
  });

  it('the transport object holds no token — serializing it reveals nothing', async () => {
    const transport = gatewayTransport({
      url: 'https://gw/',
      credentials: staticTokens({ gateway: SECRET }),
      headers: { 'x-tenant': 'acme' },
    });
    const vending = createVendingFetch(transport, recordingFetch());
    await vending('https://gw/');
    // AFTER a successful vend: nothing was written back onto the descriptor.
    expect(JSON.stringify(transport)).not.toContain(SECRET);
    expect(JSON.stringify(Object.getOwnPropertyDescriptors(transport))).not.toContain(SECRET);
  });

  it('an error thrown DOWNSTREAM of the vend carries no token', async () => {
    const exploding: FetchLike = async () => {
      throw new Error('gateway returned 500');
    };
    const transport = gatewayTransport({
      url: 'https://gw/',
      credentials: staticTokens({ gateway: SECRET }),
    });
    const error = await createVendingFetch(
      transport,
      exploding,
    )('https://gw/').catch((e: unknown) => e as Error);
    // This is the error thrown while the token was live, and it is the one most
    // likely to be logged verbatim by a caller.
    expect(`${error.message}${error.stack ?? ''}`).not.toContain(SECRET);
  });

  it('the consent error carries the URL but no token — there is not one yet', async () => {
    const credentials: CredentialProvider = {
      id: 'needs-consent',
      getCredential: async () => ({
        status: 'authorization-required',
        authorizationUrl: `https://auth.example/consent`,
        sessionId: 's-1',
      }),
    };
    const error = await createVendingFetch(
      gatewayTransport({ url: 'https://gw/', credentials }),
      recordingFetch(),
    )('https://gw/').catch((e: unknown) => e as Error);
    expect(JSON.stringify({ message: error.message, ...error })).not.toContain(SECRET);
  });

  it('two vends do not share state — the second cannot read the first token', async () => {
    const credentials = rotatingProvider();
    const base = recordingFetch();
    const vending = createVendingFetch(gatewayTransport({ url: 'https://gw/', credentials }), base);
    await vending('https://gw/');
    await vending('https://gw/');
    // If a token were retained between calls, the second request would carry
    // the first value — the exact bug this transport exists to make impossible.
    expect(base.seen[1].get('authorization')).not.toBe(base.seen[0].get('authorization'));
  });
});

// ── ROI: the existing transports are untouched ──────────────────────

describe('gatewayTransport — additive, not a rewrite', () => {
  it('stdio and http descriptors keep their exact shape', async () => {
    const { mcpClient } = await import('../../../src/lib/mcp/mcpClient.js');
    // A stdio transport still works through the injected-client path with no
    // knowledge that a third member joined the union.
    const client = await mcpClient({
      name: 'still-fine',
      transport: { transport: 'stdio', command: 'node', args: ['-e', ''] },
      _client: {
        listTools: async () => ({ tools: [] }),
        callTool: async () => ({ content: [] }),
        close: async () => undefined,
        connect: async () => undefined,
      } as never,
    });
    expect(await client.tools()).toEqual([]);
    await client.close();
  });
});
