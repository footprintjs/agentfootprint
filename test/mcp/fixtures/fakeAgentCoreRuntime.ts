/**
 * A fake AgentCore Runtime in front of a REAL MCP server — no AWS anywhere.
 *
 * Two layers, so each test reads what it means:
 *
 *   the PLATFORM (this file)  what AgentCore Runtime does around a hosted MCP
 *                             server, as its MCP protocol contract states it:
 *                             mints an `Mcp-Session-Id` for a request without
 *                             one and returns it on every reply, carries the
 *                             runtime session id, and — when the script says so —
 *                             answers HTTP 200 with the contract's JSON-RPC
 *                             -32005 "Session operation in progress, please
 *                             retry" instead of forwarding the request.
 *   the SERVER                a stateless MCP server built from
 *                             `@modelcontextprotocol/sdk` itself (fresh server +
 *                             web-standard transport per request — the SDK's
 *                             stateless contract), so the MCP client on the
 *                             other side talks to someone else's implementation
 *                             of the protocol, not to our mock of it.
 *
 * Reached two ways, matching the adapter's two auth strategies:
 *   `sdk`    a fake `@aws-sdk/client-bedrock-agentcore` module whose client's
 *            `send(InvokeAgentRuntimeCommand)` lands on the platform (SigV4).
 *   `https`  a `fetch` standing in for the documented HTTPS endpoint (bearer),
 *            which also records the `Authorization` header it was sent.
 */

import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** One tool the hosted server serves: it answers with `answer(args)` as text. */
export interface FakeTool {
  readonly name: string;
  readonly answer: (args: Record<string, unknown>) => string;
}

/** Everything one attempt carried, as the platform received it. */
export interface RuntimeAttempt {
  readonly via: 'sdk' | 'https';
  readonly method: string;
  /** The JSON-RPC method of a POST, e.g. `tools/call`. */
  readonly rpcMethod?: string;
  /** For `tools/call`: the tool's name. */
  readonly toolName?: string;
  /** For `tools/call`: the arguments it was called with. */
  readonly args?: Record<string, unknown>;
  /** The Mcp-Session-Id the CLIENT sent (absent: it sent none). */
  readonly mcpSessionId?: string;
  /** The runtime session id the CLIENT sent (absent: it sent none). */
  readonly runtimeSessionId?: string;
  readonly mcpProtocolVersion?: string;
  readonly contentType?: string;
  readonly accept?: string;
  readonly agentRuntimeArn?: string;
  readonly qualifier?: string;
  /** Only on the https path: the Authorization header it arrived with. */
  readonly authorization?: string;
  /** True when the platform answered "session operation in progress". */
  readonly refusedBusy: boolean;
}

export interface FakeRuntimeOptions {
  readonly tools: readonly FakeTool[];
  /**
   * How many times the platform refuses a `tools/call` of each tool, per
   * session the client named, before forwarding it. `{ lookup: 2 }` → the
   * first two calls of `lookup` in a session are refused busy, the third goes
   * through.
   */
  readonly busyCalls?: Readonly<Record<string, number>>;
  /** `true` → the server answers `application/json`; default SSE, like most servers. */
  readonly jsonResponses?: boolean;
  /**
   * SDK path only: every `tools/call` of the named tool is answered with this
   * service exception, THROWN as the real SDK throws a non-2xx answer.
   */
  readonly sdkFailures?: Readonly<
    Record<string, { readonly name: string; readonly status: number }>
  >;
}

/** The platform's reply, in `InvokeAgentRuntimeResponse`'s field names. */
interface PlatformReply {
  readonly statusCode: number;
  readonly contentType?: string;
  readonly mcpSessionId?: string;
  readonly mcpProtocolVersion?: string;
  readonly runtimeSessionId?: string;
  readonly body: ReadableStream<Uint8Array> | null;
}

/** What reached the platform, in `InvokeAgentRuntimeRequest`'s field names. */
interface PlatformRequest {
  readonly via: 'sdk' | 'https';
  readonly method: string;
  readonly payload: Uint8Array;
  readonly contentType?: string;
  readonly accept?: string;
  readonly mcpSessionId?: string;
  readonly mcpProtocolVersion?: string;
  readonly runtimeSessionId?: string;
  readonly agentRuntimeArn?: string;
  readonly qualifier?: string;
  readonly authorization?: string;
}

export interface FakeRuntime {
  /** Pass as the transport's `_sdk` (SigV4 path). */
  readonly sdk: Record<string, unknown>;
  /** Pass as `auth: { bearer, fetch }` (bearer path). */
  readonly https: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** Every attempt, in arrival order. */
  readonly attempts: RuntimeAttempt[];
  /** Every client config the fake SDK client was constructed with. */
  readonly clientConfigs: Record<string, unknown>[];
  /** The `tools/call` attempts only. */
  calls(): RuntimeAttempt[];
}

const BUSY_MESSAGE = 'Session operation in progress, please retry';

export function fakeAgentCoreRuntime(options: FakeRuntimeOptions): FakeRuntime {
  const attempts: RuntimeAttempt[] = [];
  const clientConfigs: Record<string, unknown>[] = [];
  const refusedSoFar = new Map<string, number>();
  let minted = 0;

  async function platform(request: PlatformRequest): Promise<PlatformReply> {
    const text = new TextDecoder().decode(request.payload);
    const rpc = parseRpc(text);
    // The platform's own session rule: a request without one gets one, and
    // every reply names the session it ran in.
    const mcpSessionId = request.mcpSessionId ?? `mcp-session-${++minted}`;
    const toolName =
      rpc?.method === 'tools/call' ? (rpc.params?.name as string | undefined) : undefined;
    // Budgets are per session the CLIENT named — so a 'per-call' client (which
    // names none) shares one budget per tool, and still gets through.
    const busyKey = `${request.mcpSessionId ?? ''}|${toolName ?? ''}`;
    const budget = toolName === undefined ? 0 : options.busyCalls?.[toolName] ?? 0;
    const refused = refusedSoFar.get(busyKey) ?? 0;
    const refuseBusy = request.method === 'POST' && refused < budget;
    attempts.push({
      via: request.via,
      method: request.method,
      ...(rpc?.method !== undefined && { rpcMethod: rpc.method }),
      ...(toolName !== undefined && { toolName }),
      ...(rpc?.method === 'tools/call' && {
        args: (rpc.params?.arguments ?? {}) as Record<string, unknown>,
      }),
      ...(request.mcpSessionId !== undefined && { mcpSessionId: request.mcpSessionId }),
      ...(request.runtimeSessionId !== undefined && { runtimeSessionId: request.runtimeSessionId }),
      ...(request.mcpProtocolVersion !== undefined && {
        mcpProtocolVersion: request.mcpProtocolVersion,
      }),
      ...(request.contentType !== undefined && { contentType: request.contentType }),
      ...(request.accept !== undefined && { accept: request.accept }),
      ...(request.agentRuntimeArn !== undefined && { agentRuntimeArn: request.agentRuntimeArn }),
      ...(request.qualifier !== undefined && { qualifier: request.qualifier }),
      ...(request.authorization !== undefined && { authorization: request.authorization }),
      refusedBusy: refuseBusy,
    });
    const common = {
      mcpSessionId,
      ...(request.runtimeSessionId !== undefined && { runtimeSessionId: request.runtimeSessionId }),
    };
    if (refuseBusy) {
      refusedSoFar.set(busyKey, refused + 1);
      return {
        statusCode: 200,
        contentType: 'application/json',
        ...common,
        body: streamOf(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc?.id ?? null,
            error: { code: -32005, message: BUSY_MESSAGE },
          }),
        ),
      };
    }
    if (request.method !== 'POST') {
      return { statusCode: 405, ...common, body: null };
    }
    const served = await serve(request, text);
    return {
      statusCode: served.status,
      ...(served.headers.get('content-type') !== null && {
        contentType: served.headers.get('content-type') as string,
      }),
      ...common,
      body: served.body,
    };
  }

  async function serve(request: PlatformRequest, body: string): Promise<Response> {
    const server = new SdkServer(
      { name: 'runtime-hosted', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: options.tools.map((t) => ({
        name: t.name,
        description: `the ${t.name} tool`,
        inputSchema: { type: 'object' as const },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, (call) => {
      const tool = options.tools.find((t) => t.name === call.params.name);
      if (!tool) return { content: [{ type: 'text', text: 'no such tool' }], isError: true };
      const args = (call.params.arguments ?? {}) as Record<string, unknown>;
      return { content: [{ type: 'text', text: tool.answer(args) }] };
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      ...(options.jsonResponses === true && { enableJsonResponse: true }),
    });
    await server.connect(transport);
    const headers = new Headers();
    if (request.contentType) headers.set('content-type', request.contentType);
    if (request.accept) headers.set('accept', request.accept);
    if (request.mcpSessionId) headers.set('mcp-session-id', request.mcpSessionId);
    if (request.mcpProtocolVersion) {
      headers.set('mcp-protocol-version', request.mcpProtocolVersion);
    }
    return transport.handleRequest(
      new Request('http://runtime.internal/mcp', { method: 'POST', headers, body }),
    );
  }

  const sdk: Record<string, unknown> = {
    InvokeAgentRuntimeCommand: class {
      static readonly __command = 'InvokeAgentRuntimeCommand';
      readonly __command = 'InvokeAgentRuntimeCommand';
      constructor(readonly input: Record<string, unknown>) {}
    },
    BedrockAgentCoreClient: class {
      constructor(readonly config: Record<string, unknown> = {}) {
        clientConfigs.push(config);
      }
      async send(command: { input: Record<string, unknown> }): Promise<unknown> {
        const input = command.input;
        // The SDK path's non-2xx form: the real SDK THROWS a service exception
        // carrying the status, rather than returning the answer.
        const called = parseRpc(new TextDecoder().decode(input['payload'] as Uint8Array));
        const failing =
          called?.method === 'tools/call'
            ? options.sdkFailures?.[String(called.params?.['name'])]
            : undefined;
        if (failing !== undefined) {
          attempts.push({
            via: 'sdk',
            method: 'POST',
            rpcMethod: 'tools/call',
            toolName: String(called?.params?.['name']),
            ...optionalString(input, 'mcpSessionId'),
            ...optionalString(input, 'runtimeSessionId'),
            refusedBusy: false,
          });
          throw Object.assign(new Error(`${failing.name} from the service`), {
            name: failing.name,
            $fault: failing.status >= 500 ? 'server' : 'client',
            $metadata: { httpStatusCode: failing.status },
            $response: { statusCode: failing.status, headers: {} },
          });
        }
        const reply = await platform({
          via: 'sdk',
          method: 'POST',
          payload: input['payload'] as Uint8Array,
          ...optionalString(input, 'contentType'),
          ...optionalString(input, 'accept'),
          ...optionalString(input, 'mcpSessionId'),
          ...optionalString(input, 'mcpProtocolVersion'),
          ...optionalString(input, 'runtimeSessionId'),
          ...optionalString(input, 'agentRuntimeArn'),
          ...optionalString(input, 'qualifier'),
        });
        return {
          statusCode: reply.statusCode,
          ...(reply.contentType !== undefined && { contentType: reply.contentType }),
          ...(reply.mcpSessionId !== undefined && { mcpSessionId: reply.mcpSessionId }),
          ...(reply.runtimeSessionId !== undefined && { runtimeSessionId: reply.runtimeSessionId }),
          response: sdkStreamOf(reply.body),
        };
      }
    },
  };

  const https = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    const headers = new Headers(init?.headers);
    const body = init?.body;
    const payload = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array();
    const arnPart = url.pathname.split('/')[2];
    const reply = await platform({
      via: 'https',
      method: (init?.method ?? 'GET').toUpperCase(),
      payload,
      ...headerField(headers, 'content-type', 'contentType'),
      ...headerField(headers, 'accept', 'accept'),
      ...headerField(headers, 'mcp-session-id', 'mcpSessionId'),
      ...headerField(headers, 'mcp-protocol-version', 'mcpProtocolVersion'),
      ...headerField(headers, 'x-amzn-bedrock-agentcore-runtime-session-id', 'runtimeSessionId'),
      ...headerField(headers, 'authorization', 'authorization'),
      ...(arnPart !== undefined && { agentRuntimeArn: decodeURIComponent(arnPart) }),
      ...(url.searchParams.get('qualifier') !== null && {
        qualifier: url.searchParams.get('qualifier') as string,
      }),
    });
    const out = new Headers();
    if (reply.contentType) out.set('content-type', reply.contentType);
    if (reply.mcpSessionId) out.set('mcp-session-id', reply.mcpSessionId);
    if (reply.runtimeSessionId) {
      out.set('x-amzn-bedrock-agentcore-runtime-session-id', reply.runtimeSessionId);
    }
    return new Response(reply.statusCode === 202 ? null : reply.body, {
      status: reply.statusCode,
      headers: out,
    });
  };

  return {
    sdk,
    https,
    attempts,
    clientConfigs,
    calls: () => attempts.filter((a) => a.rpcMethod === 'tools/call'),
  };
}

// ── helpers ─────────────────────────────────────────────────────────

interface Rpc {
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

function parseRpc(text: string): Rpc | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Rpc)
      : undefined;
  } catch {
    return undefined;
  }
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body as ReadableStream<Uint8Array>;
}

/** The SDK's streaming body mixin, over a web stream. */
function sdkStreamOf(body: ReadableStream<Uint8Array> | null): unknown {
  if (body === null) return undefined;
  return {
    transformToWebStream: () => body,
    transformToByteArray: async () => new Uint8Array(await new Response(body).arrayBuffer()),
  };
}

function optionalString(input: Record<string, unknown>, key: string): Record<string, string> {
  const value = input[key];
  return typeof value === 'string' ? { [key]: value } : {};
}

function headerField(headers: Headers, header: string, key: string): Record<string, string> {
  const value = headers.get(header);
  return value === null ? {} : { [key]: value };
}
