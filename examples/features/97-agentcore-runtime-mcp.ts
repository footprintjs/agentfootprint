/**
 * 97 — An MCP server hosted on AgentCore Runtime: `agentCoreRuntimeMcpTransport`.
 *
 * A server deployed to AWS Bedrock AgentCore Runtime with `--protocol MCP` is
 * not a plain URL. Every request lands in a runtime session the client must
 * carry, and — while that session is being set up — may come back as an HTTP
 * 200 whose JSON-RPC body says `-32005 "Session operation in progress, please
 * retry"`, which MCP clients do not retry. The transport carries the session,
 * retries exactly that refusal, and hands `mcpClient` an ordinary Streamable
 * HTTP server.
 *
 * Nothing leaves the process: the runtime's HTTPS endpoint is a stand-in
 * `fetch` that speaks MCP's JSON-RPC and refuses the first tool call as "busy".
 * Pass your own credential provider (e.g. `agentCoreIdentity()`, with its
 * `service`) and drop the stand-in, and the same code reaches a real runtime
 * with OAuth inbound auth; omit `auth` altogether for IAM (SigV4 through the
 * AWS SDK).
 *
 * Run:  npm run example examples/features/97-agentcore-runtime-mcp.ts
 */
import assert from 'node:assert/strict';
import { Agent, type LLMProvider } from '../../src/index.js';
import { agentCoreRuntimeMcpTransport, mcpClient, mock } from '../../src/doors/providers.js';
import { staticTokens } from '../../src/doors/security.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/97-agentcore-runtime-mcp',
  title: 'MCP server hosted on AgentCore Runtime',
  group: 'features',
  description:
    'mcpClient over agentCoreRuntimeMcpTransport: one runtime session carried across calls, and the runtime’s "session operation in progress" refusal retried instead of reaching the model as a failed tool.',
  defaultInput: 'Where is order 7712?',
  providerSlots: ['default'],
  tags: ['features', 'mcp', 'aws', 'agentcore', 'runtime'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const runtime = standInRuntime();
  const retries: number[] = [];

  // #region transport
  const orders = await mcpClient({
    name: 'orders',
    transport: agentCoreRuntimeMcpTransport({
      agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders_mcp-a1b2c3',
      region: 'us-west-2',
      // OAuth inbound auth: a bearer token, vended per request and dropped.
      // `service` is what your CredentialProvider keys on — for
      // agentCoreIdentity(), the name of your OAuth2 credential provider.
      // Omit `auth` entirely for IAM: SigV4 through the AWS SDK.
      auth: {
        // For a real runtime: your own provider (e.g. agentCoreIdentity()) here,
        bearer: staticTokens({ 'orders-oauth': 'demo-token' }),
        service: 'orders-oauth',
        fetch: runtime.fetch, // ← and drop this stand-in endpoint
      },
      // ONE runtime session for this client — so build a client per
      // conversation. The default, 'per-call', gives every request a session of
      // its own: nothing carries over, and one client can serve every user.
      session: 'reuse',
      retry: { onRetry: ({ attempt }) => retries.push(attempt) },
    }),
  });
  // #endregion transport

  const agent = Agent.create({
    provider:
      provider ??
      mock({
        chunkDelayMs: 0,
        respond: (req) =>
          req.messages.some((m) => m.role === 'tool')
            ? { content: 'Order 7712 shipped yesterday.' }
            : { toolCalls: [{ id: 'c1', name: 'lookup_order', args: { id: '7712' } }] },
      }),
    model: 'mock',
    maxIterations: 4,
  })
    .system('You look orders up with the tools you have.')
    .tools([...(await orders.tools())])
    .build();

  const answer = await agent.run({ message: input });
  await orders.close();

  // The refusal was retried once, inside the tool call — the model never saw it.
  assert.deepEqual(retries, [2]);
  // ONE runtime session id on every request, and the MCP session the runtime
  // minted at `initialize` carried by every request after it.
  const posts = runtime.seen.filter((s) => s.method === 'POST');
  assert.equal(new Set(posts.map((s) => s.runtimeSessionId)).size, 1);
  assert.ok(posts[0]?.runtimeSessionId);
  assert.equal(new Set(posts.slice(1).map((s) => s.mcpSessionId)).size, 1);
  // The token went on the wire — and only there.
  assert.ok(posts.every((s) => s.authorization === 'Bearer demo-token'));
  return { answer, retries, requests: posts.length };
}

interface Seen {
  readonly method: string;
  readonly mcpSessionId: string | null;
  readonly runtimeSessionId: string | null;
  readonly authorization: string | null;
}

/**
 * A stand-in for the runtime's HTTPS endpoint: answers MCP's JSON-RPC the way a
 * hosted server would, behind a platform that mints the `Mcp-Session-Id` and
 * refuses the FIRST tool call as busy.
 */
function standInRuntime() {
  const seen: Seen[] = [];
  let refusedOnce = false;
  const fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const method = (init?.method ?? 'GET').toUpperCase();
    seen.push({
      method,
      mcpSessionId: headers.get('mcp-session-id'),
      runtimeSessionId: headers.get('x-amzn-bedrock-agentcore-runtime-session-id'),
      authorization: headers.get('authorization'),
    });
    if (method !== 'POST') return new Response(null, { status: 405 });
    const session = headers.get('mcp-session-id') ?? 'mcp-session-1';
    const reply = (body: unknown) =>
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json', 'mcp-session-id': session },
      });
    const rpc = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: { protocolVersion?: string; arguments?: { id?: string } };
    };
    switch (rpc.method) {
      case 'initialize':
        return reply({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            protocolVersion: rpc.params?.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'orders', version: '1.0.0' },
          },
        });
      case 'tools/list':
        return reply({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            tools: [
              {
                name: 'lookup_order',
                description: 'Look an order up by id.',
                inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
              },
            ],
          },
        });
      case 'tools/call':
        if (!refusedOnce) {
          refusedOnce = true;
          return reply({
            jsonrpc: '2.0',
            id: rpc.id,
            error: { code: -32005, message: 'Session operation in progress, please retry' },
          });
        }
        return reply({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            content: [{ type: 'text', text: `order ${rpc.params?.arguments?.id}: shipped` }],
          },
        });
      default:
        // A notification: accepted, no body.
        return new Response(null, { status: 202, headers: { 'mcp-session-id': session } });
    }
  };
  return { fetch, seen };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
