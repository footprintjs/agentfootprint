/**
 * agentCoreRuntimeMcpTransport — an MCP server hosted on AgentCore Runtime.
 *
 *   P1 Unit         — the URL, the option refusals, the retry decision's match
 *   P2 Boundary     — header ↔ SDK field mapping, both directions; POST-only;
 *                     null-body statuses; the stream kept streaming
 *   P3 Scenario     — the REAL MCP client through `mcpClient`, a fake runtime
 *                     platform, and a REAL MCP server behind it: busy refusals
 *                     retried, sessions carried (SigV4 and bearer)
 *   P4 Property     — THE BOUNDARY: only the contract's refusal is retried —
 *                     not ConflictException, not another code, not a 5xx
 *   P5 Security     — the bearer token is vended per attempt and reaches no
 *                     report; a refused strategy echoes no secret
 *   P6 Performance  — a reply that is not the refusal costs one attempt and no
 *                     body read beyond the clone's gate
 *   P7 ROI          — `retry: false`; mcpClient's own 429 retry still wraps it
 *
 * Nothing here reaches AWS: the SDK is a fake module, the HTTPS endpoint a fake
 * fetch, and the server behind both is built from the MCP SDK itself.
 */

import { describe, expect, it } from 'vitest';

import { mcpClient } from '../../src/tool-providers/index.js';
import {
  agentCoreRuntimeMcpTransport,
  agentCoreRuntimeUrl,
} from '../../src/adapters/mcp/agentcoreRuntime/transport.js';
import {
  isSessionBusyReply,
  sessionBusy,
} from '../../src/adapters/mcp/agentcoreRuntime/sessionBusy.js';
import { AGENTCORE_RUNTIME_SESSION_HEADER } from '../../src/adapters/mcp/agentcoreRuntime/session.js';
import { staticTokens } from '../../src/identity/staticTokens.js';
import type { ThrottleRetryInfo } from '../../src/mcp/throttleRetry.js';
import type { Tool } from '../../src/tools/tools.js';
import { fakeAgentCoreRuntime, type FakeRuntime } from './fixtures/fakeAgentCoreRuntime.js';

const ARN = 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders_mcp-a1b2c3';
const REGION = 'us-west-2';
const BUSY = { code: -32005, message: 'Session operation in progress, please retry' };

/** A JSON-RPC reply as the platform sends it. */
function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Call one listed tool the way the agent loop would. */
async function callTool(tools: readonly Tool[], name: string, args: unknown): Promise<unknown> {
  const tool = tools.find((t) => t.schema.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.execute(args, {} as never);
}

function lookupRuntime(busy = 0, jsonResponses = false): FakeRuntime {
  return fakeAgentCoreRuntime({
    tools: [{ name: 'lookup', answer: (args) => `order ${String(args['id'])}: shipped` }],
    busyCalls: { lookup: busy },
    jsonResponses,
  });
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('agentCoreRuntimeMcpTransport — P1 unit', () => {
  it('P1 the URL is the InvokeAgentRuntime request line, ARN encoded', () => {
    expect(agentCoreRuntimeUrl({ agentRuntimeArn: ARN, region: REGION })).toBe(
      'https://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/' +
        'arn%3Aaws%3Abedrock-agentcore%3Aus-west-2%3A123456789012%3Aruntime%2Forders_mcp-a1b2c3' +
        '/invocations',
    );
  });

  it('P1 qualifier and accountId ride the query string', () => {
    const url = new URL(
      agentCoreRuntimeUrl({
        agentRuntimeArn: 'orders_mcp-a1b2c3',
        region: REGION,
        qualifier: 'DEFAULT',
        accountId: '123456789012',
      }),
    );
    expect(url.searchParams.get('qualifier')).toBe('DEFAULT');
    expect(url.searchParams.get('accountId')).toBe('123456789012');
  });

  it('P1 refuses half an address, and a region that is not shaped like one', () => {
    expect(() => agentCoreRuntimeUrl({ agentRuntimeArn: '', region: REGION })).toThrow(/both/);
    expect(() => agentCoreRuntimeUrl({ agentRuntimeArn: ARN, region: '' })).toThrow(/both/);
    // It is spliced into a hostname, so a dot or a slash is refused by name.
    expect(() => agentCoreRuntimeUrl({ agentRuntimeArn: ARN, region: 'evil.example/x' })).toThrow(
      /not a region name/,
    );
  });

  it('P1 an unknown session or auth strategy is refused by name', () => {
    const runtime = lookupRuntime();
    expect(() =>
      agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        session: 'sticky' as never,
        _sdk: runtime.sdk,
      }),
    ).toThrow(/'reuse' or 'per-call'/);
    expect(() =>
      agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        auth: 'iam' as never,
        _sdk: runtime.sdk,
      }),
    ).toThrow(/'sigv4' or \{ bearer/);
  });

  it('P1 `client` beside a bearer is refused — the SDK cannot carry a bearer token', () => {
    expect(() =>
      agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        auth: { bearer: staticTokens({ runtime: 't' }) },
        client: { send: async () => ({}) },
      }),
    ).toThrow(/plain HTTPS/);
  });

  it('P1 a missing SDK command is refused at build, not mid-run', () => {
    expect(() =>
      agentCoreRuntimeMcpTransport({ agentRuntimeArn: ARN, region: REGION, _sdk: {} }),
    ).toThrow(/InvokeAgentRuntimeCommand/);
  });

  it('P1 the decision matches the contract’s refusal and nothing else', () => {
    expect(isSessionBusyReply({ jsonrpc: '2.0', id: 1, error: BUSY })).toBe(true);
    // Same code, the OTHER exception: not retryable.
    expect(
      isSessionBusyReply({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32005, message: 'Resource conflict - Resource already exists' },
      }),
    ).toBe(false);
    // Same message, another code.
    expect(isSessionBusyReply({ jsonrpc: '2.0', id: 1, error: { ...BUSY, code: -32003 } })).toBe(
      false,
    );
    expect(isSessionBusyReply({ jsonrpc: '2.0', id: 1, result: {} })).toBe(false);
    // A batch is never retried whole — some of it may be work that ran.
    expect(isSessionBusyReply([{ jsonrpc: '2.0', id: 1, error: BUSY }])).toBe(false);
    expect(isSessionBusyReply(null)).toBe(false);
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('agentCoreRuntimeMcpTransport — P2 boundary', () => {
  /** A fake SDK that records the command input and answers what it is told. */
  function recordingSdk(answer: Record<string, unknown>) {
    const inputs: Record<string, unknown>[] = [];
    const configs: Record<string, unknown>[] = [];
    const module = {
      InvokeAgentRuntimeCommand: class {
        constructor(readonly input: Record<string, unknown>) {}
      },
      BedrockAgentCoreClient: class {
        constructor(config: Record<string, unknown>) {
          configs.push(config);
        }
        async send(command: { input: Record<string, unknown> }, options?: unknown) {
          inputs.push({ ...command.input, __options: options });
          return answer;
        }
      },
    };
    return { module, inputs, configs };
  }

  it('P2 every request header lands on the SDK field of the same meaning', async () => {
    const sdk = recordingSdk({ statusCode: 200, contentType: 'application/json' });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      qualifier: 'DEFAULT',
      accountId: '123456789012',
      retry: false,
      _sdk: sdk.module,
      _newSessionId: () => 'runtime-session-pinned-0000000000000000',
    });
    await transport.fetch?.(transport.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': 'mcp-7',
        'mcp-protocol-version': '2025-06-18',
      },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    });
    const input = sdk.inputs[0] ?? {};
    expect(input['agentRuntimeArn']).toBe(ARN);
    expect(input['qualifier']).toBe('DEFAULT');
    expect(input['accountId']).toBe('123456789012');
    expect(input['contentType']).toBe('application/json');
    expect(input['accept']).toBe('application/json, text/event-stream');
    expect(input['mcpSessionId']).toBe('mcp-7');
    expect(input['mcpProtocolVersion']).toBe('2025-06-18');
    // The 'reuse' strategy's pinned runtime session — set, never left to the
    // SDK's per-call random default.
    expect(input['runtimeSessionId']).toBe('runtime-session-pinned-0000000000000000');
    expect(new TextDecoder().decode(input['payload'] as Uint8Array)).toBe(
      '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    );
    // The client was built in the transport's region.
    expect(sdk.configs[0]).toEqual({ region: REGION });
  });

  it('P2 every response field lands on the header the MCP client reads', async () => {
    const sdk = recordingSdk({
      statusCode: 200,
      contentType: 'application/json',
      mcpSessionId: 'mcp-from-platform',
      mcpProtocolVersion: '2025-06-18',
      runtimeSessionId: 'rt-1',
      response: { transformToByteArray: async () => new TextEncoder().encode('{"ok":1}') },
    });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      retry: false,
      _sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('mcp-session-id')).toBe('mcp-from-platform');
    expect(res.headers.get('mcp-protocol-version')).toBe('2025-06-18');
    expect(res.headers.get(AGENTCORE_RUNTIME_SESSION_HEADER)).toBe('rt-1');
    expect(await res.text()).toBe('{"ok":1}');
  });

  it('P2 a GET or DELETE is answered 405 here — the operation is POST only', async () => {
    const sdk = recordingSdk({});
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      _sdk: sdk.module,
    });
    const get = (await transport.fetch?.(transport.url, { method: 'GET' })) as Response;
    const del = (await transport.fetch?.(transport.url, { method: 'DELETE' })) as Response;
    expect([get.status, del.status]).toEqual([405, 405]);
    expect(sdk.inputs).toHaveLength(0);
  });

  it('P2 a 202 (an accepted notification) has no body, and the SDK stream is drained', async () => {
    let drained = false;
    const sdk = recordingSdk({
      statusCode: 202,
      response: {
        transformToByteArray: async () => {
          drained = true;
          return new Uint8Array();
        },
      },
    });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      _sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(res.status).toBe(202);
    // 202 may carry a body by the Fetch standard; an absent SDK body stays absent.
    expect(await res.text()).toBe('');
    const sdk204 = recordingSdk({
      statusCode: 204,
      response: {
        transformToByteArray: async () => {
          drained = true;
          return new Uint8Array();
        },
      },
    });
    const t204 = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      _sdk: sdk204.module,
    });
    const res204 = (await t204.fetch?.(t204.url, { method: 'POST', body: '{}' })) as Response;
    expect(res204.status).toBe(204);
    expect(drained).toBe(true);
  });

  it('P2 an SSE reply stays a stream — events reach the client as they arrive', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode(`data: ${pulled}\n\n`));
        if (pulled === 3) controller.close();
      },
    });
    const sdk = recordingSdk({
      statusCode: 200,
      contentType: 'text/event-stream',
      response: { transformToWebStream: () => stream },
    });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      _sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    // Handed over unread: nothing pulled the body except the reader below.
    expect(res.body).toBe(stream);
    expect(await res.text()).toBe('data: 1\n\ndata: 2\n\ndata: 3\n\n');
  });

  it('P2 the abort signal rides to `send`, beside the command, never inside it', async () => {
    const sdk = recordingSdk({ statusCode: 200 });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      _sdk: sdk.module,
    });
    const controller = new AbortController();
    await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
      signal: controller.signal,
    });
    expect(sdk.inputs[0]?.['__options']).toEqual({ abortSignal: controller.signal });
    expect(Object.values(sdk.inputs[0] ?? {})).not.toContain(undefined);
  });

  it('P2 a stream request body is refused by name, never sent empty', async () => {
    const sdk = recordingSdk({ statusCode: 200 });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      retry: false,
      _sdk: sdk.module,
    });
    await expect(
      transport.fetch?.(transport.url, {
        method: 'POST',
        body: new ReadableStream() as unknown as BodyInit,
      }),
    ).rejects.toThrow(/stream or form body/);
    expect(sdk.inputs).toHaveLength(0);
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('agentCoreRuntimeMcpTransport — P3 scenario (real MCP client + real MCP server)', () => {
  it('P3 SigV4: busy twice, then the real tool text — one session throughout', async () => {
    const runtime = lookupRuntime(2);
    const retries: ThrottleRetryInfo[] = [];
    const client = await mcpClient({
      name: 'orders',
      transport: agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        retry: { onRetry: (info) => retries.push(info) },
        _sdk: runtime.sdk,
      }),
    });
    const tools = await client.tools();
    expect(tools.map((t) => t.schema.name)).toEqual(['lookup']);

    expect(await callTool(tools, 'lookup', { id: 'A-1' })).toBe('order A-1: shipped');
    await client.close();

    // Three attempts at the call: two refused, the third served.
    const calls = runtime.calls();
    expect(calls.map((c) => c.refusedBusy)).toEqual([true, true, false]);
    expect(retries.map((r) => r.attempt)).toEqual([2, 3]);
    // ONE session: the runtime id pinned on every request, and the MCP session
    // the platform minted at initialize carried by every later one.
    const runtimeIds = new Set(runtime.attempts.map((a) => a.runtimeSessionId));
    expect(runtimeIds.size).toBe(1);
    expect([...runtimeIds][0]?.length).toBeGreaterThanOrEqual(33);
    const [initialize, ...later] = runtime.attempts;
    expect(initialize?.rpcMethod).toBe('initialize');
    expect(initialize?.mcpSessionId).toBeUndefined();
    expect(new Set(later.map((a) => a.mcpSessionId))).toEqual(new Set(['mcp-session-1']));
    // The protocol version the client negotiated travels in its own field.
    expect(calls.every((c) => typeof c.mcpProtocolVersion === 'string')).toBe(true);
  });

  it('P3 SigV4 with JSON replies: the same outcome', async () => {
    const runtime = lookupRuntime(1, true);
    const client = await mcpClient({
      name: 'orders',
      transport: agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        _sdk: runtime.sdk,
      }),
    });
    const tools = await client.tools();
    expect(await callTool(tools, 'lookup', { id: 'J-9' })).toBe('order J-9: shipped');
    await client.close();
    expect(runtime.calls().map((c) => c.refusedBusy)).toEqual([true, false]);
  });

  it('P3 bearer: the documented HTTPS endpoint, a token per request, the same session rules', async () => {
    const runtime = lookupRuntime(1);
    const client = await mcpClient({
      name: 'orders',
      transport: agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        qualifier: 'DEFAULT',
        auth: { bearer: staticTokens({ runtime: 'tok-runtime' }), fetch: runtime.https },
      }),
    });
    const tools = await client.tools();
    expect(await callTool(tools, 'lookup', { id: 'B-2' })).toBe('order B-2: shipped');
    await client.close();

    const posts = runtime.attempts.filter((a) => a.method === 'POST');
    expect(posts.every((a) => a.via === 'https')).toBe(true);
    expect(posts.every((a) => a.authorization === 'Bearer tok-runtime')).toBe(true);
    expect(posts.every((a) => a.agentRuntimeArn === ARN && a.qualifier === 'DEFAULT')).toBe(true);
    expect(new Set(posts.map((a) => a.runtimeSessionId)).size).toBe(1);
    expect(runtime.calls().map((c) => c.refusedBusy)).toEqual([true, false]);
  });

  it("P3 'per-call': no request carries a session id, so nothing carries over", async () => {
    const runtime = lookupRuntime();
    const client = await mcpClient({
      name: 'orders',
      transport: agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        session: 'per-call',
        _sdk: runtime.sdk,
      }),
    });
    const tools = await client.tools();
    await callTool(tools, 'lookup', { id: '1' });
    await callTool(tools, 'lookup', { id: '2' });
    await client.close();
    expect(runtime.attempts.length).toBeGreaterThanOrEqual(4);
    expect(runtime.attempts.every((a) => a.mcpSessionId === undefined)).toBe(true);
    expect(runtime.attempts.every((a) => a.runtimeSessionId === undefined)).toBe(true);
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('agentCoreRuntimeMcpTransport — P4 property (only the contract’s refusal)', () => {
  /** A transport whose platform answers `replies[n]` on attempt n. */
  function scripted(replies: readonly (() => Response)[]) {
    let calls = 0;
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      retry: { maxAttempts: 5, maxWaitMs: 60_000 },
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async () => (replies[calls++] ?? (() => jsonReply({ result: {} })))(),
      },
    });
    return { transport, calls: () => calls };
  }

  const NOT_RETRIED: Record<string, () => Response> = {
    ConflictException: () =>
      jsonReply({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32005, message: 'Resource conflict - Resource already exists' },
      }),
    'Rate limit (-32003)': () =>
      jsonReply({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32003, message: 'Rate limit exceeded - Too many requests' },
      }),
    'Tool execution error (-32010)': () =>
      jsonReply({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32010, message: 'Tool execution error' },
      }),
    'busy text in a 500': () => jsonReply({ jsonrpc: '2.0', id: 1, error: BUSY }, 500),
    'busy text over SSE': () =>
      new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, error: BUSY })}\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      }),
    'a batch holding the refusal': () => jsonReply([{ jsonrpc: '2.0', id: 1, error: BUSY }]),
    'not JSON at all': () =>
      new Response('-32005 Session operation in progress', {
        headers: { 'content-type': 'application/json' },
      }),
  };

  it.each(Object.entries(NOT_RETRIED))(
    'P4 %s is delivered on the first attempt',
    async (_, reply) => {
      const { transport, calls } = scripted([reply]);
      const res = (await transport.fetch?.(transport.url, {
        method: 'POST',
        body: '{}',
      })) as Response;
      expect(calls()).toBe(1);
      // Delivered INTACT — the decision read a clone.
      expect((await res.text()).length).toBeGreaterThan(0);
    },
  );

  it('P4 the refusal itself is retried, and the reply after it delivered', async () => {
    const busy = () => jsonReply({ jsonrpc: '2.0', id: 1, error: BUSY });
    const { transport, calls } = scripted([busy, busy]);
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(calls()).toBe(3);
    expect(await res.json()).toEqual({ result: {} });
  });

  it('P4 never exceeds maxAttempts — the last refusal is delivered as it is', async () => {
    const busy = () => jsonReply({ jsonrpc: '2.0', id: 1, error: BUSY });
    let calls = 0;
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      retry: { maxAttempts: 3, maxWaitMs: 60_000 },
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async () => {
          calls++;
          return busy();
        },
      },
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(calls).toBe(3);
    expect(await sessionBusy(res)).toEqual({});
  });

  it('P4 a thrown SDK error is not retried here — the SDK already retried what it could', async () => {
    let sends = 0;
    const module = {
      InvokeAgentRuntimeCommand: class {
        constructor(readonly input: unknown) {}
      },
      BedrockAgentCoreClient: class {
        async send() {
          sends++;
          throw Object.assign(new Error('conflict'), { name: 'RetryableConflictException' });
        }
      },
    };
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      _sdk: module,
    });
    await expect(
      transport.fetch?.(transport.url, { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({ name: 'RetryableConflictException' });
    expect(sends).toBe(1);
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('agentCoreRuntimeMcpTransport — P5 security', () => {
  const SECRET = 'SECRET-runtime-token-7f3a';

  it('P5 a fresh token per attempt, and none in any retry report', async () => {
    let vended = 0;
    const seen: string[] = [];
    const retries: ThrottleRetryInfo[] = [];
    const busy = () => jsonReply({ jsonrpc: '2.0', id: 1, error: BUSY });
    const replies = [busy, busy];
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      retry: { onRetry: (info) => retries.push(info) },
      auth: {
        bearer: {
          async getCredential() {
            vended++;
            const token = `${SECRET}-${vended}`;
            return {
              status: 'issued',
              credential: {
                kind: 'bearer',
                toHeaders: () => ({ authorization: `Bearer ${token}` }),
              },
            } as never;
          },
        },
        fetch: async (_input, init) => {
          seen.push(new Headers(init?.headers).get('authorization') ?? '');
          return (replies.shift() ?? (() => jsonReply({ result: {} })))();
        },
      },
    });
    await transport.fetch?.(transport.url, { method: 'POST', body: '{}' });
    // Each attempt vended its own — a token cannot go stale in the wait.
    expect(seen).toEqual([`Bearer ${SECRET}-1`, `Bearer ${SECRET}-2`, `Bearer ${SECRET}-3`]);
    expect(JSON.stringify(retries)).not.toContain(SECRET);
    expect(JSON.stringify(transport)).not.toContain(SECRET);
  });

  it('P5 a refused auth value is described by shape, never echoed', () => {
    let message = '';
    try {
      agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        auth: { token: SECRET } as never,
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/an object with keys \[token\]/);
    expect(message).not.toContain(SECRET);
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('agentCoreRuntimeMcpTransport — P6 performance', () => {
  it('P6 a served reply costs exactly one attempt and no wait', async () => {
    let calls = 0;
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async () => {
          calls++;
          return jsonReply({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
        },
      },
    });
    const started = Date.now();
    await transport.fetch?.(transport.url, { method: 'POST', body: '{}' });
    expect(calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(150);
  });

  it('P6 a large reply without the code is never parsed — the gate is a substring', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { text: 'x'.repeat(2_000_000) } });
    const res = new Response(big, { headers: { 'content-type': 'application/json' } });
    const originalParse = JSON.parse;
    let parsed = 0;
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
      parsed++;
      return originalParse(...args);
    }) as typeof JSON.parse;
    try {
      expect(await sessionBusy(res)).toBeUndefined();
    } finally {
      JSON.parse = originalParse;
    }
    expect(parsed).toBe(0);
    // And the response is still whole for the MCP client.
    expect((await res.text()).length).toBe(big.length);
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('agentCoreRuntimeMcpTransport — P7 ROI', () => {
  it('P7 `retry: false` delivers the refusal on the first attempt', async () => {
    let calls = 0;
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      retry: false,
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async () => {
          calls++;
          return jsonReply({ jsonrpc: '2.0', id: 1, error: BUSY });
        },
      },
    });
    await transport.fetch?.(transport.url, { method: 'POST', body: '{}' });
    expect(calls).toBe(1);
  });

  it('P7 it is an ordinary `http` transport — mcpClient’s 429 retry still wraps it', async () => {
    let calls = 0;
    const throttles: ThrottleRetryInfo[] = [];
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async () => {
          calls++;
          return calls === 1
            ? new Response('{}', { status: 429, headers: { 'retry-after': '0' } })
            : jsonReply({ jsonrpc: '2.0', id: 0, result: {} });
        },
      },
    });
    expect(transport.transport).toBe('http');
    // What mcpClient does with any http transport's fetch:
    const { retryingFetch } = await import('../../src/mcp/throttleRetry.js');
    const outer = retryingFetch(transport.fetch, { onRetry: (i) => throttles.push(i) });
    const res = (await outer?.(transport.url, { method: 'POST', body: '{}' })) as Response;
    expect(res.status).toBe(200);
    expect(throttles).toHaveLength(1);
  });
});
