/**
 * invoke — the SigV4 auth strategy: Streamable HTTP, carried by the AWS SDK's
 * `InvokeAgentRuntime`.
 *
 * The MCP client speaks HTTP — a POST, a few headers, a JSON body — and the SDK
 * operation carries exactly that, field for field. This file is the mapping and
 * nothing else. Every name in it is the SDK's own (`InvokeAgentRuntimeRequest`
 * / `InvokeAgentRuntimeResponse` in `@aws-sdk/client-bedrock-agentcore`), read
 * off an installed package rather than recalled:
 *
 *   request                                       InvokeAgentRuntimeRequest
 *   ─────────────────────────────────────────────  ────────────────────────
 *   body                                          payload (bytes)
 *   content-type                                  contentType
 *   accept                                        accept
 *   mcp-session-id                                mcpSessionId
 *   mcp-protocol-version                          mcpProtocolVersion
 *   x-amzn-bedrock-agentcore-runtime-session-id   runtimeSessionId
 *   (the runtime, from options)                   agentRuntimeArn, qualifier, accountId
 *
 *   InvokeAgentRuntimeResponse                    response
 *   ─────────────────────────────────────────────  ────────────────────────
 *   statusCode                                    status
 *   contentType                                   content-type
 *   mcpSessionId                                  mcp-session-id
 *   mcpProtocolVersion                            mcp-protocol-version
 *   runtimeSessionId                              x-amzn-bedrock-agentcore-runtime-session-id
 *   response (a stream)                           body
 *
 * The signature is the SDK's: `send` signs every attempt with the client's own
 * credentials, so no credential passes through this file.
 *
 * ── The SDK's own retry is OFF ───────────────────────────────────────────────
 * The client built here has `maxAttempts: 1`. The SDK's standard policy would
 * re-send a `tools/call` after a 5xx or a dropped connection — a call that may
 * already have run, in the same pinned session — which is the one thing a retry
 * here must never do. Every retry goes through the transport's single loop
 * instead, which repeats only refusals the service made before running
 * anything. A `client` you pass keeps ITS policy: build it with
 * `maxAttempts: 1` for the same guarantee.
 *
 * ── A service exception is an ANSWER ─────────────────────────────────────────
 * When the service answers with a non-2xx status, the SDK throws instead of
 * returning — `RetryableConflictException` (409), `ThrottlingException` (429),
 * or a hosted server's own 404 as `Unknown`. Each is handed on as the `Response`
 * an HTTPS caller would have read: its status, its error type in
 * `x-amzn-errortype`, and `retry-after` when the service sent one. So the
 * transport's retry decision sees the 409, `mcpClient`'s 429 retry sees the
 * 429, and the MCP client reports the status. A failure with no status — the
 * network, an abort — never reached the service as an answer, and is thrown as
 * it is.
 *
 * ── What the operation cannot carry ──────────────────────────────────────────
 * Any method but POST. A GET (the optional server-message stream) and a DELETE
 * (ending a session) are answered HERE with 405, which the MCP Streamable HTTP
 * spec defines as "not offered" for both, so the MCP client carries on. And any
 * header the operation does not model — it has no field to put one in.
 *
 * Pattern: Adapter (fetch ↔ command). Role: outer ring, lazy AWS peer dep.
 */

import { lazyRequire } from '../../../lib/lazyRequire.js';
import { sdkLoadFailure } from '../../../mcp/sdkLoadFailure.js';
import type { ThrottleFetch } from '../../../mcp/throttleRetry.js';
import { AGENTCORE_RUNTIME_SESSION_HEADER, MCP_SESSION_HEADER } from './session.js';

const MCP_PROTOCOL_VERSION_HEADER = 'Mcp-Protocol-Version';
const SDK_PACKAGE = '@aws-sdk/client-bedrock-agentcore';

/** A command-based SDK client — `send` is the only member this strategy uses. */
export interface AgentCoreRuntimeSdkClient {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

/** The slice of `@aws-sdk/client-bedrock-agentcore` this strategy touches. */
export interface BedrockAgentCoreRuntimeSdkModule {
  readonly BedrockAgentCoreClient?: new (config: {
    region?: string;
    maxAttempts?: number;
  }) => AgentCoreRuntimeSdkClient;
  readonly InvokeAgentRuntimeCommand?: new (input: unknown) => unknown;
}

/** Which runtime every request goes to, as the operation names it. */
export interface InvokeTarget {
  readonly agentRuntimeArn: string;
  readonly qualifier?: string;
  readonly accountId?: string;
}

/** What the strategy is built from: a region, and optionally what was injected. */
export interface InvokeSdkOptions {
  readonly region: string;
  /**
   * A client the caller built — its credentials, region and retry settings win,
   * so build it with `maxAttempts: 1` (see the module note).
   */
  readonly client?: AgentCoreRuntimeSdkClient;
  /** The SDK module itself, for tests; otherwise the peer dep is loaded. */
  readonly sdk?: BedrockAgentCoreRuntimeSdkModule;
}

/**
 * The client and the command constructor this strategy sends with.
 *
 * Loaded when the transport is BUILT, not at the first call, so a missing peer
 * dependency is refused where the transport is declared rather than mid-run.
 *
 * @throws when the SDK cannot be loaded, or when it lacks what is needed.
 */
export function invokeSdk(options: InvokeSdkOptions): {
  readonly client: AgentCoreRuntimeSdkClient;
  readonly InvokeAgentRuntimeCommand: new (input: unknown) => unknown;
} {
  const mod = options.sdk ?? loadSdk();
  const Command = mod.InvokeAgentRuntimeCommand;
  if (!Command) {
    throw new Error(
      `agentCoreRuntimeMcpTransport: \`${SDK_PACKAGE}\` is installed but has no ` +
        '`InvokeAgentRuntimeCommand`. Upgrade the SDK.',
    );
  }
  if (options.client) return { client: options.client, InvokeAgentRuntimeCommand: Command };
  if (!mod.BedrockAgentCoreClient) {
    throw new Error(
      `agentCoreRuntimeMcpTransport: \`${SDK_PACKAGE}\` is installed but has no ` +
        '`BedrockAgentCoreClient`. Upgrade the SDK.',
    );
  }
  return {
    // The SDK's own retry OFF: it would re-send work that may have run.
    client: new mod.BedrockAgentCoreClient({ region: options.region, maxAttempts: 1 }),
    InvokeAgentRuntimeCommand: Command,
  };
}

function loadSdk(): BedrockAgentCoreRuntimeSdkModule {
  try {
    return lazyRequire<BedrockAgentCoreRuntimeSdkModule>('@aws-sdk/client-bedrock-agentcore');
  } catch (err) {
    throw new Error(
      sdkLoadFailure(err, {
        notInstalled:
          `agentCoreRuntimeMcpTransport (auth: 'sigv4') requires the \`${SDK_PACKAGE}\` peer ` +
          'dependency.\n' +
          `  Install:  npm install ${SDK_PACKAGE}\n` +
          '  Or use `auth: { bearer }` for a runtime with OAuth inbound auth — that path is plain\n' +
          '  HTTPS and loads no AWS SDK.',
        caller: 'agentCoreRuntimeMcpTransport',
        specifier: SDK_PACKAGE,
        instead:
          'SigV4 signs with AWS credentials, which belong on a server. From a browser, use ' +
          '`auth: { bearer }` — plain HTTPS, no AWS SDK.',
      }),
    );
  }
}

/** What `send` answers with — the fields read here, each optional on purpose. */
interface InvokeAnswer {
  readonly statusCode?: number;
  readonly contentType?: string;
  readonly mcpSessionId?: string;
  readonly mcpProtocolVersion?: string;
  readonly runtimeSessionId?: string;
  readonly response?: unknown;
}

/** Statuses whose response may not carry a body, by the Fetch standard. */
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/**
 * A `fetch` that sends each request as one `InvokeAgentRuntimeCommand`.
 *
 * The URL the MCP client passes is ignored on purpose: it names the endpoint for
 * reports and errors, while the invocation goes to `target` — the SDK resolves
 * the endpoint itself, from the client's region.
 */
export function invokeFetch(
  target: InvokeTarget,
  client: AgentCoreRuntimeSdkClient,
  InvokeAgentRuntimeCommand: new (input: unknown) => unknown,
): ThrottleFetch {
  return async (_input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'POST') {
      return new Response(null, { status: 405, statusText: 'Method Not Allowed' });
    }
    const headers = new Headers(init?.headers);
    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: target.agentRuntimeArn,
      ...(target.qualifier !== undefined && { qualifier: target.qualifier }),
      ...(target.accountId !== undefined && { accountId: target.accountId }),
      payload: payloadOf(init?.body),
      ...field('contentType', headers.get('content-type')),
      ...field('accept', headers.get('accept')),
      ...field('mcpSessionId', headers.get(MCP_SESSION_HEADER)),
      ...field('mcpProtocolVersion', headers.get(MCP_PROTOCOL_VERSION_HEADER)),
      ...field('runtimeSessionId', headers.get(AGENTCORE_RUNTIME_SESSION_HEADER)),
    });
    let answer: InvokeAnswer;
    try {
      answer = ((await client.send(
        command,
        init?.signal ? { abortSignal: init.signal } : undefined,
      )) ?? {}) as InvokeAnswer;
    } catch (err) {
      const answered = serviceAnswerOf(err);
      if (answered === undefined) throw err;
      return answered;
    }
    return responseOf(answer);
  };
}

/**
 * An SDK service exception as the `Response` the service sent: its status, its
 * error type, its `retry-after`. `undefined` for anything that carries no
 * status — that failure never came back from the service as an answer.
 */
function serviceAnswerOf(err: unknown): Response | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const failure = err as {
    readonly name?: unknown;
    readonly message?: unknown;
    readonly $metadata?: { readonly httpStatusCode?: unknown };
    readonly $response?: { readonly headers?: Readonly<Record<string, unknown>> };
  };
  const status = failure.$metadata?.httpStatusCode;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 599) {
    return undefined;
  }
  const headers = new Headers({ 'content-type': 'application/json' });
  if (typeof failure.name === 'string' && failure.name !== '') {
    headers.set('x-amzn-errortype', failure.name);
  }
  const retryAfter = failure.$response?.headers?.['retry-after'];
  if (typeof retryAfter === 'string') headers.set('retry-after', retryAfter);
  const message = typeof failure.message === 'string' ? failure.message : '';
  return new Response(JSON.stringify({ message }), { status, headers });
}

/** An optional request field: present only when the header was. */
function field(name: string, value: string | null): Record<string, string> {
  return value === null || value === '' ? {} : { [name]: value };
}

/**
 * The request body as the bytes `payload` takes. The MCP client always sends a
 * JSON string; the other forms are accepted because they are bytes already.
 * A stream or a form is refused by name — re-reading one is not this file's to
 * do, and dropping it would send an empty request.
 */
function payloadOf(body: RequestInit['body'] | undefined): Uint8Array {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new TypeError(
    'agentCoreRuntimeMcpTransport: a request body must be a string or bytes to travel as ' +
      "InvokeAgentRuntime's `payload`; got a stream or form body, which this transport does " +
      'not read.',
  );
}

/** The SDK's answer as the `Response` the MCP client reads. */
async function responseOf(answer: InvokeAnswer): Promise<Response> {
  const status = answer.statusCode ?? 200;
  const headers = new Headers();
  if (answer.contentType) headers.set('content-type', answer.contentType);
  if (answer.mcpSessionId) headers.set(MCP_SESSION_HEADER, answer.mcpSessionId);
  if (answer.mcpProtocolVersion)
    headers.set(MCP_PROTOCOL_VERSION_HEADER, answer.mcpProtocolVersion);
  if (answer.runtimeSessionId) {
    headers.set(AGENTCORE_RUNTIME_SESSION_HEADER, answer.runtimeSessionId);
  }
  if (NULL_BODY_STATUS.has(status)) {
    await release(answer.response);
    return new Response(null, { status, headers });
  }
  return new Response(await bodyOf(answer.response), { status, headers });
}

/**
 * The SDK's streaming body, kept streaming where it can be: an SSE reply then
 * reaches the MCP client event by event, as it would over plain HTTP.
 */
async function bodyOf(stream: unknown): Promise<BodyInit | null> {
  if (stream === undefined || stream === null) return null;
  if (typeof stream === 'string' || stream instanceof Uint8Array) return stream;
  const sdkStream = stream as {
    transformToWebStream?: () => ReadableStream<Uint8Array>;
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof sdkStream.transformToWebStream === 'function') {
    return sdkStream.transformToWebStream();
  }
  if (typeof sdkStream.transformToByteArray === 'function') {
    return sdkStream.transformToByteArray();
  }
  throw new TypeError(
    'agentCoreRuntimeMcpTransport: InvokeAgentRuntime answered with a `response` that is ' +
      'neither bytes nor an SDK stream (no transformToWebStream / transformToByteArray). ' +
      'Upgrade @aws-sdk/client-bedrock-agentcore.',
  );
}

/** Drain a body nobody will read, so the SDK's socket is released. Never throws. */
async function release(stream: unknown): Promise<void> {
  try {
    const sdkStream = stream as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    await sdkStream?.transformToByteArray?.();
  } catch {
    // A body that will not drain is not worth failing a delivered reply over.
  }
}
