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

import type { Tool } from '../tools/tools.js';
import type { CredentialProvider } from '../identity/types.js';
import type { RetryOnThrottle } from './throttleRetry.js';
import type { McpReplayOptions } from './replay.js';
import type { FetchLike } from './gatewayTransport.js';

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
  /**
   * What a library-built transport keeps inside its `fetch`, stated as data:
   * the settings that decide where a request lands and as whom, which no one can
   * read back out of a function. `agentCoreRuntimeMcpTransport` fills it (its
   * auth strategy, its session strategy, the bearer service, scopes and
   * credential provider id). `mcpClientPool` compares it, with the URL and the
   * header names, to decide whether two conversations open the same
   * configuration (`McpClientPoolOptions.definitions`).
   *
   * Never a secret: names and modes only. A transport you write by hand may
   * leave it out; your `configuration` name then covers what your `fetch` does.
   */
  readonly settings?: McpTransportSettings;
}

/**
 * The comparable settings of a transport — plain names and modes, never a
 * credential. See {@link McpHttpTransport.settings}.
 */
export type McpTransportSettings = Readonly<Record<string, string | readonly string[]>>;

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
  /**
   * A `fetch` of your own, called UNDERNEATH the per-request vending (9.32.0)
   * — the seam an mTLS agent or a DPoP signer goes into, so a caller no longer
   * has to abandon this transport (and its token rotation) to get one. The
   * credential is vended and applied FIRST, so your function sees the final
   * headers and has the last word over the bytes. Zero vendor code lives here.
   * See {@link GatewayTransportOptions.fetch} for the full contract.
   */
  readonly fetch?: FetchLike;
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

  /** How successful tool results are read. Omitted or `text` preserves the
   * existing text/legacy reader. `structured` requires a JSON object in
   * structuredContent. `structured-or-json` also accepts exactly one text
   * block containing a JSON object when structuredContent is absent. Neither
   * mode infers datasets, provenance or truth; use an execution adapter for
   * declared dataset handling. Malformed structured content never falls back.
   * Validation caps: 64 nested containers, 1,000,000 values; JSON text fallback
   * additionally caps input at 16,000,000 UTF-16 characters. These are result
   * decoding limits, not transport/download limits. */
  readonly resultMode?: 'text' | 'structured' | 'structured-or-json';

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
   * Default: up to 3 attempts, waiting as long as the server's `Retry-After`
   * header asks (and, when it sends none, a backoff of 200 ms doubling, with
   * equal jitter), never longer than 10 seconds of waiting in total across one
   * call. Set `false` to let a throttled call fail immediately, or pass an
   * object to tune the ceilings and the backoff (`baseDelayMs`, `multiplier`,
   * `jitter`, `maxDelayMs`, a `maxElapsedMs` deadline) and to learn when it
   * happens:
   *
   * ```ts
   * const gateway = await mcpClient({
   *   name: 'gateway',
   *   transport: gatewayTransport({ url, credentials }),
   *   retryOnThrottle: {
   *     maxAttempts: 5,
   *     onRetry: ({ kind, attempt, waitMs, retryAfterMs }) =>
   *       log.warn({ kind, attempt, waitMs, retryAfterMs }, 'gateway throttled'),
   *   },
   * });
   * ```
   *
   * Each call is ONE retry series (footprintjs's attempt runner). When the
   * transport's own fetch already retries — `agentCoreRuntimeMcpTransport`'s
   * session-busy retry — this 429 retry joins that series instead of wrapping
   * it: one attempt count, one waiting total and one deadline per call, with
   * the transport's `retry` values as the call's overall limits and these as
   * limits on the 429 retries inside them.
   *
   * **Who may ask again is {@link McpClientOptions.replay}'s.** These
   * options set the BUDGET of a call's retries; whether a tool call is sent
   * again at all is the replay policy's. Under the default (`'compatibility'`)
   * a 429 is repeated for every tool, ASSUMING the server refused it before
   * running it — HTTP 429 says only that the request was rate-limited (RFC 6585
   * §4) — and every such repeat records that assumption. A tool you declare as
   * making changes is never repeated without a deduplication key, and
   * `'app-authorized'` repeats only what you declare. `retryOnThrottle: false`
   * turns 429 retries off for this server, and nothing else: a tool declared
   * repeatable on `'network'`, and the `'app-authorized'` policy, keep their
   * series and their record. A 5xx is an answer and is never repeated.
   *
   * **Why this is on by default.** Managed gateways rate-limit per principal by
   * design, and without this a designed, self-clearing condition reached the
   * model as a thrown tool error it reads as "this tool is broken".
   *
   * Ignored for `stdio`, which has no HTTP status to read.
   */
  readonly retryOnThrottle?: RetryOnThrottle;

  /**
   * Who may send a tool call again, declared by YOU for this server's tools —
   * never by the model, a tool's description or the server's annotations
   * (`readOnlyHint`). Read once, here; a field it does not know is refused.
   *
   * ```ts
   * const orders = await mcpClient({
   *   name: 'orders',
   *   transport: { transport: 'http', url },
   *   replay: {
   *     policy: 'app-authorized',
   *     tools: {
   *       search_orders: { on: ['throttle', 'network'] },
   *       create_order: { on: ['throttle'], changes: true },
   *     },
   *     deduplicates: { argument: 'idempotency_key' },
   *   },
   * });
   * ```
   *
   *   - `policy: 'compatibility'` (the default, kept in 12.0) — today's
   *     behaviour, by name: a 429 is sent again for every tool, assuming the
   *     server refused it before running it. Each such retry records that
   *     assumption (`permission: { by: 'compatibility', assumes: 'refused-before-execution' }`).
   *     It gains none of the strict guarantees below.
   *   - `policy: 'app-authorized'` (opt-in, by name) — a 429
   *     (`'throttle'`) or a request that failed without an answer
   *     (`'network'`) is sent again only for a tool whose entry names it.
   *   - `changes: true` — the tool makes changes: never sent again
   *     automatically, under either policy, unless `deduplicates` is declared
   *     and the call carries the key. A key protects only when the server uses it.
   *
   * Under both policies the adapter you chose retries its own refusal —
   * AgentCore Runtime's session-busy reply — within the budget, as its policy:
   * each repeat records what it assumes, never proof that nothing ran. A
   * repeat re-sends the SAME request: the same arguments, server and session,
   * as the same identity. Each attempt's run record says what is known of its
   * effect — `unknown` for anything sent that did not complete, `applied` when
   * the call completed (never proof of a write) — and what permitted the next
   * one. Under `'app-authorized'`, a received refusal or error (a 429, a 503,
   * a JSON-RPC or tool error) reaches the caller as the server sent it, its
   * effect still unknown; a call that genuinely lacked an answer somewhere —
   * a request with no response, or one accepted over HTTP whose JSON-RPC
   * answer never came — and then fails, fails as "may have run"
   * (footprintjs's `UnknownEffectError`, its final error as the `cause`).
   * Under `'compatibility'` the caller sees the error it always did.
   *
   * `'app-authorized'` needs each request matched to its call and each answer
   * seen. A connection that cannot give both refuses each tool call BEFORE its
   * request is sent, with `McpReplayUnavailableError` and a typed `reason`: an
   * MCP SDK whose `connect` replaces the transport's `onmessage` handler
   * (`'answers-unobserved'`), one that drops the params' `_meta`
   * (`'request-unmatched'`), or a transport whose requests the library cannot
   * watch, such as `stdio` (`'requests-unwatched'`). Connecting and listing
   * tools still run; only the tool invocation is refused. An explicit
   * `'app-authorized'` never falls back to `'compatibility'`. Under
   * `'compatibility'`, `stdio` ignores it: it has no retry series.
   */
  readonly replay?: McpReplayOptions;

  /**
   * Pre-resolved SDK modules. Give these and the library never touches its Node
   * `require` loader — which is what lets a browser bundle speak MCP over
   * `http`, and what a server bundle (esbuild, webpack) needs too: a bundler
   * cannot follow the lazy `require`, so without `sdk` a bundled app that did
   * not ship `node_modules` is refused when the client is built.
   *
   * Everything else keeps working, because the library still builds the
   * transport: gateway vending, `retryOnThrottle`, `headers`, your own `fetch`,
   * `_meta` ingestion. Omit it and the loader runs exactly as it always has.
   * Either way the modules are read, and checked, when `mcpClient()` is
   * called — never at a later tool call.
   *
   * For `transport: 'stdio'` only `Client` is taken from here: stdio spawns a
   * subprocess and therefore cannot run in a browser at all, so that branch
   * keeps loading `client/stdio.js` through the Node loader, which is also what
   * keeps the SDK's only Node-bound client module off a browser's module graph.
   *
   * @see McpSdk for the two static imports that produce it.
   */
  readonly sdk?: McpSdk;

  /**
   * The JSON Schema validator a tool's `outputSchema` is checked with — the MCP
   * SDK's own validator interface (`new AjvJsonSchemaValidator()` from
   * `@modelcontextprotocol/sdk/validation/ajv`, `new CfWorkerJsonSchemaValidator()`,
   * or your own).
   *
   * Why it exists: the SDK's `Client` checks a tool's output only for the tools
   * of its most recent `tools/list` answer, so every tool the library hands out
   * carries its own checks, and runs them whenever the SDK no longer holds its
   * list: a paged list, a list a later answer replaced, a call made while a list
   * is read — of the lists `tools()` and `refresh()` read (see
   * `McpClient.tools()`; the client the library builds here never lists by
   * itself). The client the library builds is handed this same validator, so
   * one validator checks every call. Omit it and the library uses the SDK's
   * default, loaded with the SDK itself; with `sdk`, where the library never
   * touches its Node loader, such a call to a tool that declares an
   * `outputSchema` is refused (`McpOutputUncheckedError`) unless you pass one.
   */
  readonly jsonSchemaValidator?: McpJsonSchemaValidator;

  /** @see McpConnectionOptions — never set on this arm. */
  readonly connection?: undefined;

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

/**
 * The other arm of `mcpClient`: you connected the client, the library adapts it.
 *
 * Reach for this when the library must not construct anything at all — a
 * browser bundle behind a strict CSP, where you need the SDK's own
 * `jsonSchemaValidator` to keep ajv's code generation off the page; or any
 * transport this library has never heard of.
 *
 * The cost is stated rather than hidden: the library builds no transport here,
 * so every option that is consumed INSIDE a transport is refused rather than
 * accepted and ignored. `retryOnThrottle` becomes `retryingFetch` around
 * your own `fetch`; `clientInfo` and `headers` are yours to set when you
 * construct the client. `signal` IS honoured — it rides the SDK's trailing
 * request-options argument, not the transport.
 */
export interface McpConnectionOptions {
  /**
   * Logical name for observability + tool-call routing, exactly as on
   * {@link McpClientOptions}. Defaults to `'mcp'`.
   */
  readonly name?: string;

  /** Same decoding contract as McpClientOptions.resultMode; transport-independent. */
  readonly resultMode?: McpClientOptions['resultMode'];

  /**
   * A connection you already opened. The library never calls `connect()` on it;
   * `close()` on the returned client closes it exactly once.
   *
   * Leave its tool discovery to `mcpClient`: the per-tool checks hold only for
   * the lists `tools()` and `refresh()` read (see `McpClient.tools()`). Do not
   * let the SDK client refresh itself (`listChanged.tools` with `autoRefresh`,
   * which is on by default once `listChanged.tools` is given): set
   * `autoRefresh: false` and call `refresh()` from `onChanged`, or give
   * `mcpClient` a connection of its own.
   */
  readonly connection: McpConnection;

  /** Abort the list / call paths. Rides the SDK's request options. */
  readonly signal?: AbortSignal;

  /**
   * The JSON Schema validator your client checks tool output with — pass the
   * SAME one you gave its constructor (`jsonSchemaValidator`), or the SDK's
   * default, `new AjvJsonSchemaValidator()`.
   *
   * The SDK's `Client` checks a tool's output only for the tools of its most
   * recent `tools/list` answer, so the library checks a tool itself, with this,
   * whenever the SDK no longer holds its list: a paged list, a list a later
   * answer replaced, a call made while a list is read. Without it, such a call
   * to a tool that declares an `outputSchema` is refused
   * (`McpOutputUncheckedError`); a one-page catalogue that is still the latest
   * answer never needs it. It covers only the lists `tools()` and `refresh()`
   * read: when the SDK client's cache is replaced some other way (its own
   * automatic refresh, a `listTools` call of yours), the library still leaves
   * the call to the SDK, and this validator is never asked (see
   * `McpClient.tools()`).
   */
  readonly jsonSchemaValidator?: McpJsonSchemaValidator;

  /** @see McpClientOptions — never set on this arm. */
  readonly transport?: undefined;
  /** @see McpClientOptions — never set on this arm. */
  readonly sdk?: undefined;
  /** @see McpClientOptions — never set on this arm. */
  readonly clientInfo?: undefined;
  /** @see McpClientOptions — never set on this arm. */
  readonly retryOnThrottle?: undefined;
  /** @see McpClientOptions — never set on this arm. */
  readonly replay?: undefined;
  /** @internal @see McpClientOptions — never set on this arm. */
  readonly _client?: undefined;
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
   *
   * Every page of the server's `tools/list` answer is read: the client
   * follows `nextCursor` until a page carries none, sending at most 100
   * `tools/list` requests (a bound on requests, not on the catalogue's size).
   * A list that does not end within them, or that names a cursor it already
   * sent (a loop), is never returned cut short: the call rejects with
   * `McpToolListIncompleteError`, whose `reason` says which and whose `tools`
   * holds what was listed. `signal` rides every page and is checked before
   * each page is asked for and when each answer arrives: once it has fired,
   * nothing more is asked for and no page is accepted.
   *
   * Every tool keeps its checks, whatever `tools()` and `refresh()` list later —
   * those of any `mcpClient` over the same client included. That holds only
   * while all tool discovery on the client runs through them; see below. The
   * SDK's `Client` checks a tool's call (a required task refused before
   * sending; `structuredContent` required by an `outputSchema`, and matched
   * against it) only for the tools of its most recent `tools/list` answer, so
   * every tool returned here carries those checks itself. They are left to the
   * SDK only for a tool of a one-page list whose answer is still the latest,
   * with no list request out. Every other call runs the tool's own and fails
   * with the same error: a paged list's tools, a tool held across a later
   * `refresh()` (failed or not), a call made while a list is read. Where no JSON
   * Schema validator is reachable (`jsonSchemaValidator` on the `sdk` and
   * `connection` arms), such a call to a tool that declares an `outputSchema` is
   * refused with `McpOutputUncheckedError`: before it is sent, or, when a list
   * was read while it was out, once its answer is in, unread.
   *
   * What it does not cover: a listing the library does not send. Your own
   * `listTools` calls, the SDK client's automatic discovery (`listChanged.tools`
   * with `autoRefresh`, on by default once `listChanged.tools` is given), or any
   * other replacement of the SDK client's cache leave a tool handed out here
   * believing the SDK still holds its checks — so neither its output checks nor
   * its required-task refusal run, even with `jsonSchemaValidator`. The client
   * the library builds (the `transport` and `sdk` arms) never lists by itself;
   * on a client you pass as `connection`, set `autoRefresh: false` and call
   * `refresh()` from `onChanged`, or give `mcpClient` a connection of its own.
   */
  tools(): Promise<readonly Tool[]>;

  /**
   * Force a refresh from the server. Use when you suspect the server
   * has dynamically added/removed tools mid-session (e.g., after the
   * server processes a config update). Reads every page, as `tools()` does.
   * When it fails it rejects, and `tools()` keeps serving the catalogue it
   * had: those tools keep their own checks (see `tools()`). Route the server's
   * list-changed notice here, rather than letting the SDK client refresh
   * itself: a listing the library does not send is not covered.
   */
  refresh(): Promise<readonly Tool[]>;

  /**
   * Close the underlying transport. After `close()` the client is unusable.
   *
   * `close()` does not end the remote session; `terminate()` does, and says
   * whether it did.
   */
  close(): Promise<void>;

  /**
   * End the remote session, then close locally, whatever happened — and say
   * what the remote side answered (`McpTerminateOutcome`).
   *
   * Optional: a capability, not a required member, so a hand-written
   * `McpClient` keeps compiling. Ask {@link canTerminate} before calling it.
   * `mcpClient()` and `mockMcpClient()` provide it.
   *
   * It sends the transport's own session termination (Streamable HTTP: a
   * `DELETE` carrying `Mcp-Session-Id`) and reads the status itself, because
   * the MCP SDK treats a 405 as success. The wait is bounded: after
   * `TOOL_TEARDOWN_TIMEOUT_MS` (5 s) the request is aborted and the outcome is
   * `'timed-out'`. Ends the client at most once: a second call answers the
   * first outcome. Never throws for a remote failure; the outcome says it.
   *
   * @throws when called after `close()`, like every other method
   */
  terminate?(): Promise<McpTerminateOutcome>;
}

/**
 * What ending a client's remote session came to — `McpClient.terminate()`.
 *
 * `resolved` is true only when the remote side is known not to hold the session
 * any more: `'terminated'`, `'already-gone'`, `'no-session'`. Every other
 * outcome leaves the remote session to its own timeout, which nothing in this
 * process can shorten. Local settlement and remote resolution are different
 * facts: an ending can settle here and stay unresolved there.
 */
export interface McpTerminateOutcome {
  /**
   * - `'terminated'` — 2xx: the remote side ended the session it held.
   * - `'already-gone'` — 404: it no longer held it.
   * - `'no-session'` — nothing to end: no session id was ever issued (a
   *   `'per-call'` runtime transport, a server that issues none, stdio, the mock).
   * - `'not-offered'` — 405: the server does not end sessions on request.
   * - `'failed'` — the request failed (another status, or no answer).
   * - `'timed-out'` — the local wait ended first, and the request was aborted.
   * - `'handle-lost'` — this process no longer holds the session's handle, so
   *   nothing could be sent (`LocalSessionHandleLostError`).
   * - `'unavailable'` — a client built on `connection`: the library did not
   *   build its transport, so it cannot end the session.
   */
  readonly remote:
    | 'terminated'
    | 'already-gone'
    | 'no-session'
    | 'not-offered'
    | 'failed'
    | 'timed-out'
    | 'handle-lost'
    | 'unavailable';
  /** True only for `'terminated'`, `'already-gone'` and `'no-session'`. */
  readonly resolved: boolean;
  /** The HTTP status the remote side answered with, when one was read. */
  readonly status?: number;
  /** A failure's class name — never its message. */
  readonly errorClass?: string;
  /** How long the ending took, as the caller waited for it. */
  readonly durationMs: number;
}

// ─── SDK shim — minimal surface we need from @modelcontextprotocol/sdk ──

/**
 * A live MCP connection you opened and connected yourself.
 *
 * This is the whole contract this library needs from an MCP client: three
 * methods over JSON-RPC. Nothing in it names a vendor, so an SDK `Client`, a
 * hand-written fake, or a future fetch-only transport all satisfy it.
 *
 * Pass one as `mcpClient({ connection })` when the library must not load the
 * SDK itself — a browser bundle, where the Node `require` loader does not
 * exist. You own construction, so you also own the transport's `fetch`, its
 * headers, its auth, and (SDK-specific) its `jsonSchemaValidator`, which is the
 * one way to keep ajv's `new Function` off a page with a strict CSP.
 *
 * What you give up by owning it: this library builds no transport on that arm,
 * so `retryOnThrottle` has nothing to wrap. Wrap your own fetch with
 * `retryingFetch` and the 429 handling comes back.
 *
 * Argument POSITION matters here and is easy to get wrong: the SDK keeps
 * per-request options (`signal`, `timeout`) in a SEPARATE trailing argument,
 * never inside the JSON-RPC params. A `signal` smuggled into the params object
 * is serialized onto the wire as `{}` and silently fails to cancel anything, so
 * these signatures mirror the SDK's own shape rather than a flattened
 * convenience version of it.
 */
export interface McpConnection {
  /**
   * One page of the server's tool list. The first page is asked with no params;
   * each later page with the `nextCursor` the page before it returned, as
   * `{ cursor }`. A connection that never pages returns no `nextCursor`.
   */
  listTools(
    params?: { readonly cursor?: string },
    options?: McpRequestOptions,
  ): Promise<{
    readonly tools: ReadonlyArray<McpListedTool>;
    /** Present while the server has more tools: what to ask for the next page with. */
    readonly nextCursor?: string;
  }>;
  callTool(
    params: {
      readonly name: string;
      readonly arguments?: Readonly<Record<string, unknown>>;
      /**
       * The request's metadata bag (MCP's `_meta` on request params). The
       * client sends `{ agentfootprint: { time } }` only on a call handed
       * `ctx.time` (the time layer); every other call sends no `_meta` key.
       */
      readonly _meta?: Readonly<Record<string, unknown>>;
    },
    /** The SDK's result schema. We always want its default, so we pass `undefined`. */
    resultSchema?: undefined,
    options?: McpRequestOptions,
  ): Promise<McpCallToolResult>;
  close(): Promise<void>;
}

/**
 * Minimal structural type capturing the parts of the MCP SDK client
 * we touch. Defined locally so we can:
 *   1. Inject a mock for tests (`McpClientOptions._client`)
 *   2. Avoid a hard import on `@modelcontextprotocol/sdk` (which is
 *      a lazy peer-dep)
 *
 * The real SDK exports a richer surface; we narrow to what's needed.
 *
 * Member set unchanged since it was introduced: {@link McpConnection} plus the
 * one method the library calls when it opens the connection ITSELF. The split
 * is what lets a caller hand over a client that is already connected without
 * also promising a `connect` this library must never call on it.
 */
export interface McpSdkClient extends McpConnection {
  connect(transport: unknown, options?: McpRequestOptions): Promise<void>;
}

/**
 * The two `@modelcontextprotocol/sdk` module exports the Streamable HTTP path
 * needs, typed STRUCTURALLY so this declaration never references the optional
 * peer — a consumer without the SDK installed still typechecks.
 *
 * Hand these to `mcpClient({ sdk })` and the library never touches its Node
 * `require` loader, which is what lets a browser bundle speak MCP over `http`.
 * Everything else keeps working, because the library still builds the
 * transport: gateway vending, `retryOnThrottle`, `headers`, your own `fetch`,
 * `_meta` ingestion.
 *
 * Load them yourself with two static imports. The subpaths matter: the SDK's
 * root export `"."` does not resolve (it declares no `dist/esm/index.js`), and
 * `client/stdio.js` is the one client module that imports `node:process` and
 * `node:stream` — importing it is what would drag Node into a browser graph.
 *
 * ```ts
 * import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 * import { StreamableHTTPClientTransport }
 *   from '@modelcontextprotocol/sdk/client/streamableHttp.js';
 *
 * const client = await mcpClient({
 *   name: 'sidecar',
 *   sdk: { Client, StreamableHTTPClientTransport },
 *   transport: { transport: 'http', url: '/py/mcp' },
 * });
 * ```
 */
export interface McpSdk {
  readonly Client: new (
    info: { name: string; version: string },
    options: { capabilities: Record<string, unknown> },
  ) => McpSdkClient;
  readonly StreamableHTTPClientTransport: new (
    url: URL,
    options?: {
      requestInit?: { headers: Record<string, string> };
      /**
       * The SDK's hook for a custom fetch — how per-request vending AND
       * caller-supplied signing both get in. Typed exactly as the SDK types it,
       * so a function this shim accepts is a function the real transport
       * accepts.
       */
      fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
    },
  ) => unknown;
}

/**
 * One entry of a `tools/list` answer, narrowed to what this client reads.
 *
 * `_meta` is the spec's own extensibility bag on a `Tool` object, and it is in
 * this shim because agentfootprint's tool DECLARATIONS ride in it under one
 * namespaced key (see `toolExtras.ts`). It is typed as a loose record on
 * purpose: everything in it is written by a server this process does not
 * control, so the shim promises only that it is an object, and
 * `readToolExtras` does the judging.
 */
export interface McpListedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** MCP's extensibility bag. Absent from most servers' tools. */
  readonly _meta?: Readonly<Record<string, unknown>>;
  /**
   * What the tool's `structuredContent` must match. Read for the one reason the
   * SDK's `Client` reads it: a tool that declares one must answer with
   * matching `structuredContent` (see `McpClient.tools()` for a paged list).
   */
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  /** How the tool may run: `taskSupport: 'required'` means only as a task, never a plain `tools/call`. */
  readonly execution?: { readonly taskSupport?: string };
}

/**
 * A JSON Schema validator, as the MCP SDK's `Client` takes one
 * (`jsonSchemaValidator`): `getValidator(schema)` compiles a schema once and
 * returns a function that checks one value against it. Typed STRUCTURALLY so
 * this declaration never references the optional peer; the SDK's own
 * `AjvJsonSchemaValidator` and `CfWorkerJsonSchemaValidator` satisfy it.
 */
export interface McpJsonSchemaValidator {
  getValidator(schema: object): (input: unknown) => {
    readonly valid: boolean;
    readonly errorMessage?: string;
  };
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
      /** MCP's optional object result. Ignored by the default text reader;
       * validated before return when a structured resultMode is selected. */
      readonly structuredContent?: Readonly<Record<string, unknown>>;
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
  /**
   * The page origins allowed to reach this endpoint from a browser — the
   * hosting door guard's own rule (`CrossSiteOptions.allowedOrigins`).
   *
   * The transport specification requires it: servers "MUST validate the
   * `Origin` header on all incoming connections to prevent DNS rebinding
   * attacks". A request whose `Origin` is not allowed — `null` included — or
   * that the browser marked `Sec-Fetch-Site: cross-site` without a listed
   * origin is refused with 403 before any tool runs. A request with no `Origin`
   * is a native client or a server and is served as before.
   *
   * Unset: a browser page may reach it only from this endpoint's own host —
   * which a DNS-rebinding page also satisfies, so set `allowedHosts` too.
   * `'any'` turns the check off.
   */
  readonly allowedOrigins?: readonly string[] | 'any';
  /**
   * The names this endpoint answers for — `['tools.corp.example']`. Any other
   * `Host` is refused with 421 before any tool runs: the DNS-rebinding
   * defence. Unset on a LOOPBACK `host` (`127.0.0.1`, `::1`, `localhost`):
   * the loopback names only, silently — such a socket has no other name.
   * Unset on any other bind (including the all-interfaces default): every Host
   * is served and ONE warning at start names this option. `'any'` serves every
   * Host on purpose and prints nothing.
   *
   * The hosting guard's JSON rule applies too: a POST that does not say
   * `content-type: application/json` is refused with 415 by this library,
   * whatever the installed SDK version would have done.
   */
  readonly allowedHosts?: readonly string[] | 'any';
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
  readonly credentials?: import('../identity/types.js').CredentialProvider;
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
  readonly toolMiddleware?: readonly import('../core/agent/middleware/types.js').ToolMiddleware[];
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
    /** The request's own metadata bag — `agentfootprint.time` carries the call's time (`ctx.time`). */
    readonly _meta?: unknown;
  };
}
