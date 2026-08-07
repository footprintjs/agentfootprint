/**
 * MCP — Model Context Protocol, in both directions.
 *
 * MCP (https://modelcontextprotocol.io) is an open standard for
 * connecting LLMs to external tools and data sources. This module
 * bridges it both ways:
 *
 *   - `mcpClient(opts)`  — consume an MCP server; its tools become
 *     agentfootprint `Tool[]` you can hand to `agent.tools(...)`.
 *   - `mcpServe(tools, opts)` — the other direction: expose your own
 *     `Tool[]` AS an MCP server, so any MCP client can call them.
 *
 * Pattern: Adapter (GoF) — translates MCP wire format ↔ agentfootprint
 *          `Tool` interface. The MCP SDK does the protocol work; we
 *          just bridge.
 * Role:    Layer-3 tool integration. Pairs with `defineTool` (the
 *          inline alternative for non-MCP tools).
 * Emits:   N/A directly — wrapped tools emit the standard
 *          `agentfootprint.stream.tool_start` / `tool_end` events
 *          when the agent calls them. `mcpServe` runs OUTSIDE any
 *          agent run, so it emits nothing at all.
 */

import type { Tool } from '../../core/tools.js';
import type { CredentialProvider } from '../../identity/types.js';
import type { RetryOnThrottle } from './throttleRetry.js';

// ─── Transport options ─────────────────────────────────────────────

/**
 * `stdio` transport — spawns a local subprocess and speaks MCP over
 * its stdin/stdout. Best for development, single-user scenarios, and
 * testing against locally-installed MCP servers.
 */
export interface McpStdioTransport {
  readonly transport: 'stdio';
  /** Executable to spawn (e.g., `'npx'`, `'node'`, `'python'`). */
  readonly command: string;
  /** CLI args passed to the executable. */
  readonly args?: readonly string[];
  /**
   * Environment for the subprocess. Passed to the SDK as-is, and the SDK
   * treats it as the WHOLE environment: set this and the child no longer
   * inherits the safe default set (`PATH`, `HOME`, …). Omit it unless you
   * mean to replace the environment; to merely add a variable, include the
   * ones the child still needs.
   */
  readonly env?: Readonly<Record<string, string>>;
  /** Working directory for the subprocess. */
  readonly cwd?: string;
}

/**
 * `http` transport — speaks MCP over Streamable HTTP. Best for remote
 * servers, web environments, and multi-user scenarios.
 */
export interface McpHttpTransport {
  readonly transport: 'http';
  /** MCP server endpoint URL. */
  readonly url: string;
  /** Optional auth headers (e.g., `Authorization: Bearer ...`). */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Your own `fetch`, used for every request this transport makes —
   * `initialize`, `tools/list`, `tools/call` and the SSE stream alike.
   *
   * It exists because some endpoints do not want a header, they want a
   * **signature**: SigV4, DPoP, an HMAC over the body, a digest of the bytes
   * about to be sent. None of those can be decided when the connection is
   * built, because they are computed FROM the request — its method, its URL,
   * its body. A header fixed at construction cannot express them.
   *
   * So this library does not implement any of them. It hands you the one hook
   * the MCP SDK already has, and you sign in your own code: **zero vendor code
   * lives here**, and a signing scheme this repo has never heard of works on
   * the day you write it.
   *
   * ```ts
   * transport: {
   *   transport: 'http',
   *   url: process.env.MCP_URL!,
   *   fetch: async (url, init) => {
   *     const headers = new Headers(init?.headers);
   *     headers.set('authorization', await sign(init?.method ?? 'GET', url, init?.body));
   *     return fetch(url, { ...init, headers });
   *   },
   * }
   * ```
   *
   * Composes with {@link headers}: both are applied. The SDK merges the static
   * headers into the `init.headers` your function receives, so you see them and
   * have the last word — set the same header name and yours is what goes on the
   * wire. Omit this and behaviour is byte-identical to before it existed.
   *
   * Whatever you set here is between you and the server: this library never
   * reads, stores, logs or records the headers your function produces.
   */
  readonly fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

/**
 * `gateway` transport — MCP over Streamable HTTP, with the auth headers vended
 * **per request** by a {@link CredentialProvider} instead of fixed at connect
 * time.
 *
 * The difference from `http` is entirely about time. `http` takes the headers
 * you hand it once and reuses them for the life of the connection, which is
 * exactly right for a static API key and exactly wrong for a token with an
 * expiry: a long-lived agent outlives its bearer token, and the failure is a
 * burst of 401s an hour into a session that worked fine when you tested it.
 * This transport asks the provider on every request, so a rotated, refreshed
 * or newly-consented token is simply the one used next.
 *
 * **The token is never stored by this transport.** It is vended, applied to one
 * outgoing request, and dropped — it is not cached between requests, not held
 * on the transport object, and not written to any event, error message or log.
 * Build it with `gatewayTransport(...)` rather than by hand.
 */
export interface McpGatewayTransport {
  readonly transport: 'gateway';
  /** The MCP endpoint URL. */
  readonly url: string;
  /**
   * Who vends the token. Anything satisfying the `CredentialProvider` port —
   * `agentCoreIdentity()` for a managed token vault, `staticTokens()` in dev.
   */
  readonly credentials: CredentialProvider;
  /** The downstream service id the provider understands, e.g. `'gateway'`. */
  readonly service: string;
  /** OAuth scopes to request, when the provider uses them. */
  readonly scopes?: readonly string[];
  /** `machine` (2-legged, the default) or `user` (3-legged, on behalf of a user). */
  readonly mode?: 'machine' | 'user';
  /**
   * Extra headers sent alongside the vended ones (a tenant id, a correlation
   * id). Applied FIRST, so a vended auth header always wins — a static header
   * can never quietly shadow the credential.
   *
   * Put no secrets here: these are held for the life of the transport, which is
   * the property the vended ones exist to avoid.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

export type McpTransport = McpStdioTransport | McpHttpTransport | McpGatewayTransport;

// ─── Client options ────────────────────────────────────────────────

export interface McpClientOptions {
  /**
   * Logical name for observability + tool-call routing. Surfaces in
   * Lens chips and event payloads. Defaults to `'mcp'`. Recommend
   * setting per-server (`'slack-mcp'`, `'github-mcp'`) when you
   * connect to multiple servers.
   */
  readonly name?: string;

  /** Transport configuration — stdio or http. */
  readonly transport: McpTransport;

  /**
   * Optional client identity sent on connect. Default:
   * `{ name: 'agentfootprint', version: <package version> }`.
   */
  readonly clientInfo?: { readonly name: string; readonly version: string };

  /** Abort the connection / list / call paths. Honored by the SDK. */
  readonly signal?: AbortSignal;

  /**
   * What happens when the server says "too many requests" (HTTP 429). New in
   * 8.11.0, and **on by default**.
   *
   * Default: retry up to 3 times, waiting as long as the server's
   * `Retry-After` header asks (and, when it sends none, a jittered backoff),
   * never longer than 10 seconds of waiting in total across one call. Set
   * `false` to let a throttled call fail immediately, or pass an object to
   * tune the ceilings and to learn when it happens:
   *
   * ```ts
   * const gateway = await mcpClient({
   *   name: 'gateway',
   *   transport: gatewayTransport({ url, credentials }),
   *   retryOnThrottle: {
   *     maxAttempts: 5,
   *     onRetry: ({ attempt, waitMs, retryAfterMs }) =>
   *       log.warn({ attempt, waitMs, retryAfterMs }, 'gateway throttled'),
   *   },
   * });
   * ```
   *
   * **Why this is on by default.** A 429 is a *pre-execution rejection* — the
   * rate limiter refused the request at the edge and the server never ran the
   * tool, so a retry cannot double-execute anything. That is not true of a
   * 5xx or a timeout, where the call may have half-run, which is why this
   * retries 429 and nothing else. Managed gateways rate-limit per principal
   * by design, and without this a designed, self-clearing condition reached
   * the model as a thrown tool error it reads as "this tool is broken".
   *
   * Ignored for `stdio`, which has no HTTP status to read.
   */
  readonly retryOnThrottle?: RetryOnThrottle;

  /**
   * @internal Pre-built SDK client for tests. Skips SDK import +
   * transport construction. Same convention as `AnthropicProvider._client`.
   *
   * Because it skips transport construction it also skips everything the
   * transport carries — `headers`, `fetch`, a gateway's vending. Nothing about
   * authentication can be proven through this seam, which is why the signing
   * tests run against a real socket.
   */
  readonly _client?: McpSdkClient;
}

// ─── Public client surface ─────────────────────────────────────────

/**
 * What `mcpClient(opts)` returns. Connect once; call `.tools()` to
 * snapshot the tool list, `.refresh()` to re-list after the server's
 * tools change, `.close()` when done.
 */
export interface McpClient {
  /** Logical name from options (or default `'mcp'`). */
  readonly name: string;

  /**
   * List the server's tools as agentfootprint `Tool[]`. First call
   * after `mcpClient(...)` is the snapshot used to register on the
   * agent; subsequent calls re-fetch (cheap, in-memory cached by the
   * SDK between fetches).
   */
  tools(): Promise<readonly Tool[]>;

  /**
   * Force a refresh from the server. Use when you suspect the server
   * has dynamically added/removed tools mid-session (e.g., after the
   * server processes a config update).
   */
  refresh(): Promise<readonly Tool[]>;

  /** Close the underlying transport. After `close()` the client is unusable. */
  close(): Promise<void>;
}

// ─── SDK shim — minimal surface we need from @modelcontextprotocol/sdk ──

/**
 * Minimal structural type capturing the parts of the MCP SDK client
 * we touch. Defined locally so we can:
 *   1. Inject a mock for tests (`McpClientOptions._client`)
 *   2. Avoid a hard import on `@modelcontextprotocol/sdk` (which is
 *      a lazy peer-dep)
 *
 * The real SDK exports a richer surface; we narrow to what's needed.
 *
 * Argument POSITION matters here and is easy to get wrong: the SDK keeps
 * per-request options (`signal`, `timeout`) in a SEPARATE trailing
 * argument, never inside the JSON-RPC params. A `signal` smuggled into
 * the params object is serialized onto the wire as `{}` and silently
 * fails to cancel anything, so these signatures mirror the SDK's own
 * shape rather than a flattened convenience version of it.
 */
export interface McpSdkClient {
  connect(transport: unknown, options?: McpRequestOptions): Promise<void>;
  listTools(
    params?: undefined,
    options?: McpRequestOptions,
  ): Promise<{
    readonly tools: ReadonlyArray<{
      readonly name: string;
      readonly description?: string;
      readonly inputSchema: Readonly<Record<string, unknown>>;
    }>;
  }>;
  callTool(
    params: {
      readonly name: string;
      readonly arguments?: Readonly<Record<string, unknown>>;
    },
    /** The SDK's result schema. We always want its default, so we pass `undefined`. */
    resultSchema?: undefined,
    options?: McpRequestOptions,
  ): Promise<McpCallToolResult>;
  close(): Promise<void>;
}

/**
 * What `tools/call` can answer with — **a union, because the protocol is one.**
 *
 * The current shape carries `content` blocks. The 2024-10-07 shape carries a
 * bare `toolResult` and no `content` at all, and the SDK still accepts it: its
 * own declared return type for `callTool` is exactly this union, and servers
 * that predate the change are still running.
 *
 * It is spelled out here rather than narrowed away because a shim that promised
 * only the `content` arm made `result.content.map(...)` compile against a value
 * that can legitimately arrive without one. That failed two different ways,
 * both invisible to a compiler reading the old shim: **a crash** where the raw
 * legacy object reaches the reader (a caller-supplied `_client`, an SDK build
 * that does not normalise), and **a silently empty answer** where the SDK's own
 * result schema defaults `content` to `[]` beside the `toolResult` it could not
 * express. The union is what makes handling both arms a compile-time obligation
 * instead of a thing someone remembers.
 */
export type McpCallToolResult =
  | {
      readonly content: ReadonlyArray<{
        readonly type: string;
        readonly text?: string;
      }>;
      readonly isError?: boolean;
    }
  /** The 2024-10-07 arm. No `content`, and no `isError` — the shape predates it. */
  | { readonly toolResult: unknown };

/**
 * The SDK's trailing per-request options argument, narrowed to the one
 * field we forward from {@link McpClientOptions.signal}.
 */
export interface McpRequestOptions {
  readonly signal?: AbortSignal;
}

// ─── Serving: the other direction ──────────────────────────────────

/**
 * `stdio` transport — the server speaks MCP over its own stdin/stdout.
 * This is how a desktop MCP host launches a server: it spawns your
 * process and talks down the pipe. The default.
 *
 * One consequence worth stating out loud: stdout belongs to the
 * protocol. Anything else your process prints there corrupts the
 * stream, so log to stderr.
 */
export interface McpStdioServeTransport {
  readonly transport: 'stdio';
}

/**
 * `http` transport — the server listens on a port and speaks MCP over
 * Streamable HTTP. Stateless (no session ids): every request is
 * self-contained, which is what makes it safe to run several replicas
 * behind a load balancer.
 */
export interface McpHttpServeTransport {
  readonly transport: 'http';
  /** TCP port to listen on. */
  readonly port: number;
  /** Interface to bind. Defaults to Node's own default (all interfaces). */
  readonly host?: string;
  /** URL path the MCP endpoint answers on. Default `'/mcp'`. */
  readonly path?: string;
}

export type McpServeTransport = McpStdioServeTransport | McpHttpServeTransport;

export interface McpServeOptions {
  /**
   * Server name reported to clients on connect. Surfaces in the
   * client's server list. Default `'agentfootprint'`.
   */
  readonly name?: string;
  /** Server version reported to clients. Default `'0.0.0'`. */
  readonly version?: string;
  /** Transport configuration. Default `{ transport: 'stdio' }`. */
  readonly transport?: McpServeTransport;
  /**
   * Credential provider for served tools that declare `needs`. The
   * credential is resolved BEFORE `execute` and injected as
   * `ctx.credential`, exactly as the Agent's tool-call stage does it.
   *
   * Serving a `needs`-declaring tool without this is refused at
   * construction: the tool would run with `ctx.credential` undefined
   * and fail somewhere further in, or worse, not fail at all.
   */
  readonly credentials?: import('../../identity/types.js').CredentialProvider;
  /**
   * A `toolMiddleware` chain for the served boundary — the same chain type
   * `.toolMiddleware()` takes on an Agent, walked here before `execute`.
   *
   * It has to be passed explicitly because middleware belongs to an AGENT,
   * not to a `Tool`: serving a tool object serves the tool, and the governance
   * an agent wrapped around it does not travel inside it. Rather than let that
   * dead-end the rule, this option lets the served surface carry a chain of its
   * own — the 7.13 promise ("what you serve is what you passed in") extended
   * to "and what you asked to govern it".
   *
   * `ask` cannot survive this boundary: MCP is request/response and there is
   * no pause to carry the question. A middleware that asks here answers the
   * client with a tool error naming it, rather than executing ungoverned.
   */
  readonly toolMiddleware?: readonly import('../../core/agent/middleware/types.js').ToolMiddleware[];
  /**
   * @internal Pre-built SDK server for tests. Skips SDK import +
   * transport construction. Mirrors `McpClientOptions._client`.
   */
  readonly _server?: McpSdkServer;
}

/**
 * What `mcpServe(...)` returns. The server is already listening by the
 * time you hold this; `close()` is the only thing left to do.
 */
export interface McpServeHandle {
  /** Server name from options (or the default). */
  readonly name: string;
  /** Names of the tools being served, in the order clients will list them. */
  readonly toolNames: readonly string[];
  /**
   * The port the listener actually bound, for the `http` transport only —
   * absent for `stdio`, which has no socket.
   *
   * It is here because `port: 0` means "any free port", and the caller who
   * asked for one had no way to learn which one they got: the number the OS
   * chose lived inside a listener nobody could see. Serving on `0` and
   * reading this back is the supported way to run a server on an
   * unpredictable port — a test suite, a dev tool, several replicas on one
   * machine.
   *
   * With an explicit port this reports the same number back, so code can
   * read it unconditionally rather than branching on how the port was set.
   */
  readonly port?: number;
  /**
   * The address the listener bound, for the `http` transport only — as the
   * OS reports it, so `'127.0.0.1'` when a host was given and `'::'` (or
   * `'0.0.0.0'`) when one was not.
   *
   * Reported rather than assembled into a URL on purpose: a wildcard bind is
   * not an address a client can dial, and a handle that handed one out would
   * be inventing reachability it cannot promise. Pair it with `port` and the
   * host you know your callers can reach.
   */
  readonly address?: string;
  /**
   * Stop serving: closes the transport (and, for `http`, the listening
   * socket) and then the MCP server. Idempotent — calling it twice is
   * not an error, so a shutdown hook and an explicit close can coexist.
   */
  close(): Promise<void>;
}

/**
 * Minimal structural type for the parts of the MCP SDK's low-level
 * `Server` we touch. Defined locally for the same two reasons as
 * {@link McpSdkClient}: test injection via `McpServeOptions._server`,
 * and no hard import on the lazy peer-dep.
 */
export interface McpSdkServer {
  setRequestHandler(
    schema: unknown,
    handler: (request: McpCallToolRequest, extra: { readonly signal?: AbortSignal }) => unknown,
  ): void;
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

/**
 * The shape `tools/call` requests arrive in. `tools/list` requests carry
 * no params we read, so one request type covers both handlers.
 */
export interface McpCallToolRequest {
  readonly params?: {
    readonly name?: string;
    readonly arguments?: unknown;
  };
}
