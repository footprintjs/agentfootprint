/**
 * Tool definitions (§ 6.1–6.2): per client incarnation by default; shared only
 * under the app's declared names AND a matching configuration, the tenant
 * always in the context; invalidated by the server's notice, the app's
 * permission signal, `toolsChanged`, and a time limit.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { ToolDispatchContext } from '../../../src/tools/toolProvider.js';
import type { Tool } from '../../../src/tools/tools.js';
import { REAL_TRANSPORT_TIMEOUT } from '../realTransportSupport.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { callCtx, flush, id, poolOver, stallingProvider } from './harness.js';
import { startSessionServer, type SessionServer } from './sessionServer.js';

const listCtx = (identity: ReturnType<typeof id>): ToolDispatchContext =>
  ({ iteration: 1, callerIdentity: identity } as ToolDispatchContext);

const lists = (endpoint: ReturnType<typeof fakeEndpoint>) =>
  endpoint.requests.filter((r) => r.rpc === 'tools/list');

const SAME_NAMES = {
  share: () => ({ configuration: 'orders-runtime@v7', authorization: 'analyst@policy-1' }),
};

describe('per client by default; shared only when declared and checked', () => {
  it('two conversations of one principal list twice — each on its own client', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    await pool.toolProvider().list(listCtx(id('alice', 'c1')));
    await pool.toolProvider().list(listCtx(id('alice', 'c2')));
    expect(lists(endpoint)).toHaveLength(2);
    expect(new Set(lists(endpoint).map((r) => r.session)).size).toBe(2);
  });

  it('`share` with equal names and plans lists once; the second conversation touches no client', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, { definitions: SAME_NAMES });
    await pool.toolProvider().list(listCtx(id('alice', 'c1')));
    const tools = await pool.toolProvider().list(listCtx(id('bob', 'c2')));
    expect(lists(endpoint)).toHaveLength(1);
    expect(endpoint.requests.filter((r) => r.rpc === 'initialize')).toHaveLength(1);
    // Bob's call opens Bob's own client — never Alice's session.
    await expect(tools[0]!.execute({}, callCtx(id('bob', 'c2')))).resolves.toContain('status@');
    const sessions = new Set(
      endpoint.requests.filter((r) => r.rpc === 'initialize').map((r) => r.seq),
    );
    expect(sessions.size).toBe(2);
    const bobCall = endpoint.requests.find((r) => r.rpc === 'tools/call');
    const aliceList = lists(endpoint)[0];
    expect(bobCall!.session).not.toBe(aliceList!.session);
  });

  it('different names list twice', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, {
      definitions: {
        share: (identity) => ({
          configuration: 'orders-runtime@v7',
          authorization: identity.principal === 'alice' ? 'admin@policy-1' : 'analyst@policy-1',
        }),
      },
    });
    await pool.toolProvider().list(listCtx(id('alice', 'c1')));
    await pool.toolProvider().list(listCtx(id('bob', 'c2')));
    expect(lists(endpoint)).toHaveLength(2);
  });

  it('equal names in two tenants never share', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, { definitions: SAME_NAMES });
    await pool.toolProvider().list(listCtx(id('alice', 'c1', 'acme')));
    await pool.toolProvider().list(listCtx(id('alice', 'c1', 'globex')));
    expect(lists(endpoint)).toHaveLength(2);
  });

  it('`share` returning undefined keeps the conversation’s list to itself', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, { definitions: { share: () => undefined } });
    await pool.toolProvider().list(listCtx(id('alice', 'c1')));
    await pool.toolProvider().list(listCtx(id('bob', 'c2')));
    expect(lists(endpoint)).toHaveLength(2);
  });
});

describe('invalidation', () => {
  const servers: SessionServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it(
    "the server's tools-changed notice invalidates: the next list lists again, and a tool bound before it is refused (stale-tools), not sent",
    async () => {
      const server = await startSessionServer();
      servers.push(server);
      const { pool } = poolOver(fakeEndpoint(), {
        transport: () => ({ transport: 'http', url: server.url }),
      });
      const alice = id('alice', 'c1');
      const [status] = await pool.toolProvider().list(listCtx(alice));
      const session = server.sessions()[0]!;
      const callsBefore = server.requests.filter((r) => r.rpc === 'tools/call').length;
      await server.notifyToolsChanged(session);
      // The notice crosses the SDK's own standalone stream, on loopback.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const refused = await status!.execute({}, callCtx(alice)).catch((e: unknown) => e);
      expect(refused).toMatchObject({ reason: 'stale-tools', sent: false });
      expect(server.requests.filter((r) => r.rpc === 'tools/call').length).toBe(callsBefore);
      const before = server.requests.filter((r) => r.rpc === 'tools/list').length;
      const fresh = await pool.toolProvider().list(listCtx(alice));
      expect(server.requests.filter((r) => r.rpc === 'tools/list').length).toBe(before + 1);
      await expect(fresh[0]!.execute({}, callCtx(alice))).resolves.toContain('status@');
      await pool.close();
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it('permissionsChanged invalidates: a bound tool from before refuses with stale-tools, not sent; the next list lists again', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    const alice = id('alice', 'c1');
    const [status] = await pool.toolProvider().list(listCtx(alice));
    pool.permissionsChanged({ principal: 'alice' });
    await expect(status!.execute({}, callCtx(alice))).rejects.toMatchObject({
      reason: 'stale-tools',
    });
    expect(endpoint.requests.filter((r) => r.rpc === 'tools/call')).toHaveLength(0);
    await pool.toolProvider().list(listCtx(alice));
    expect(lists(endpoint)).toHaveLength(2);
    // Another principal's list is not touched.
    const bob = id('bob', 'c2');
    const [bobs] = await pool.toolProvider().list(listCtx(bob));
    pool.permissionsChanged({ principal: 'alice' });
    await expect(bobs!.execute({}, callCtx(bob))).resolves.toContain('status@');
  });

  it('toolsChanged invalidates every list', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    const alice = id('alice', 'c1');
    const bob = id('bob', 'c2');
    const [a] = await pool.toolProvider().list(listCtx(alice));
    const [b] = await pool.toolProvider().list(listCtx(bob));
    pool.toolsChanged();
    await expect(a!.execute({}, callCtx(alice))).rejects.toMatchObject({ reason: 'stale-tools' });
    await expect(b!.execute({}, callCtx(bob))).rejects.toMatchObject({ reason: 'stale-tools' });
  });

  it('a listing in flight during an invalidation is discarded, never written: the list served is a fresh one', async () => {
    // The first listing answers the OLD list; every later one the new.
    let listed = 0;
    const endpoint = fakeEndpoint({
      toolsFor: () => [{ name: (listed += 1) === 1 ? 'status_v1' : 'status_v2' }],
    });
    const { pool } = poolOver(endpoint);
    const alice = id('alice', 'c1');
    const slow = endpoint.hold((r) => r.rpc === 'tools/list');
    const listing = pool.toolProvider().list(listCtx(alice));
    await flush();
    expect(slow.held).toBe(1);
    pool.toolsChanged();
    slow.release();
    // The held listing lands after the change: discarded, never written; the
    // conversation is served a listing begun after it.
    const tools = await listing;
    expect(tools.map((t) => t.schema.name)).toEqual(['status_v2']);
    expect(lists(endpoint)).toHaveLength(2);
  });

  it('a lapsed time limit over an unchanged list lists again and keeps the generation: a tool bound before still runs', async () => {
    const endpoint = fakeEndpoint();
    let now = 1_000_000;
    const { pool } = poolOver(endpoint, { definitionTtlMs: 1_000, now: () => now });
    const alice = id('alice', 'c1');
    const [before] = await pool.toolProvider().list(listCtx(alice));
    now += 5_000;
    await pool.toolProvider().list(listCtx(alice));
    expect(lists(endpoint)).toHaveLength(2);
    await expect(before!.execute({}, callCtx(alice))).resolves.toContain('status@');
  });

  it('a lapsed time limit over a CHANGED list moves the generation: a tool bound before is refused', async () => {
    let version = 1;
    const endpoint = fakeEndpoint({
      toolsFor: () => [{ name: 'status', description: `v${version}` }],
    });
    let now = 1_000_000;
    const { pool } = poolOver(endpoint, { definitionTtlMs: 1_000, now: () => now });
    const alice = id('alice', 'c1');
    const [before] = await pool.toolProvider().list(listCtx(alice));
    now += 5_000;
    version = 2;
    await pool.toolProvider().list(listCtx(alice));
    await expect(before!.execute({}, callCtx(alice))).rejects.toMatchObject({
      reason: 'stale-tools',
    });
  });
});

describe('entries are frozen plain-data copies', () => {
  it('mutating a returned definition does not reach another conversation', async () => {
    const endpoint = fakeEndpoint({
      toolsFor: () => [{ name: 'status', inputSchema: { type: 'object', properties: {} } }],
    });
    const { pool } = poolOver(endpoint, { definitions: SAME_NAMES });
    const [mine] = await pool.toolProvider().list(listCtx(id('alice', 'c1')));
    expect(() => {
      (mine!.schema.inputSchema as Record<string, unknown>)['properties'] = { injected: {} };
    }).toThrow(TypeError);
    const [theirs] = await pool.toolProvider().list(listCtx(id('bob', 'c2')));
    expect(theirs!.schema.inputSchema).toEqual({ type: 'object', properties: {} });
  });
});

describe('a versioned authorization name reaches conversations that already have a client', () => {
  /** A server whose list depends on the policy version; `share` names that version. */
  function versioned() {
    const state = { version: 1, asked: 0 };
    const endpoint = fakeEndpoint({
      toolsFor: () =>
        state.version === 1 ? [{ name: 'status' }, { name: 'refund' }] : [{ name: 'status' }],
    });
    const { pool } = poolOver(endpoint, {
      definitions: {
        share: () => {
          state.asked += 1;
          return { configuration: 'same-server', authorization: `role@policy-${state.version}` };
        },
      },
    });
    return { state, endpoint, pool };
  }
  const names = (tools: readonly Tool[]) => tools.map((t) => t.schema.name);
  const named = (tools: readonly Tool[], name: string): Tool =>
    tools.find((t) => t.schema.name === name) as Tool;
  const calls = (endpoint: ReturnType<typeof fakeEndpoint>, tool: string) =>
    endpoint.requests.filter((r) => r.rpc === 'tools/call' && r.tool === tool);

  it('relisting the same conversation after the version moved lists again under the new name — the tool the new policy dropped is gone', async () => {
    const { state, endpoint, pool } = versioned();
    const alice = id('alice', 'a');
    expect(names(await pool.toolProvider().list(listCtx(alice)))).toEqual(['status', 'refund']);
    const asked = state.asked;
    state.version = 2;
    expect(names(await pool.toolProvider().list(listCtx(alice)))).toEqual(['status']);
    expect(state.asked).toBeGreaterThan(asked);
    // The controls: a new conversation, and the explicit signal, agree.
    expect(names(await pool.toolProvider().list(listCtx(id('bob', 'b'))))).toEqual(['status']);
    pool.permissionsChanged({ principal: 'alice' });
    expect(names(await pool.toolProvider().list(listCtx(alice)))).toEqual(['status']);
    expect(calls(endpoint, 'refund')).toHaveLength(0);
    await pool.close();
  });

  it('a tool bound under the old name is refused before it is sent — whether or not anything was listed since', async () => {
    const { state, endpoint, pool } = versioned();
    const alice = id('alice', 'a');
    const before = await pool.toolProvider().list(listCtx(alice));
    state.version = 2;
    // Nothing listed since the version moved: still refused, nothing sent.
    await expect(named(before, 'refund').execute({}, callCtx(alice))).rejects.toMatchObject({
      name: 'McpPoolRefusedError',
      reason: 'binding-changed',
    });
    await expect(named(before, 'status').execute({}, callCtx(alice))).rejects.toMatchObject({
      reason: 'binding-changed',
    });
    expect(endpoint.requests.filter((r) => r.rpc === 'tools/call')).toHaveLength(0);
    // Listed again under the new name, the tools it lists run.
    const after = await pool.toolProvider().list(listCtx(alice));
    await expect(named(after, 'status').execute({}, callCtx(alice))).resolves.toContain('status@');
    expect(calls(endpoint, 'refund')).toHaveLength(0);
    await pool.close();
  });

  it('the version moving while a call waits for its credential: refused at the send gate once it arrives — nothing sent', async () => {
    const state = { version: 1 };
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
      definitions: {
        share: () => ({
          configuration: 'same-server',
          authorization: `role@policy-${state.version}`,
        }),
      },
    });
    const alice = id('alice', 'a');
    const [refund] = await pool.toolProvider().list(listCtx(alice));
    vend.stall();
    const call = refund!.execute({}, callCtx(alice)).catch((error: unknown) => error);
    await flush();
    expect(vend.waiting).toBe(1);
    state.version = 2;
    vend.releaseAll();
    expect(await call).toMatchObject({ reason: 'binding-changed' });
    expect(endpoint.requests.filter((r) => r.rpc === 'tools/call')).toHaveLength(0);
    await pool.close();
  });

  it('a call asks again BEFORE any work on its client: a tool bound under the old answer is refused before the replacement lists anything', async () => {
    const state = { shared: false };
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, {
      definitions: {
        share: () =>
          state.shared
            ? { configuration: 'same-server', authorization: 'role@policy-1' }
            : undefined,
      },
    });
    const alice = id('alice', 'a');
    const [status] = await pool.toolProvider().list(listCtx(alice));
    // The client is replaced — the next one opened, never listed — and then the
    // app's answer changes.
    await pool.terminate({ principal: 'alice', conversationId: 'a' });
    (await pool.acquire(alice)).release();
    const listsBefore = lists(endpoint).length;
    state.shared = true;
    await expect(status!.execute({}, callCtx(alice))).rejects.toMatchObject({
      reason: 'binding-changed',
    });
    // Refused before the replacement listed anything to revalidate against.
    expect(lists(endpoint)).toHaveLength(listsBefore);
    expect(endpoint.requests.filter((r) => r.rpc === 'tools/call')).toHaveLength(0);
    await pool.close();
  });

  it('a share that throws when asked again refuses that listing and that call (binding-changed, its error as cause) — never the old list', async () => {
    const state = { fail: false };
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, {
      definitions: {
        share: () => {
          if (state.fail) throw new Error('policy service unavailable');
          return { configuration: 'same-server', authorization: 'role@policy-1' };
        },
      },
    });
    const alice = id('alice', 'a');
    const [status] = await pool.toolProvider().list(listCtx(alice));
    state.fail = true;
    const listed = await pool
      .toolProvider()
      .list(listCtx(alice))
      .catch((error: unknown) => error);
    expect(listed).toMatchObject({ name: 'McpPoolRefusedError', reason: 'binding-changed' });
    expect((listed as Error).cause).toMatchObject({ message: 'policy service unavailable' });
    await expect(status!.execute({}, callCtx(alice))).rejects.toMatchObject({
      reason: 'binding-changed',
    });
    expect(endpoint.requests.filter((r) => r.rpc === 'tools/call')).toHaveLength(0);
    await pool.close();
  });
});

describe('a discovered list is kept and served only under the authorization it was listed for', () => {
  const alice = id('alice', 'a');
  const bob = id('bob', 'b');
  const names = (tools: readonly Tool[]) => tools.map((t) => t.schema.name);
  const toolLists = (endpoint: ReturnType<typeof fakeEndpoint>) =>
    endpoint.requests.filter((r) => r.rpc === 'tools/list');

  /**
   * Alice and Bob share a declared context while both are readers. The server
   * shows Alice's session `refund` only while she is an admin — decided when it
   * answers. `share` names each principal's role.
   */
  function roles() {
    const state = { alice: 'reader', bob: 'reader' };
    let aliceSession: string | undefined;
    const endpoint = fakeEndpoint({
      toolsFor: (session) => {
        aliceSession ??= session;
        const role = session === aliceSession ? state.alice : state.bob;
        return role === 'admin' ? [{ name: 'status' }, { name: 'refund' }] : [{ name: 'status' }];
      },
    });
    const { pool } = poolOver(endpoint, {
      definitions: {
        share: (identity) => ({
          configuration: 'stable-endpoint',
          authorization: identity.principal === 'alice' ? state.alice : state.bob,
        }),
      },
    });
    return { state, endpoint, pool };
  }

  it('the control — a stable role: Alice, an admin before her discovery, lists as admin; Bob, a reader, gets only status', async () => {
    const { state, endpoint, pool } = roles();
    state.alice = 'admin';
    expect(names(await pool.toolProvider().list(listCtx(alice)))).toEqual(['status', 'refund']);
    expect(names(await pool.toolProvider().list(listCtx(bob)))).toEqual(['status']);
    expect(toolLists(endpoint)).toHaveLength(2);
    await pool.close();
  });

  it.each([
    ['', false],
    [' and the app sends permissionsChanged', true],
  ] as const)(
    'Alice becomes an admin while her discovery waits%s: the answer is not kept under reader, so Bob — still a reader — never receives refund',
    async (_also, invalidate) => {
      const { state, endpoint, pool } = roles();
      const held = endpoint.hold((r) => r.rpc === 'tools/list');
      const discovery = pool.toolProvider().list(listCtx(alice));
      for (let i = 0; i < 50 && held.held === 0; i += 1) await flush(1);
      expect(held.held).toBe(1);
      state.alice = 'admin';
      if (invalidate) pool.permissionsChanged({ principal: 'alice' });
      held.release();
      // Alice is served under what she is now.
      expect(names(await discovery)).toEqual(['status', 'refund']);
      // Bob is served under reader — never Alice's admin answer.
      expect(names(await pool.toolProvider().list(listCtx(bob)))).toEqual(['status']);
      await pool.close();
    },
  );

  it('Alice is demoted while her client opens, and the admin list is kept meanwhile: she is served under reader, never that list', async () => {
    const state = { alice: 'admin', carol: 'admin' };
    const sessionOf = new Map<string, 'alice' | 'carol'>();
    const endpoint = fakeEndpoint({
      toolsFor: (session) => {
        const role = sessionOf.get(session) === 'alice' ? state.alice : state.carol;
        return role === 'admin' ? [{ name: 'status' }, { name: 'refund' }] : [{ name: 'status' }];
      },
    });
    const { pool } = poolOver(endpoint, {
      transport: (identity) => ({
        transport: 'http',
        url: endpoint.url,
        fetch: async (input: string | URL | Request, init?: RequestInit) => {
          const response = await endpoint.fetch(input, init);
          const session = response.headers.get('mcp-session-id');
          if (session !== null) sessionOf.set(session, identity.principal as 'alice' | 'carol');
          return response;
        },
      }),
      definitions: {
        share: (identity) => ({
          configuration: 'stable-endpoint',
          authorization: identity.principal === 'alice' ? state.alice : state.carol,
        }),
      },
    });
    // Alice, an admin when she starts, finds nothing kept: her client opens,
    // and its open is held.
    let opens = 0;
    const opening = endpoint.hold((r) => r.rpc === 'initialize' && (opens += 1) === 1);
    const discovery = pool.toolProvider().list(listCtx(alice));
    for (let i = 0; i < 50 && opening.held === 0; i += 1) await flush(1);
    expect(opening.held).toBe(1);
    // Meanwhile Carol, an admin, has the admin list kept — and Alice is demoted.
    expect(names(await pool.toolProvider().list(listCtx(id('carol', 'c'))))).toEqual([
      'status',
      'refund',
    ]);
    state.alice = 'reader';
    opening.release();
    expect(names(await discovery)).toEqual(['status']);
    await pool.close();
  });

  it('Bob, joined to a listing under way, is demoted while he waits: checked again after the join, he is served under reader', async () => {
    const { state, endpoint, pool } = roles();
    state.alice = 'admin';
    state.bob = 'admin';
    const held = endpoint.hold((r) => r.rpc === 'tools/list');
    const aliceDiscovery = pool.toolProvider().list(listCtx(alice));
    for (let i = 0; i < 50 && held.held === 0; i += 1) await flush(1);
    // Bob shares Alice's context: he joins her listing rather than list himself.
    const bobDiscovery = pool.toolProvider().list(listCtx(bob));
    await flush();
    state.bob = 'reader';
    held.release();
    expect(names(await aliceDiscovery)).toEqual(['status', 'refund']);
    expect(names(await bobDiscovery)).toEqual(['status']);
    await pool.close();
  });

  it('Alice becomes an admin while her listing waits for its credential: the tools/list is refused at the send gate, never sent under reader; the next is sent under admin, and reader keeps nothing of it', async () => {
    const state = { alice: 'reader', bob: 'reader' };
    const seen: { aliceSession?: string } = {};
    const endpoint = fakeEndpoint({
      toolsFor: (session) => {
        const role = session === seen.aliceSession ? state.alice : state.bob;
        return role === 'admin' ? [{ name: 'status' }, { name: 'refund' }] : [{ name: 'status' }];
      },
    });
    const vend = stallingProvider();
    const { pool } = poolOver(endpoint, {
      transport: () => ({
        transport: 'gateway',
        url: endpoint.url,
        credentials: vend.provider,
        service: 'orders',
        fetch: endpoint.fetch,
      }),
      definitions: {
        share: (identity) => ({
          configuration: 'stable-endpoint',
          authorization: identity.principal === 'alice' ? state.alice : state.bob,
        }),
      },
    });
    (await pool.acquire(alice)).release();
    seen.aliceSession = endpoint.sessions()[0];
    vend.stall();
    const discovery = pool.toolProvider().list(listCtx(alice));
    for (let i = 0; i < 50 && vend.waiting === 0; i += 1) await flush(1);
    expect(vend.waiting).toBe(1);
    state.alice = 'admin';
    vend.releaseAll();
    expect(names(await discovery)).toEqual(['status', 'refund']);
    // Only the listing under admin reached the server.
    expect(toolLists(endpoint)).toHaveLength(1);
    // Reader holds nothing of it: Bob lists for himself, and gets only status.
    expect(names(await pool.toolProvider().list(listCtx(bob)))).toEqual(['status']);
    expect(toolLists(endpoint)).toHaveLength(2);
    await pool.close();
  });
});
