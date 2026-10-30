/**
 * 120 — A client per conversation: `mcpClientPool`.
 *
 * A `'reuse'` session keeps a server's state warm for one conversation — but
 * only if every conversation has an MCP client of its own, opened once,
 * bounded, never closed while a call is in flight, and ended remotely when the
 * conversation is over. The pool does all of that for one server:
 *
 *   - one client per authenticated conversation, keyed by the identity the
 *     CALLER named in `run({ identity })`;
 *   - tool lists per client by default, shared only under names you declare;
 *   - three budgets — clients, endings, outstanding operations — refused at
 *     once with `PoolFullError` when full, never queued;
 *   - `terminate()` ends the remote session and says what the server answered.
 *
 * Nothing leaves the process: the server is a stand-in `fetch` that speaks MCP
 * over Streamable HTTP, issues a session per client, and answers each
 * session's `DELETE` the way a server would.
 *
 * Run:  npm run example examples/features/120-mcp-client-pool.ts
 */
import assert from 'node:assert/strict';
import { Agent, type LLMProvider } from '../../src/index.js';
import {
  mcpClientPool,
  mock,
  PoolFullError,
  type McpPoolReport,
} from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/120-mcp-client-pool',
  title: 'A client per conversation — mcpClientPool',
  group: 'features',
  description:
    'mcpClientPool: one MCP client per authenticated conversation, per-client tool lists unless you declare a share, bounded clients/endings/operations with PoolFullError, and terminate() that reports what the server answered.',
  defaultInput: 'Where is order 7712?',
  providerSlots: ['default'],
  tags: ['features', 'mcp', 'sessions', 'pool'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const server = standInServer();
  const reports: McpPoolReport[] = [];

  // #region pool
  const orders = mcpClientPool({
    name: 'orders',
    // Called once per client, with the identity it is for: a transport (and a
    // session) of its own for every conversation.
    transport: () => ({
      transport: 'http',
      url: 'https://orders.example/mcp',
      fetch: server.fetch,
    }),
    maxClients: 8,
    maxClientsPerPrincipal: 4,
    onEvent: (report) => reports.push(report),
  });
  // #endregion pool

  // #region agent
  const agent = Agent.create({
    provider:
      provider ??
      mock({
        chunkDelayMs: 0,
        respond: (req) =>
          req.messages.some((m) => m.role === 'tool')
            ? { content: 'Order 7712 shipped yesterday.' }
            : { toolCalls: [{ id: 'call-1', name: 'order_status', args: { id: '7712' } }] },
      }),
    model: 'mock',
    maxIterations: 4,
  })
    .system('You look orders up with the tools you have.')
    .toolProvider(orders.toolProvider())
    .build();

  const uses: string[] = [];
  agent.on('agentfootprint.tools.mcp_client', (event) =>
    uses.push(`${event.payload.at}:${event.payload.client}`),
  );
  // Two principals, two conversations each: four clients, four sessions.
  for (const principal of ['alice', 'bob']) {
    for (const conversationId of ['c1', 'c2']) {
      await agent.run({ message: input, identity: { tenant: 'acme', principal, conversationId } });
    }
  }
  // #endregion agent
  assert.equal(server.sessions(), 4);
  // Per client by default: each conversation listed its own client's tools.
  assert.equal(server.count('tools/list'), 4);
  assert.ok(uses.includes('list:opened') && uses.includes('call:reused'));

  // #region share
  const shared = mcpClientPool({
    name: 'orders',
    transport: () => ({
      transport: 'http',
      url: 'https://orders.example/mcp',
      fetch: server.fetch,
    }),
    // You vouch that every analyst's list is the same on this deployment.
    definitions: {
      share: () => ({ configuration: 'orders-runtime@v7', authorization: 'analyst@policy-3' }),
    },
  });
  const before = server.count('tools/list');
  for (const conversationId of ['s1', 's2']) {
    const lease = await shared.acquire({ tenant: 'acme', principal: 'carol', conversationId });
    await lease.tools();
    lease.release();
  }
  // #endregion share
  // Declared and checked: the second conversation was served the first's list.
  assert.equal(server.count('tools/list') - before, 1);

  // #region full
  const small = mcpClientPool({
    name: 'orders',
    transport: () => ({
      transport: 'http',
      url: 'https://orders.example/mcp',
      fetch: server.fetch,
    }),
    maxClients: 2,
    maxEnding: 1,
  });
  const a = await small.acquire({ tenant: 'acme', principal: 'dave', conversationId: 'd1' });
  const b = await small.acquire({ tenant: 'acme', principal: 'erin', conversationId: 'e1' });
  // Both clients are in use: a third conversation is refused at once.
  const full = await small
    .acquire({ tenant: 'acme', principal: 'fay', conversationId: 'f1' })
    .catch((error: unknown) => error);
  assert.ok(full instanceof PoolFullError && full.limit === 'pool');
  // #endregion full

  // #region ending
  // One ending at a time (maxEnding: 1). Dave's idle client is evicted to make
  // room for Gus — and its DELETE is slow, so it holds the one ending slot.
  const releaseDeletes = server.holdDeletes();
  a.release();
  const gus = await small.acquire({ tenant: 'acme', principal: 'gus', conversationId: 'g1' });
  b.release();
  // Making room for Hal needs a second ending: refused at once, never queued.
  const refused = await small
    .acquire({ tenant: 'acme', principal: 'hal', conversationId: 'h1' })
    .catch((error: unknown) => error);
  assert.ok(refused instanceof PoolFullError && refused.limit === 'ending');
  // Once Dave's ending has settled, its slot is free and Hal gets room.
  releaseDeletes();
  await small.settled();
  const hal = await small.acquire({ tenant: 'acme', principal: 'hal', conversationId: 'h1' });
  gus.release();
  hal.release();
  await small.close();
  // #endregion ending

  // #region terminate
  // A conversation ended: its remote session is ended, and the answer reported.
  server.refuseDeletes(true); // this server does not end sessions on request
  const [notOffered] = await orders.terminate({ tenant: 'acme', principal: 'bob' });
  server.refuseDeletes(false);
  const [terminated] = await orders.terminate({
    tenant: 'acme',
    principal: 'alice',
    conversationId: 'c1',
  });
  // #endregion terminate
  assert.equal(notOffered?.remote, 'not-offered');
  assert.equal(notOffered?.resolved, false);
  assert.equal(terminated?.remote, 'terminated');
  assert.equal(terminated?.resolved, true);
  assert.ok(orders.stats().unresolvedEndings >= 1);
  await Promise.all([orders.close(), shared.close()]);

  return {
    sessions: server.sessions(),
    uses,
    outcomes: { notOffered: notOffered?.remote, terminated: terminated?.remote },
    ended: reports.filter((r) => r.kind === 'ended').length,
  };
}

/**
 * A stand-in MCP server over Streamable HTTP: a session per `initialize`, one
 * tool, and a `DELETE` answered 200 — or 405 when it refuses to end sessions,
 * or held until released.
 */
function standInServer() {
  const live = new Set<string>();
  const counts = new Map<string, number>();
  let opened = 0;
  let refuse = false;
  let held: Promise<void> | undefined;
  const json = (body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json', ...headers },
    });
  const fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const session = new Headers(init?.headers).get('mcp-session-id');
    if (method === 'GET') return new Response(null, { status: 405 });
    if (method === 'DELETE') {
      if (refuse) return new Response(null, { status: 405 });
      if (held !== undefined) await held;
      if (session !== null) live.delete(session);
      return new Response(null, { status: 200 });
    }
    const rpc = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: { protocolVersion?: string };
    };
    counts.set(rpc.method, (counts.get(rpc.method) ?? 0) + 1);
    switch (rpc.method) {
      case 'initialize': {
        const id = `session-${(opened += 1)}`;
        live.add(id);
        return json(
          {
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              protocolVersion: rpc.params?.protocolVersion ?? '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'orders', version: '1.0.0' },
            },
          },
          { 'mcp-session-id': id },
        );
      }
      case 'tools/list':
        return json({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            tools: [
              {
                name: 'order_status',
                description: 'Where an order is',
                inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
              },
            ],
          },
        });
      case 'tools/call':
        return json({
          jsonrpc: '2.0',
          id: rpc.id,
          result: { content: [{ type: 'text', text: 'shipped yesterday' }] },
        });
      default:
        return new Response(null, { status: 202 });
    }
  };
  return {
    fetch,
    sessions: (): number => opened,
    count: (rpc: string): number => counts.get(rpc) ?? 0,
    refuseDeletes: (on: boolean): void => {
      refuse = on;
    },
    /** Hold every DELETE until the returned function is called. */
    holdDeletes: (): (() => void) => {
      let release!: () => void;
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        held = undefined;
        release();
      };
    },
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
