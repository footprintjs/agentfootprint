/**
 * Bound tools (§ 6.3): every tool carries its binding — the key, the context it
 * was listed in, the list it came from and that list's generation — and
 * re-checks it after every wait and at the send gate, at every boundary the
 * request crosses. Nothing is sent under a binding that went stale.
 */

import { describe, expect, it } from 'vitest';

import { agentCoreRuntimeMcpTransport } from '../../../src/tool-providers/index.js';
import { staticTokens } from '../../../src/identity/staticTokens.js';
import type { McpTransport } from '../../../src/mcp/types.js';
import type { ToolDispatchContext } from '../../../src/tools/toolProvider.js';
import type { Tool } from '../../../src/tools/tools.js';
import { fakeEndpoint, type FakeEndpoint } from './fakeEndpoint.js';
import { callCtx, flush, id, poolOver, stallingProvider } from './harness.js';

const listCtx = (identity: ReturnType<typeof id>): ToolDispatchContext =>
  ({ iteration: 1, callerIdentity: identity } as ToolDispatchContext);

const named = (tools: readonly Tool[], name: string): Tool =>
  tools.find((t) => t.schema.name === name) as Tool;

const callsOf = (endpoint: FakeEndpoint, tool?: string) =>
  endpoint.requests.filter(
    (r) => r.rpc === 'tools/call' && (tool === undefined || r.tool === tool),
  );

const SHARE = {
  share: () => ({ configuration: 'orders-runtime@v7', authorization: 'analyst@policy-1' }),
};

describe('(a) a declared share never crosses a configuration the factory chose', () => {
  it('two conversations of one principal, the same names, another qualifier for the second: the hashes differ, the second lists on its own client and never sees the first’s list', async () => {
    const endpoint = fakeEndpoint({
      toolsFor: (session) =>
        firstSession === undefined || firstSession === session
          ? ((firstSession ??= session), [{ name: 'refund' }, { name: 'status' }])
          : [{ name: 'status' }],
    });
    let firstSession: string | undefined;
    const { pool } = poolOver(endpoint, {
      definitions: SHARE,
      transport: (identity) => ({
        transport: 'http',
        url: `${endpoint.url}?qualifier=${identity.conversationId === 'c1' ? 'v1' : 'v2'}`,
        fetch: endpoint.fetch,
      }),
    });
    const first = await pool.toolProvider().list(listCtx(id('alice', 'c1')));
    const second = await pool.toolProvider().list(listCtx(id('alice', 'c2')));
    expect(first.map((t) => t.schema.name)).toEqual(['refund', 'status']);
    expect(second.map((t) => t.schema.name)).toEqual(['status']);
    const lists = endpoint.requests.filter((r) => r.rpc === 'tools/list');
    expect(lists).toHaveLength(2);
    expect(new Set(lists.map((r) => r.session)).size).toBe(2);
  });
});

describe('(b) a permission change during a cold open', () => {
  it('shared: the revoked tool is refused after the open — the server receives no tools/call', async () => {
    const endpoint = fakeEndpoint({ toolsFor: () => [{ name: 'refund' }] });
    const { pool } = poolOver(endpoint, { definitions: SHARE });
    const alice = id('alice', 'c1');
    const [refund] = await pool.toolProvider().list(listCtx(alice));
    await pool.terminate({ principal: 'alice', conversationId: 'c1' });
    await pool.settled();
    const slow = endpoint.hold((r) => r.rpc === 'initialize');
    const call = refund!.execute({}, callCtx(alice)).catch((error: unknown) => error);
    await flush();
    pool.permissionsChanged({ principal: 'alice' });
    slow.release();
    expect(await call).toMatchObject({ reason: 'stale-tools', sent: false });
    expect(callsOf(endpoint)).toHaveLength(0);
  });

  it('per client: the replacement’s fresh list, listed after the change, decides — a revoked tool is refused, never sent', async () => {
    let revoked = false;
    const endpoint = fakeEndpoint({
      toolsFor: () => (revoked ? [{ name: 'status' }] : [{ name: 'status' }, { name: 'refund' }]),
    });
    const { pool } = poolOver(endpoint);
    const alice = id('alice', 'c1');
    const tools = await pool.toolProvider().list(listCtx(alice));
    await pool.terminate({ principal: 'alice', conversationId: 'c1' });
    await pool.settled();
    const slow = endpoint.hold((r) => r.rpc === 'initialize');
    const call = named(tools, 'refund')
      .execute({}, callCtx(alice))
      .catch((e: unknown) => e);
    await flush();
    revoked = true;
    pool.permissionsChanged({ principal: 'alice' });
    slow.release();
    expect(await call).toMatchObject({ reason: 'stale-tools', sent: false });
    expect(callsOf(endpoint)).toHaveLength(0);
  });
});

describe('(c) a permission change at the send gate', () => {
  it('during a credential vend: refused once the credential arrives — nothing sent', async () => {
    const endpoint = fakeEndpoint({ toolsFor: () => [{ name: 'refund' }] });
    const vend = stallingProvider();
    const { pool } = poolOver(endpoint, {
      transport: () => ({
        transport: 'gateway',
        url: endpoint.url,
        credentials: vend.provider,
        service: 'orders',
        fetch: endpoint.fetch,
      }),
    });
    const alice = id('alice', 'c1');
    const [refund] = await pool.toolProvider().list(listCtx(alice));
    vend.stall();
    const call = refund!.execute({}, callCtx(alice)).catch((error: unknown) => error);
    await flush();
    expect(vend.waiting).toBe(1);
    pool.permissionsChanged({ principal: 'alice' });
    vend.releaseAll();
    expect(await call).toMatchObject({ reason: 'stale-tools' });
    expect(callsOf(endpoint)).toHaveLength(0);
  });

  it('during a session-busy wait: the retry is refused at the send gate after the wait — nothing more is sent', async () => {
    const endpoint = fakeEndpoint({ toolsFor: () => [{ name: 'refund' }] });
    let busy = true;
    const standIn = async (input: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (busy && body.includes('"tools/call"')) {
        busy = false;
        await endpoint.fetch(input, init); // it reached the network
        const message = JSON.parse(body) as { id: unknown };
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32005, message: 'Session operation in progress, please retry' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return endpoint.fetch(input, init);
    };
    const alice = id('alice', 'c1');
    const ref: { pool?: ReturnType<typeof poolOver>['pool'] } = {};
    const { pool } = poolOver(endpoint, {
      transport: () =>
        agentCoreRuntimeMcpTransport({
          agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders-a1b2c3',
          region: 'us-west-2',
          session: 'reuse',
          auth: { bearer: staticTokens({ runtime: 't' }), fetch: standIn },
          retry: {
            baseDelayMs: 5,
            // Before the wait: the binding goes stale while the series waits.
            onRetry: () => ref.pool?.permissionsChanged({ principal: 'alice' }),
          },
        }) as McpTransport,
    });
    ref.pool = pool;
    const [refund] = await pool.toolProvider().list(listCtx(alice));
    const outcome = await refund!.execute({}, callCtx(alice)).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(Error);
    // The first attempt reached the network; the retry was never sent.
    expect(callsOf(endpoint)).toHaveLength(1);
  });
});

describe('(c′) the retry series asks the gate itself', () => {
  it('during a 429 wait on plain HTTP — no later boundary of ours: the series refuses the retry after the wait, nothing more is sent', async () => {
    const endpoint = fakeEndpoint({ toolsFor: () => [{ name: 'refund' }] });
    let throttled = true;
    const appFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      if (throttled && typeof init?.body === 'string' && init.body.includes('"tools/call"')) {
        throttled = false;
        await endpoint.fetch(input, init); // it reached the network
        return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
      }
      return endpoint.fetch(input, init);
    };
    const ref: { pool?: ReturnType<typeof poolOver>['pool'] } = {};
    const { pool } = poolOver(endpoint, {
      transport: () => ({ transport: 'http', url: endpoint.url, fetch: appFetch }),
      retryOnThrottle: {
        baseDelayMs: 1,
        // Before the wait: the binding goes stale while the series waits.
        onRetry: () => ref.pool?.permissionsChanged({ principal: 'alice' }),
      },
    });
    ref.pool = pool;
    const alice = id('alice', 'c1');
    const [refund] = await pool.toolProvider().list(listCtx(alice));
    const outcome = await refund!.execute({}, callCtx(alice)).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(Error);
    expect(callsOf(endpoint)).toHaveLength(1);
  });
});

describe('(d) a replacement client whose plan changed', () => {
  const variants: ReadonlyArray<[string, (n: number) => Partial<McpTransport>]> = [
    ['another credential provider id', (n) => ({ credentials: { id: `vault-${n}` } as never })],
    ['other scopes', (n) => ({ scopes: [`orders:${n}`] })],
    ['another URL', (n) => ({ url: `https://orders-${n}.example.test/mcp` })],
  ];
  for (const [what, change] of variants) {
    it(`${what}: the old bound tool refuses with binding-changed before sending; the next list binds the new client`, async () => {
      const endpoint = fakeEndpoint({ toolsFor: () => [{ name: 'status' }] });
      const vend = stallingProvider();
      let version = 1;
      const { pool } = poolOver(endpoint, {
        transport: () => {
          const base = {
            transport: 'gateway' as const,
            url: endpoint.url,
            credentials: vend.provider,
            service: 'orders',
            fetch: endpoint.fetch,
          };
          const changed = change(version) as Record<string, unknown>;
          if ('credentials' in changed) {
            changed['credentials'] = {
              ...vend.provider,
              id: (changed['credentials'] as { id: string }).id,
            };
          }
          return { ...base, ...changed } as McpTransport;
        },
      });
      const alice = id('alice', 'c1');
      const [status] = await pool.toolProvider().list(listCtx(alice));
      await pool.terminate({ principal: 'alice', conversationId: 'c1' });
      await pool.settled();
      version = 2;
      const refused = await status!.execute({}, callCtx(alice)).catch((e: unknown) => e);
      expect(refused).toMatchObject({ reason: 'binding-changed', sent: false });
      expect(callsOf(endpoint)).toHaveLength(0);
      // The new client stays for the conversation's next list, which binds it.
      const [fresh] = await pool.toolProvider().list(listCtx(alice));
      await expect(fresh!.execute({}, callCtx(alice))).resolves.toContain('status@');
      expect(endpoint.requests.filter((r) => r.rpc === 'initialize')).toHaveLength(2);
    });
  }
});

describe('(e) a same-key, same-plan replacement, per client', () => {
  it('the old session listed status and unlocked_tool, the fresh one lists only status: unlocked_tool is refused (stale-tools, never sent), status is revalidated and sent — generations never carry across incarnations', async () => {
    let first: string | undefined;
    const endpoint = fakeEndpoint({
      toolsFor: (session) => {
        first ??= session;
        return session === first
          ? [{ name: 'status' }, { name: 'unlocked_tool' }]
          : [{ name: 'status' }];
      },
    });
    let now = 1_000_000;
    const { pool } = poolOver(endpoint, { maxClients: 1, now: () => now });
    const alice = id('alice', 'c1');
    const old = await pool.toolProvider().list(listCtx(alice));
    expect(old.map((t) => t.schema.name)).toEqual(['status', 'unlocked_tool']);
    // Evicted by another conversation: alice's old incarnation is gone.
    now += 10;
    (await pool.acquire(id('bob', 'c2'))).release();
    await pool.settled();
    now += 10;

    const uses: import('../../../src/tools/mcpClientUse.js').McpClientUse[] = [];
    const refused = await named(old, 'unlocked_tool')
      .execute({}, callCtx(alice, undefined, uses))
      .catch((e: unknown) => e);
    expect(refused).toMatchObject({ reason: 'stale-tools', sent: false });
    expect(callsOf(endpoint, 'unlocked_tool')).toHaveLength(0);
    expect(uses[0]).toMatchObject({
      client: 'opened',
      revalidated: 'refused',
      refusal: 'stale-tools',
    });

    // The fresh incarnation's list is generation 1 too — and still never matches.
    await expect(
      named(old, 'status').execute({}, callCtx(alice, undefined, uses)),
    ).resolves.toContain('status@');
    expect(uses[1]).toMatchObject({ revalidated: 'kept' });
    const statusCalls = callsOf(endpoint, 'status');
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]!.session).not.toBe(first);
  });

  it('a replacement that lists the same NAME with another definition refuses the old binding (stale-tools) — compared as canonical JSON, never by name', async () => {
    let first: string | undefined;
    const endpoint = fakeEndpoint({
      toolsFor: (session) => {
        first ??= session;
        return [{ name: 'status', description: session === first ? 'v1' : 'v2' }];
      },
    });
    let now = 1_000_000;
    const { pool } = poolOver(endpoint, { maxClients: 1, now: () => now });
    const alice = id('alice', 'c1');
    const [old] = await pool.toolProvider().list(listCtx(alice));
    now += 10;
    (await pool.acquire(id('bob', 'c2'))).release();
    await pool.settled();
    now += 10;
    await expect(old!.execute({}, callCtx(alice))).rejects.toMatchObject({
      reason: 'stale-tools',
      sent: false,
    });
    expect(callsOf(endpoint)).toHaveLength(0);
  });

  it('a binding never runs on another key’s client: a tool handed to another conversation’s run is refused (identity-mismatch), nothing sent', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    const [status] = await pool.toolProvider().list(listCtx(id('alice', 'c1')));
    const refused = await status!
      .execute({}, callCtx(id('mallory', 'c1')))
      .catch((e: unknown) => e);
    expect(refused).toMatchObject({ reason: 'identity-mismatch', sent: false });
    const derived = await status!.execute({}, callCtx(undefined)).catch((e: unknown) => e);
    expect(derived).toMatchObject({ reason: 'identity-mismatch' });
    expect(callsOf(endpoint)).toHaveLength(0);
  });
});
