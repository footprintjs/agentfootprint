/**
 * 97 — An MCP server hosted on AgentCore Runtime: `agentCoreRuntimeMcpTransport`.
 *
 * A server deployed to AWS Bedrock AgentCore Runtime with `--protocol MCP` is
 * not a plain URL. Every request goes through `InvokeAgentRuntime`, lands in a
 * runtime session the client must carry, and — while that session is being set
 * up — may come back as an HTTP 200 whose JSON-RPC body says
 * `-32005 "Session operation in progress, please retry"`, which MCP clients do
 * not retry. The transport carries the session, retries exactly that refusal,
 * and hands `mcpClient` an ordinary Streamable HTTP server.
 *
 * Nothing leaves the process: the AWS SDK is replaced by a stand-in runtime
 * that speaks MCP's JSON-RPC and refuses the first tool call as "busy".
 *
 * Run:  npm run example examples/features/97-agentcore-runtime-mcp.ts
 */
import assert from 'node:assert/strict';
import { Agent, type LLMProvider } from '../../src/index.js';
import { agentCoreRuntimeMcpTransport, mcpClient, mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/97-agentcore-runtime-mcp',
  title: 'MCP server hosted on AgentCore Runtime',
  group: 'features',
  description:
    'mcpClient over agentCoreRuntimeMcpTransport: one runtime session carried across calls, and the runtime’s "session operation in progress" refusal retried instead of reaching the model as a failed tool.',
  defaultInput: 'Where is order 7712?',
  providerSlots: ['default'],
  tags: ['features', 'mcp', 'aws', 'agentcore', 'runtime', 'peer-dep'],
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
      // session: 'reuse' (default) — one runtime session for this client.
      retry: { onRetry: ({ attempt }) => retries.push(attempt) },
      _sdk: runtime.sdk, // ← drop this line to call the real runtime with SigV4
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
  assert.equal(new Set(runtime.seen.map((s) => s.runtimeSessionId)).size, 1);
  assert.equal(new Set(runtime.seen.slice(1).map((s) => s.mcpSessionId)).size, 1);
  return { answer, retries, requests: runtime.seen.length };
}

/**
 * A stand-in for `@aws-sdk/client-bedrock-agentcore`: `send(InvokeAgentRuntimeCommand)`
 * answers MCP's JSON-RPC the way a hosted server would, behind a platform that
 * mints the `Mcp-Session-Id` and refuses the FIRST tool call as busy.
 */
function standInRuntime() {
  const seen: { mcpSessionId?: string; runtimeSessionId?: string }[] = [];
  let refusedOnce = false;
  const json = (body: unknown, mcpSessionId: string) => ({
    statusCode: 200,
    contentType: 'application/json',
    mcpSessionId,
    response: { transformToByteArray: async () => new TextEncoder().encode(JSON.stringify(body)) },
  });
  const sdk = {
    InvokeAgentRuntimeCommand: class {
      constructor(readonly input: unknown) {}
    },
    BedrockAgentCoreClient: class {
      async send(command: unknown) {
        const { payload, mcpSessionId, runtimeSessionId } = (command as { input: unknown })
          .input as {
          payload: Uint8Array;
          mcpSessionId?: string;
          runtimeSessionId?: string;
        };
        seen.push({ mcpSessionId, runtimeSessionId });
        const session = mcpSessionId ?? 'mcp-session-1';
        const rpc = JSON.parse(new TextDecoder().decode(payload)) as {
          id?: number;
          method: string;
          params?: { protocolVersion?: string; arguments?: { id?: string } };
        };
        switch (rpc.method) {
          case 'initialize':
            return json(
              {
                jsonrpc: '2.0',
                id: rpc.id,
                result: {
                  protocolVersion: rpc.params?.protocolVersion,
                  capabilities: { tools: {} },
                  serverInfo: { name: 'orders', version: '1.0.0' },
                },
              },
              session,
            );
          case 'tools/list':
            return json(
              {
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
              },
              session,
            );
          case 'tools/call':
            if (!refusedOnce) {
              refusedOnce = true;
              return json(
                {
                  jsonrpc: '2.0',
                  id: rpc.id,
                  error: { code: -32005, message: 'Session operation in progress, please retry' },
                },
                session,
              );
            }
            return json(
              {
                jsonrpc: '2.0',
                id: rpc.id,
                result: {
                  content: [{ type: 'text', text: `order ${rpc.params?.arguments?.id}: shipped` }],
                },
              },
              session,
            );
          default:
            // A notification: accepted, no body.
            return { statusCode: 202, mcpSessionId: session };
        }
      }
    },
  };
  return { sdk, seen };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
