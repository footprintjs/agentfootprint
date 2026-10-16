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
import {
  AGENTCORE_RUNTIME_SESSION_HEADER,
  MAX_CONNECTIONS,
} from '../../src/adapters/mcp/agentcoreRuntime/session.js';
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
        sdk: runtime.sdk,
      }),
    ).toThrow(/'reuse' or 'per-call'/);
    expect(() =>
      agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        auth: 'iam' as never,
        sdk: runtime.sdk,
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
      agentCoreRuntimeMcpTransport({ agentRuntimeArn: ARN, region: REGION, sdk: {} }),
    ).toThrow(/the `sdk` you passed .* has no `InvokeAgentRuntimeCommand`/);
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

  it('P1 the API-layer form: a 409 is the refusal only when its TYPE says so', async () => {
    const conflict = (type?: string) =>
      new Response('{"message":"x"}', {
        status: 409,
        headers: {
          'content-type': 'application/json',
          ...(type !== undefined && { 'x-amzn-errortype': type }),
        },
      });
    expect(await sessionBusy(conflict('RetryableConflictException'))).toEqual({});
    // The REST protocol's suffix and namespace forms of the same type.
    expect(
      await sessionBusy(conflict('RetryableConflictException:http://internal.amazon.com/coral/')),
    ).toEqual({});
    expect(await sessionBusy(conflict('com.amazonaws#RetryableConflictException'))).toEqual({});
    // A 409 that is another conflict, or that names nothing, is delivered.
    expect(await sessionBusy(conflict('ConflictException'))).toBeUndefined();
    expect(await sessionBusy(conflict())).toBeUndefined();
  });

  it('P1 an explicitly undefined retry field keeps the transport’s default of 5 attempts', async () => {
    let calls = 0;
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      retry: { maxAttempts: undefined, maxWaitMs: 60_000 },
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async () => {
          calls++;
          return jsonReply({ jsonrpc: '2.0', id: 1, error: BUSY });
        },
      },
    });
    await transport.fetch?.(transport.url, { method: 'POST', body: '{}' });
    expect(calls).toBe(5);
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
    const sdk = recordingSdk({
      statusCode: 200,
      contentType: 'application/json',
      mcpSessionId: 'mcp-7',
      response: { transformToByteArray: async () => new TextEncoder().encode('{}') },
    });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      qualifier: 'DEFAULT',
      accountId: '123456789012',
      retry: false,
      session: 'reuse',
      sdk: sdk.module,
    });
    // The connection's first request carries no session; the client is handed
    // the transport's handle for it, and carries that from then on.
    const opened = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    const handle = opened.headers.get('mcp-session-id') ?? '';
    await transport.fetch?.(transport.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': handle,
        'mcp-protocol-version': '2025-06-18',
      },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    });
    const input = sdk.inputs[1] ?? {};
    expect(input['agentRuntimeArn']).toBe(ARN);
    expect(input['qualifier']).toBe('DEFAULT');
    expect(input['accountId']).toBe('123456789012');
    expect(input['contentType']).toBe('application/json');
    expect(input['accept']).toBe('application/json, text/event-stream');
    // The handle is translated back to the server's own session id.
    expect(handle).not.toBe('mcp-7');
    expect(input['mcpSessionId']).toBe('mcp-7');
    expect(input['mcpProtocolVersion']).toBe('2025-06-18');
    // The 'reuse' strategy's runtime session for this connection — the one its
    // first request opened, set, never left to the SDK's per-call default.
    expect(input['runtimeSessionId']).toMatch(/^[0-9a-f-]{36}$/);
    expect(input['runtimeSessionId']).toBe(sdk.inputs[0]?.['runtimeSessionId']);
    expect(new TextDecoder().decode(input['payload'] as Uint8Array)).toBe(
      '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    );
    // The client was built in the transport's region — with the SDK's own retry
    // OFF, so nothing but the transport's one loop can ever re-send a call.
    expect(sdk.configs[0]).toEqual({ region: REGION, maxAttempts: 1 });
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
      session: 'reuse',
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    // The platform's session id is KEPT by the transport; the client carries
    // a handle of the transport's own in its place.
    expect(res.headers.get('mcp-session-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('mcp-session-id')).not.toBe('mcp-from-platform');
    expect(res.headers.get('mcp-protocol-version')).toBe('2025-06-18');
    // The runtime's own session header is not the MCP client's to read.
    expect(res.headers.get(AGENTCORE_RUNTIME_SESSION_HEADER)).toBeNull();
    expect(await res.text()).toBe('{"ok":1}');
  });

  it('P2 a GET or DELETE is answered 405 here — the operation is POST only', async () => {
    const sdk = recordingSdk({});
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
    });
    const get = (await transport.fetch?.(transport.url, { method: 'GET' })) as Response;
    const del = (await transport.fetch?.(transport.url, { method: 'DELETE' })) as Response;
    expect([get.status, del.status]).toEqual([405, 405]);
    expect(sdk.inputs).toHaveLength(0);
  });

  it('P2 a 202 (an accepted notification) with no SDK body is delivered empty', async () => {
    const sdk = recordingSdk({ statusCode: 202 });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('P2 a null-body status (204) drains the SDK stream, so its socket is released', async () => {
    let drained204 = false;
    const sdk = recordingSdk({
      statusCode: 204,
      response: {
        transformToByteArray: async () => {
          drained204 = true;
          return new Uint8Array();
        },
      },
    });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(drained204).toBe(true);
  });

  it("P2 'per-call' hides the platform's Mcp-Session-Id from the MCP client", async () => {
    const sdk = recordingSdk({
      statusCode: 200,
      contentType: 'application/json',
      mcpSessionId: 'mcp-minted-by-platform',
      response: { transformToByteArray: async () => new TextEncoder().encode('{}') },
    });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      session: 'per-call',
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      headers: { 'mcp-session-id': 'held-by-client', [AGENTCORE_RUNTIME_SESSION_HEADER]: 'x' },
      body: '{}',
    })) as Response;
    // Response side: the minted id never reaches the client to be carried...
    expect(res.headers.get('mcp-session-id')).toBeNull();
    expect(await res.text()).toBe('{}');
    // ...and request side: an id the client held anyway is not sent; the
    // runtime session is a fresh one of the transport's own.
    expect(sdk.inputs[0]?.['mcpSessionId']).toBeUndefined();
    expect(typeof sdk.inputs[0]?.['runtimeSessionId']).toBe('string');
    expect(sdk.inputs[0]?.['runtimeSessionId']).not.toBe('x');
  });

  it('P2 an SSE reply stays a stream — events reach the client as they arrive', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(
          new TextEncoder().encode(
            `data: {"jsonrpc":"2.0","method":"n","params":{"i":${pulled}}}\n\n`,
          ),
        );
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
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    // Still a stream: an event is passed on as it arrives, not after the end.
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const event = (i: number) => `data: {"jsonrpc":"2.0","method":"n","params":{"i":${i}}}\n\n`;
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe(event(1));
    expect(pulled).toBeLessThan(3);
    let rest = '';
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      rest += new TextDecoder().decode(next.value);
    }
    expect(rest).toBe(event(2) + event(3));
  });

  it('P2 an SSE error event is rewritten as it passes; the other events byte for byte', async () => {
    const secret = 'SECRET-SESSION-TOKEN-SSE-0001';
    const events =
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n' +
      `event: message\ndata: {"jsonrpc":"2.0","id":4,"error":{"code":-32603,"message":"boom ${secret}","data":"${secret}"}}\n\n`;
    const sdk = recordingSdk({
      statusCode: 200,
      contentType: 'text/event-stream',
      response: { transformToWebStream: () => new Response(events).body },
    });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    const text = await res.text();
    expect(text).not.toContain(secret);
    expect(text.startsWith(events.split('\n\n')[0] as string)).toBe(true);
    expect(text).toContain('"code":-32603');
    expect(text).toContain('"id":4');
  });

  it('P2 the abort signal rides to `send`, beside the command, never inside it', async () => {
    const sdk = recordingSdk({ statusCode: 200 });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
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
      sdk: sdk.module,
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
        session: 'reuse',
        sdk: runtime.sdk,
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
        sdk: runtime.sdk,
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
        session: 'reuse',
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
    expect(posts[0]?.runtimeSessionId).toBeDefined();
    expect(runtime.calls().map((c) => c.refusedBusy)).toEqual([true, false]);
  });

  it("P3 the default, 'per-call': a fresh session per request, so nothing carries over", async () => {
    const runtime = lookupRuntime();
    const client = await mcpClient({
      name: 'orders',
      // No `session` option: the default must be the strategy that is safe to share.
      transport: agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        sdk: runtime.sdk,
      }),
    });
    const tools = await client.tools();
    await callTool(tools, 'lookup', { id: '1' });
    await callTool(tools, 'lookup', { id: '2' });
    await client.close();
    expect(runtime.attempts.length).toBeGreaterThanOrEqual(4);
    expect(runtime.attempts.every((a) => a.mcpSessionId === undefined)).toBe(true);
    // A fresh runtime session per request: no two requests share one.
    const runtimeIds = runtime.attempts.map((a) => a.runtimeSessionId);
    expect(new Set(runtimeIds).size).toBe(runtimeIds.length);
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

  /**
   * A fake SDK whose `send` throws `failures[n]` on call n (as the real SDK does
   * for a non-2xx answer), then answers 200 with an empty JSON-RPC result.
   */
  function throwingSdk(failures: readonly unknown[]) {
    let sends = 0;
    const configs: unknown[] = [];
    const module = {
      InvokeAgentRuntimeCommand: class {
        constructor(readonly input: unknown) {}
      },
      BedrockAgentCoreClient: class {
        constructor(config: unknown) {
          configs.push(config);
        }
        async send() {
          const failure = failures[sends++];
          if (failure !== undefined) throw failure;
          return {
            statusCode: 200,
            contentType: 'application/json',
            response: {
              transformToByteArray: async () =>
                new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"result":{}}'),
            },
          };
        }
      },
    };
    return { module, sends: () => sends, configs };
  }

  /** An SDK service exception, shaped as the real SDK throws one. */
  function serviceException(name: string, status: number, headers: Record<string, string> = {}) {
    return Object.assign(new Error(`${name} from the service`), {
      name,
      $fault: status >= 500 ? 'server' : 'client',
      $metadata: { httpStatusCode: status },
      $response: { statusCode: status, headers },
    });
  }

  it('P4 the API-layer 409 RetryableConflictException is retried like the contract’s refusal', async () => {
    const sdk = throwingSdk([
      serviceException('RetryableConflictException', 409),
      serviceException('RetryableConflictException', 409),
    ]);
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(sdk.sends()).toBe(3);
    expect(res.status).toBe(200);
  });

  it('P4 a 5xx is delivered as its status, sent ONCE — it may be the record of work that ran', async () => {
    const sdk = throwingSdk([serviceException('InternalServerException', 500)]);
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(sdk.sends()).toBe(1);
    expect(res.status).toBe(500);
    expect(res.headers.get('x-amzn-errortype')).toBe('InternalServerException');
    // And the client was built so the SDK could not have re-sent it either.
    expect(sdk.configs[0]).toMatchObject({ maxAttempts: 1 });
  });

  it('P4 a failure with no status (the network) is thrown once, never retried', async () => {
    const reset = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const sdk = throwingSdk([reset]);
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
    });
    await expect(
      transport.fetch?.(transport.url, { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(sdk.sends()).toBe(1);
  });

  it('P4 a 429 is handed on as a 429 with its Retry-After — for mcpClient’s throttle retry', async () => {
    const sdk = throwingSdk([serviceException('ThrottlingException', 429, { 'retry-after': '2' })]);
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    // Not retried HERE — the 429 belongs to the one throttle loop mcpClient wraps around this.
    expect(sdk.sends()).toBe(1);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('2');
  });

  it('P4 a hosted server’s 404 reaches the MCP client as a 404 with ITS JSON-RPC error', async () => {
    // The real SDK spreads a body it cannot model onto the exception as own
    // keys — `jsonrpc`, `id`, `error` — and names it `Unknown` / "UnknownError".
    const notFound = Object.assign(serviceException('Unknown', 404), {
      message: 'UnknownError',
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32001, message: 'Session not found' },
    });
    const sdk = throwingSdk([notFound]);
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(res.status).toBe(404);
    expect(sdk.sends()).toBe(1);
    expect(await res.json()).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32001, message: 'Session not found' },
    });
  });

  it('P4 an AWS error with no JSON-RPC body is handed on as its type and status — never its message', async () => {
    const sdk = throwingSdk([serviceException('ValidationException', 400)]);
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(res.status).toBe(400);
    expect(res.headers.get('x-amzn-errortype')).toBe('ValidationException');
    const { message } = (await res.json()) as { message: string };
    expect(message).toMatch(/^ValidationException \(HTTP 400\)\./);
    expect(message).not.toContain('from the service');
  });

  it.each([
    ['AccessDeniedException', 403],
    ['InvalidSignatureException', 403],
    ['UnrecognizedClientException', 401],
    // Typed as an auth failure though its status is not one.
    ['IncompleteSignatureException', 400],
    // Untyped: the status alone says it.
    ['Unknown', 403],
  ] as const)(
    'P4 an auth failure (%s, %i) is handed on as its type and status — its message withheld',
    async (name, status) => {
      const quoted = Object.assign(serviceException(name, status), {
        message: 'x-amz-security-token:SECRET-SESSION-TOKEN-9a1f',
      });
      const sdk = throwingSdk([quoted]);
      const transport = agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        sdk: sdk.module,
      });
      const res = (await transport.fetch?.(transport.url, {
        method: 'POST',
        body: '{}',
      })) as Response;
      expect(res.status).toBe(status);
      expect(res.headers.get('x-amzn-errortype')).toBe(name);
      const text = await res.text();
      expect(text).not.toContain('SECRET-SESSION-TOKEN');
      expect(JSON.parse(text).message).toMatch(new RegExp(`^${name} \\(HTTP ${status}\\)`));
      expect(sdk.sends()).toBe(1);
    },
  );

  it('P4 a hosted server’s JSON-RPC error keeps its code and id; an unknown message is replaced', async () => {
    const denied = Object.assign(serviceException('Unknown', 403), {
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32001, message: 'Tool not permitted for this caller' },
    });
    const sdk = throwingSdk([denied]);
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: sdk.module,
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(res.status).toBe(403);
    const reply = (await res.json()) as { id: number; error: { code: number; message: string } };
    expect(reply.id).toBe(3);
    expect(reply.error.code).toBe(-32001);
    expect(reply.error.message).toMatch(/^Server error \(JSON-RPC -32001\)/);
    expect(reply.error.message).not.toContain('Tool not permitted');
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

  it('P5 a token passed AS `auth` is described by its length, never echoed', () => {
    let message = '';
    try {
      agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        // The easy mistake from JavaScript: `auth: process.env.RUNTIME_TOKEN`.
        auth: SECRET as never,
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(new RegExp(`a string of ${SECRET.length} characters`));
    expect(message).not.toContain(SECRET);
  });

  it('P5 `bearer` must be a provider, not the token — refused at build, not echoed', () => {
    let message = '';
    try {
      agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        auth: { bearer: SECRET as never },
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/must be a CredentialProvider/);
    expect(message).not.toContain(SECRET);
  });

  it("P5 `mode: 'user'` is refused at build — the transport names no user to vend for", () => {
    let message = '';
    try {
      agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        auth: { bearer: staticTokens({ runtime: SECRET }), mode: 'user' as never },
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/`auth.mode` must be 'machine'/);
    expect(message).toMatch(/for whoever calls through the client/);
    expect(message).not.toContain(SECRET);
    // 'machine', said out loud, is the same as leaving it unset.
    expect(() =>
      agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        auth: { bearer: staticTokens({ runtime: SECRET }), mode: 'machine' },
      }),
    ).not.toThrow();
  });

  it('P5 bearer: a 401/403 from the endpoint reaches the MCP client without its message', async () => {
    const replies: Response[] = [
      new Response(JSON.stringify({ message: `token ${SECRET} rejected` }), {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'x-amzn-errortype': 'UnauthorizedException',
        },
      }),
      new Response(`denied for ${SECRET}`, { status: 403 }),
      // The hosted server's own JSON-RPC error: its code and id are kept, a
      // message the library does not know is not.
      jsonReply(
        { jsonrpc: '2.0', id: 1, error: { code: -32001, message: `not yours ${SECRET}` } },
        403,
      ),
    ];
    const ok = jsonReply({ result: {} });
    replies.push(ok);
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async () => replies.shift() as Response,
      },
    });
    const send = async () =>
      (await transport.fetch?.(transport.url, { method: 'POST', body: '{}' })) as Response;

    const unauthorized = await send();
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('x-amzn-errortype')).toBe('UnauthorizedException');
    expect(await unauthorized.text()).not.toContain(SECRET);

    const forbidden = await send();
    expect(forbidden.status).toBe(403);
    const forbiddenText = await forbidden.text();
    expect(forbiddenText).not.toContain(SECRET);
    expect(JSON.parse(forbiddenText).message).toMatch(/^Request refused \(HTTP 403\)/);

    const rpc = await (await send()).text();
    expect(rpc).not.toContain(SECRET);
    expect(JSON.parse(rpc)).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: -32001 } });
    // A result is handed on as the value it held.
    expect(await (await send()).json()).toEqual({ result: {} });
  });

  it("P5 'reuse': two clients on ONE transport are two runtime sessions, never one", async () => {
    const runtime = lookupRuntime();
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      session: 'reuse',
      sdk: runtime.sdk,
    });
    // Interleaved, as two conversations sharing a process would be.
    const alice = await mcpClient({ name: 'orders', transport });
    const bob = await mcpClient({ name: 'orders', transport });
    const aliceTools = await alice.tools();
    const bobTools = await bob.tools();
    await callTool(aliceTools, 'lookup', { id: 'A' });
    await callTool(bobTools, 'lookup', { id: 'B' });
    await callTool(aliceTools, 'lookup', { id: 'A2' });
    await alice.close();
    await bob.close();

    // Each MCP session the platform minted maps to exactly ONE runtime session...
    const runtimeIdsOf = new Map<string, Set<string | undefined>>();
    for (const attempt of runtime.attempts) {
      if (attempt.mcpSessionId === undefined) continue;
      const ids = runtimeIdsOf.get(attempt.mcpSessionId) ?? new Set();
      ids.add(attempt.runtimeSessionId);
      runtimeIdsOf.set(attempt.mcpSessionId, ids);
    }
    expect(runtimeIdsOf.size).toBe(2);
    const [first, second] = [...runtimeIdsOf.values()].map((ids) => [...ids]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // ...and the two clients' runtime sessions are not the same one.
    expect(first?.[0]).toBeDefined();
    expect(first?.[0]).not.toBe(second?.[0]);
    // Each initialize opened its own: no runtime id is shared by the two.
    const initializes = runtime.attempts.filter((a) => a.rpcMethod === 'initialize');
    expect(new Set(initializes.map((a) => a.runtimeSessionId)).size).toBe(2);
    // And each call ran under the session of the client that made it.
    const callsBy = (id: string) =>
      runtime.calls().filter((c) => String(c.args?.['id']).startsWith(id));
    expect(new Set(callsBy('A').map((c) => c.runtimeSessionId))).toEqual(
      new Set([initializes[0]?.runtimeSessionId]),
    );
    expect(new Set(callsBy('B').map((c) => c.runtimeSessionId))).toEqual(
      new Set([initializes[1]?.runtimeSessionId]),
    );
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

/**
 * A platform whose hosted server numbers its sessions PER PROCESS — every
 * fresh microVM (one per runtime session id) hands out `s-1` first. Each
 * microVM keeps its own notes, so a request that lands in the wrong one reads
 * somebody else's.
 */
function perProcessPlatform() {
  const vms = new Map<string, { readonly notes: string[]; minted: number }>();
  const sent: { runtimeId: string | null; mcp: string | null; body: string }[] = [];
  const fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const runtimeId = headers.get(AGENTCORE_RUNTIME_SESSION_HEADER);
    const mcp = headers.get('mcp-session-id');
    const body = typeof init?.body === 'string' ? init.body : '';
    sent.push({ runtimeId, mcp, body });
    const vm = vms.get(runtimeId ?? '') ?? { notes: [], minted: 0 };
    vms.set(runtimeId ?? '', vm);
    if (body.startsWith('note:')) vm.notes.push(body.slice(5));
    const session = mcp ?? `s-${++vm.minted}`;
    return new Response(JSON.stringify({ notes: vm.notes }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': session },
    });
  };
  return { fetch, sent };
}

describe("agentCoreRuntimeMcpTransport — P5 'reuse' owns its session key", () => {
  function reuseOver(platform: ReturnType<typeof perProcessPlatform>) {
    return agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      session: 'reuse',
      retry: false,
      auth: { bearer: staticTokens({ runtime: 't' }), fetch: platform.fetch },
    });
  }
  const post = async (
    transport: ReturnType<typeof reuseOver>,
    body: string,
    handle?: string,
    method = 'POST',
  ) =>
    (await transport.fetch?.(transport.url, {
      method,
      ...(handle !== undefined && { headers: { 'mcp-session-id': handle } }),
      body,
    })) as Response;

  it('two clients handed the SAME server session id stay in their own runtime sessions', async () => {
    const platform = perProcessPlatform();
    const transport = reuseOver(platform);
    const alice = (await post(transport, 'open')).headers.get('mcp-session-id') ?? '';
    const bob = (await post(transport, 'open')).headers.get('mcp-session-id') ?? '';
    await post(transport, 'note:alice card 4242', alice);
    const bobReads = await (await post(transport, 'read', bob)).json();

    // Both microVMs numbered their first session `s-1` — and that never mattered.
    expect(platform.sent.filter((x) => x.mcp === 's-1')).toHaveLength(2);
    expect(alice).not.toBe(bob);
    expect(alice).not.toBe('s-1');
    expect(bobReads).toEqual({ notes: [] });
    const runtimeOf = (body: string) => platform.sent.find((x) => x.body === body)?.runtimeId;
    expect(runtimeOf('note:alice card 4242')).not.toBe(runtimeOf('read'));
  });

  it('a handle the transport never issued is answered 404 here — never sent', async () => {
    const platform = perProcessPlatform();
    const transport = reuseOver(platform);
    const res = await post(transport, 'read', 's-1');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { message: 'Session not found' } });
    expect(platform.sent).toEqual([]);
  });

  it('the least recently USED connection is forgotten first; a forgotten one fails closed', async () => {
    const platform = perProcessPlatform();
    const transport = reuseOver(platform);
    const active = (await post(transport, 'open')).headers.get('mcp-session-id') ?? '';
    const idle = (await post(transport, 'open')).headers.get('mcp-session-id') ?? '';
    for (let i = 0; i < MAX_CONNECTIONS - 2; i++) await post(transport, 'open');
    await post(transport, 'read', active); // used: now the most recent
    await post(transport, 'open'); // one past the ceiling
    expect((await post(transport, 'read', active)).status).toBe(200);
    expect((await post(transport, 'read', idle)).status).toBe(404);
  });

  it("a client's DELETE (its close()) forgets its connection", async () => {
    const platform = perProcessPlatform();
    const transport = reuseOver(platform);
    const handle = (await post(transport, 'open')).headers.get('mcp-session-id') ?? '';
    await post(transport, '', handle, 'DELETE');
    expect((await post(transport, 'read', handle)).status).toBe(404);
  });

  it('every attempt of one refused request goes to the SAME runtime session', async () => {
    const seen: (string | null)[] = [];
    let calls = 0;
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      session: 'reuse',
      retry: { maxAttempts: 5, maxWaitMs: 60_000 },
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async (_input, init) => {
          seen.push(new Headers(init?.headers).get(AGENTCORE_RUNTIME_SESSION_HEADER));
          return calls++ < 2
            ? jsonReply({ jsonrpc: '2.0', id: 1, error: BUSY })
            : new Response('{}', {
                headers: { 'content-type': 'application/json', 'mcp-session-id': 'srv-1' },
              });
        },
      },
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);
  });
});

describe('agentCoreRuntimeMcpTransport — P5 a failure is the library’s sentence, never the service’s text', () => {
  it('SigV4: a validation error quoting the session ids reaches the client without them', async () => {
    let sends = 0;
    const runtimeIds: string[] = [];
    const module = {
      InvokeAgentRuntimeCommand: class {
        constructor(readonly input: Record<string, unknown>) {}
      },
      BedrockAgentCoreClient: class {
        async send(command: { input: Record<string, unknown> }) {
          runtimeIds.push(String(command.input['runtimeSessionId']));
          if (sends++ === 0) {
            return {
              statusCode: 200,
              contentType: 'application/json',
              mcpSessionId: 'server-session-0123456789',
              response: { transformToByteArray: async () => new TextEncoder().encode('{}') },
            };
          }
          const { runtimeSessionId, mcpSessionId } = command.input;
          throw Object.assign(
            new Error(
              `1 validation error: Value '${String(runtimeSessionId)}' at 'runtimeSessionId' ` +
                `and Value '${String(
                  mcpSessionId,
                )}' at 'mcpSessionId' failed to satisfy constraint`,
            ),
            {
              name: 'ValidationException',
              $fault: 'client',
              $metadata: { httpStatusCode: 400 },
              $response: { statusCode: 400, headers: {} },
            },
          );
        }
      },
    };
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      session: 'reuse',
      sdk: module,
    });
    const opened = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    const failed = (await transport.fetch?.(transport.url, {
      method: 'POST',
      headers: { 'mcp-session-id': opened.headers.get('mcp-session-id') ?? '' },
      body: '{}',
    })) as Response;
    const text = await failed.text();
    expect(failed.status).toBe(400);
    expect(JSON.parse(text).message).toMatch(/^ValidationException \(HTTP 400\)\./);
    expect(runtimeIds.length).toBe(2);
    for (const id of runtimeIds) expect(text).not.toContain(id);
    expect(text).not.toContain('server-session-0123456789');
  });

  it('bearer: a 4xx body echoing the Authorization header reaches the client without the token', async () => {
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      auth: {
        bearer: staticTokens({ runtime: 'SECRET-BEARER-TOKEN-77' }),
        fetch: async (_input, init) =>
          new Response(
            `bad request; header authorization='${
              new Headers(init?.headers).get('authorization') ?? ''
            }'`,
            { status: 400 },
          ),
      },
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(JSON.parse(text).message).toMatch(/^Request failed \(HTTP 400\)\./);
    expect(text).not.toContain('SECRET-BEARER-TOKEN-77');
  });

  it('bearer: a credential in ANY header (x-api-key, a DPoP proof) is scrubbed from a failure', async () => {
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      auth: {
        bearer: {
          async getCredential() {
            return {
              status: 'issued',
              credential: {
                kind: 'bearer',
                toHeaders: () => ({
                  'x-api-key': 'SECRET-API-KEY-0123456789',
                  dpop: 'SECRET-DPOP-PROOF-0123456789',
                }),
              },
            } as never;
          },
        },
        fetch: async (_input, init) => {
          const echoed: Record<string, string> = {};
          new Headers(init?.headers).forEach((v, k) => (echoed[k] = v));
          return new Response(JSON.stringify({ message: 'bad request', echoed }), { status: 400 });
        },
      },
    });
    const text = await (
      (await transport.fetch?.(transport.url, { method: 'POST', body: '{}' })) as Response
    ).text();
    expect(JSON.parse(text).message).toMatch(/^Request failed \(HTTP 400\)\./);
    expect(text).not.toContain('SECRET-API-KEY');
    expect(text).not.toContain('SECRET-DPOP-PROOF');
  });

  it("SigV4, the default 'per-call': the fresh runtime session id never comes back", async () => {
    const runtimeIds: string[] = [];
    const module = {
      InvokeAgentRuntimeCommand: class {
        constructor(readonly input: Record<string, unknown>) {}
      },
      BedrockAgentCoreClient: class {
        async send(command: { input: Record<string, unknown> }) {
          runtimeIds.push(String(command.input['runtimeSessionId']));
          throw Object.assign(
            new Error(`Value '${String(command.input['runtimeSessionId'])}' failed a constraint`),
            {
              name: 'ValidationException',
              $metadata: { httpStatusCode: 400 },
              $response: { statusCode: 400, headers: {} },
            },
          );
        }
      },
    };
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: module,
    });
    const text = await (
      (await transport.fetch?.(transport.url, { method: 'POST', body: '{}' })) as Response
    ).text();
    expect(JSON.parse(text).message).toMatch(/^ValidationException \(HTTP 400\)\./);
    expect(runtimeIds[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(text).not.toContain(runtimeIds[0]);
  });

  it('a 200 JSON-RPC error quoting the runtime session id is rewritten too', async () => {
    let quoted = '';
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async (_input, init) => {
          quoted = new Headers(init?.headers).get(AGENTCORE_RUNTIME_SESSION_HEADER) ?? '';
          return jsonReply({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32000, message: `session ${quoted} failed` },
          });
        },
      },
    });
    const text = await (
      (await transport.fetch?.(transport.url, { method: 'POST', body: '{}' })) as Response
    ).text();
    expect(JSON.parse(text)).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: -32000 } });
    expect(quoted).toMatch(/^[0-9a-f-]{36}$/);
    expect(text).not.toContain(quoted);
  });

  it('a 2xx RESULT is never rewritten, even when it holds a value the request sent', async () => {
    let sent: unknown;
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async (_input, init) => {
          const id = new Headers(init?.headers).get(AGENTCORE_RUNTIME_SESSION_HEADER) ?? '';
          sent = {
            jsonrpc: '2.0',
            id: 1,
            result: { orders: 20261015, note: `session ${id}`, error: 'a field named error' },
          };
          return jsonReply(sent);
        },
      },
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    // Re-serialized from the one reading — the same value, untouched.
    expect(await res.json()).toEqual(sent);
  });

  it('a successful answer is handed on as the value it held, re-serialized', async () => {
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async () =>
          new Response('  {"jsonrpc":"2.0", "id":1, "result":{"a":1.0}}  ', {
            headers: { 'content-type': 'application/json; charset=utf-8' },
          }),
      },
    });
    const res = (await transport.fetch?.(transport.url, {
      method: 'POST',
      body: '{}',
    })) as Response;
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe('{"jsonrpc":"2.0","id":1,"result":{"a":1}}');
  });
});

describe('agentCoreRuntimeMcpTransport — P5 one reading of an answer; ambiguity refused by name', () => {
  const SECRET = 'SECRET-AMBIGUOUS-0001';
  /** A transport whose platform answers `reply` (a body and its headers) to every request. */
  function answering(body: BodyInit, headers: Record<string, string>, status = 200) {
    return agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      retry: false,
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async () => new Response(body, { status, headers }),
      },
    });
  }
  const send = async (transport: ReturnType<typeof answering>) =>
    (await transport.fetch?.(transport.url, { method: 'POST', body: '{}' })) as Response;
  const JSON_TYPE = { 'content-type': 'application/json' };

  it.each([
    [
      'a duplicated key',
      `{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error"},"error":{"code":1,"message":"${SECRET}"}}`,
      JSON_TYPE,
      /a duplicated object key/,
    ],
    [
      'a duplicated key inside the error',
      `{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error","message":"${SECRET}"}}`,
      JSON_TYPE,
      /a duplicated object key/,
    ],
    [
      'more than one message in one body',
      `[{"jsonrpc":"2.0","id":1,"result":{}},{"jsonrpc":"2.0","id":2,"error":{"code":1,"message":"${SECRET}"}}]`,
      JSON_TYPE,
      /more than one message/,
    ],
    [
      'trailing data after the value',
      `{"jsonrpc":"2.0","id":1,"result":{}} {"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"${SECRET}"}}`,
      JSON_TYPE,
      /trailing data/,
    ],
    [
      'a content type that does not match the body',
      `{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"${SECRET}"}}`,
      { 'content-type': 'text/plain; profile=application/json' },
      /content type/,
    ],
    [
      'two content types at once',
      `{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"${SECRET}"}}`,
      { 'content-type': 'application/json, text/event-stream' },
      /content type/,
    ],
    [
      'a charset other than UTF-8',
      `{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"${SECRET}"}}`,
      { 'content-type': 'application/json; charset=utf-16' },
      /content type/,
    ],
    [
      'no content type at all',
      new TextEncoder().encode(`{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"${SECRET}"}}`),
      {},
      /no content type/,
    ],
  ] as const)(
    '%s: refused (502) in the library’s words, the body unread by the client',
    async (_, body, headers, reason) => {
      const res = await send(answering(body, headers));
      const text = await res.text();
      expect(res.status).toBe(502);
      expect(JSON.parse(text).message).toMatch(reason);
      expect(text).not.toContain(SECRET);
    },
  );

  it('a leading byte-order mark is refused', async () => {
    const bom = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"result":{}}'),
    ]);
    const res = await send(answering(bom, JSON_TYPE));
    expect(res.status).toBe(502);
    expect(JSON.parse(await res.text()).message).toMatch(/byte-order mark/);
  });

  it('a body that is not UTF-8 is refused', async () => {
    const res = await send(answering(new Uint8Array([0x7b, 0xff, 0x7d]), JSON_TYPE));
    expect(res.status).toBe(502);
    expect(JSON.parse(await res.text()).message).toMatch(/not UTF-8/);
  });

  it('header case never changes the reading: Content-Type: Application/JSON is JSON', async () => {
    const res = await send(
      answering('{"jsonrpc":"2.0","id":1,"result":{}}', { 'Content-Type': 'Application/JSON' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('a `__proto__` key is data in the reading, never a prototype', async () => {
    const res = await send(
      answering('{"jsonrpc":"2.0","id":1,"result":{"__proto__":{"polluted":true}}}', JSON_TYPE),
    );
    const text = await res.text();
    expect(text).toContain('"__proto__"');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  describe('event streams', () => {
    const SSE = { 'content-type': 'text/event-stream' };
    const read = async (res: Response): Promise<{ text: string; error?: string }> => {
      try {
        return { text: await res.text() };
      } catch (err) {
        return { text: '', error: (err as Error).message };
      }
    };

    it('an event with a duplicated key cuts the stream, in the library’s words', async () => {
      const res = await send(
        answering(
          `data: {"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"Internal error"},"error":{"code":1,"message":"${SECRET}"}}\n\n`,
          SSE,
        ),
      );
      const { text, error } = await read(res);
      expect(error).toMatch(/the event stream was cut: a duplicated object key/);
      expect(text + (error ?? '')).not.toContain(SECRET);
    });

    it('an event holding more than one message cuts the stream', async () => {
      const res = await send(
        answering(`data: [{"jsonrpc":"2.0","method":"a"},{"jsonrpc":"2.0","method":"b"}]\n\n`, SSE),
      );
      expect((await read(res)).error).toMatch(/more than one message/);
    });

    it('an event whose data is not JSON cuts the stream', async () => {
      const res = await send(answering(`data: ${SECRET}\n\n`, SSE));
      const { error } = await read(res);
      expect(error).toMatch(/the event stream was cut/);
      expect(error).not.toContain(SECRET);
    });

    it('data split over lines and CR line endings read as ONE message, re-emitted canonically', async () => {
      const res = await send(
        answering('id: 7\revent: message\rdata: {"jsonrpc":"2.0",\rdata: "method":"n"}\r\r', SSE),
      );
      expect(await res.text()).toBe(
        'event: message\nid: 7\ndata: {"jsonrpc":"2.0","method":"n"}\n\n',
      );
    });

    it('an event whose type is not a plain token is dropped, never turned into a message', async () => {
      const res = await send(
        answering(
          'event: x y\ndata: {"jsonrpc":"2.0","method":"n"}\n\ndata: {"jsonrpc":"2.0","method":"m"}\n\n',
          SSE,
        ),
      );
      expect(await res.text()).toBe('data: {"jsonrpc":"2.0","method":"m"}\n\n');
    });

    it('a last event with no blank line after it is not dispatched — as the SSE rules say', async () => {
      const res = await send(answering(`data: {"jsonrpc":"2.0","method":"n"}`, SSE));
      expect(await res.text()).toBe('');
    });
  });
});

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
    const retries: ThrottleRetryInfo[] = [];
    const counted = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      retry: { onRetry: (info) => retries.push(info) },
      auth: {
        bearer: staticTokens({ runtime: 't' }),
        fetch: async () => jsonReply({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
      },
    });
    await transport.fetch?.(transport.url, { method: 'POST', body: '{}' });
    await counted.fetch?.(counted.url, { method: 'POST', body: '{}' });
    expect(calls).toBe(1);
    // No wait was ever scheduled: the loop reported no retry.
    expect(retries).toEqual([]);
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
