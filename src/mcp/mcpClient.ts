/**
 * mcpClient — connect to an MCP server, expose its tools to your Agent.
 *
 *   const slack = await mcpClient({
 *     name: 'slack',
 *     transport: { transport: 'stdio', command: 'npx', args: ['@example/slack-mcp'] },
 *   });
 *
 *   const tools = await slack.tools();   // → readonly Tool[]
 *   const agent = Agent.create({ ... }).tools(tools).build();
 *
 *   // ...
 *
 *   await slack.close();
 *
 * Pattern: Adapter (GoF) — translates MCP `listTools()` / `callTool()`
 *          into agentfootprint's `Tool` interface (schema + execute).
 *          Each MCP tool becomes ONE agentfootprint Tool. The agent's
 *          existing tool-call handler invokes `client.callTool()`
 *          inside the wrapped `execute`.
 *
 * Role:    Layer-3 integration. Sits next to `defineTool` — same
 *          shape, different source. Once tools land on the agent,
 *          the rest of the library doesn't know they came from MCP.
 *          Since 9.71.0 that is true of DECLARATIONS too: a server's
 *          `_meta` bag becomes `argumentsFrom` / `resultKind` / `owner`
 *          / `resultClass` / `resultCeiling` on the registered `Tool`,
 *          so the integrity checks, the placement mint and the identity
 *          joins arm for a remote tool exactly as for a local one. The
 *          reading NEVER throws — see `toolExtras.ts`.
 *
 * Emits:   N/A — wrapped tools emit the standard
 *          `agentfootprint.stream.tool_start` / `tool_end` events
 *          when the agent calls them. Add `name: '<mcp-server>'` to
 *          `McpClientOptions` so observability surfaces can group
 *          tool calls by server. On a transport this module builds,
 *          a call the agent dispatched also gets its request's retry
 *          series as `agentfootprint.tools.request_attempts`, filed by
 *          the series through the call's own port (`requestLedger.ts`).
 *
 * Lazy-require pattern: the `@modelcontextprotocol/sdk` peer-dep
 * loads only when a consumer actually constructs a client. Tests
 * inject `_client` and skip the import path entirely.
 */

import { isDevMode } from 'footprintjs';

import type { Tool } from '../tools/tools.js';
import type {
  McpCallToolResult,
  McpClient,
  McpClientOptions,
  McpConnection,
  McpConnectionOptions,
  McpJsonSchemaValidator,
  McpListedTool,
  McpSdk,
  McpSdkClient,
  McpTransport,
} from './types.js';
import { callMetaOf, readToolExtras } from './toolExtras.js';
import { isToolError, readToolResult, resultModeOf } from './toolResult.js';
import { listEveryPage, McpToolListIncompleteError } from './toolList.js';
import { listingsOf } from './listingGenerations.js';
import {
  callCheckKit,
  checkOutput,
  checksFor,
  McpOutputUncheckedError,
  outputUnchecked,
  refuseRequiredTask,
  validatorOption,
  type CallCheckKit,
  type CallChecks,
} from './callChecks.js';
import { createVendingFetch } from './gatewayTransport.js';
import {
  ledgeredFetch,
  retryingFetch,
  seriesWithoutThrottle,
  type RetryOnThrottle,
  type ThrottleFetch,
} from './throttleRetry.js';
import { RequestLedger } from './requestLedger.js';
import { openCall } from './callLifetime.js';
import { McpReplayUnavailableError, unavailableBeforeSending } from './replayUnavailable.js';
import {
  needsSeries,
  replayDeclarationOf,
  type CallVerdict,
  type ReplayDeclaration,
} from './replay.js';
import { refuseConflictingOptions } from './connectionRefusals.js';
import { sdkLoadFailure } from './sdkLoadFailure.js';
import { transportUrl } from './transportUrl.js';
import { lazyRequire } from '../lib/lazyRequire.js';
import {
  rememberHalfOpen,
  type ClientListing,
  type ClientPort,
  type PooledClientSeam,
} from './clientPort.js';
import type { RequestGuard } from './requestGuard.js';
import {
  DeleteWatch,
  endSession,
  outcomeWithout,
  type Ending,
  type TerminableTransport,
} from './terminate.js';

// Version-less identity. The MCP `clientInfo` field is informational
// (server logs it); a hardcoded number drifts every release. Consumers
// who care about wire-level identity pass `clientInfo` explicitly.
const DEFAULT_CLIENT_INFO = {
  name: 'agentfootprint',
  version: '0.0.0',
};

/**
 * Connect to an MCP server. Returns an `McpClient` that exposes the
 * server's tools as agentfootprint `Tool[]` and a `close()` to tear
 * down the transport.
 *
 * Three ways to get a connection, and they are three because a browser can
 * only take the last two:
 *
 *   - `{ transport }` — the library loads the SDK through its Node loader and
 *     builds everything. The default, and what every Node consumer already
 *     does.
 *   - `{ transport, sdk }` — you supply the two SDK modules with static
 *     imports; the library still builds the transport, so gateway vending,
 *     `retryOnThrottle`, `headers` and your own `fetch` all keep working.
 *   - `{ connection }` — you built and connected the client yourself; the
 *     library only adapts its tools.
 *
 * @throws when the two arms are mixed, when a `connection` is not one, or when
 *   `@modelcontextprotocol/sdk` cannot be loaded (the message says which of
 *   "not installed" and "no Node loader here" actually happened), or when the
 *   transport fails to connect.
 */
export async function mcpClient(opts: McpClientOptions | McpConnectionOptions): Promise<McpClient> {
  return (await connectClient(opts)).client;
}

/**
 * @internal The MCP client pool's way to open a client (`mcp/pool/`): an
 * ordinary `mcpClient` — the same discovery, checks, ledger and retry series —
 * plus what only a pool asks for (`clientPort.ts`), and the port back.
 */
export async function openPooledClient(
  opts: McpClientOptions,
  seam: PooledClientSeam,
): Promise<{ readonly client: McpClient; readonly port: ClientPort }> {
  return connectClient(opts, seam);
}

/** The one construction path behind `mcpClient` and the pool's opener. */
async function connectClient(
  opts: McpClientOptions | McpConnectionOptions,
  seam?: PooledClientSeam,
): Promise<{ readonly client: McpClient; readonly port: ClientPort }> {
  const name = opts.name ?? 'mcp';
  const resultMode = resultModeOf(opts.resultMode, name);
  // Before anything connects: an option that names a behaviour which cannot
  // happen on the chosen arm is a defect, not a preference.
  refuseConflictingOptions(opts, name);
  // The app's replay declaration — who may send a tool call again — read and
  // checked once, here, before anything connects (`replay.ts`).
  const replay = replayDeclarationOf(opts.replay, `mcpClient[${name}]`);
  const strict = replay.policy === 'app-authorized';
  // The validator a tool's own output checks use (`callChecks.ts`), refused by
  // name now when it is not one.
  const validator = validatorOption(opts.jsonSchemaValidator, `mcpClient[${name}]`);
  const { connection, ledger, kit, ending } = await openConnection(
    opts,
    replay,
    name,
    validator,
    seam,
  );
  const unlisted = new Set<string>();

  // Tool cache so consumers calling `.tools()` more than once don't
  // hammer the server. `.refresh()` invalidates it.
  let cache: readonly Tool[] | null = null;
  let closed = false;
  // The one ending this client gets (`terminate.ts`): `terminate()` asks for it
  // once, and every later call answers the same outcome.
  let ended: Ending | undefined;

  const ensureOpen = (op: string): void => {
    if (closed) {
      throw new Error(
        `mcpClient[${name}].${op}() called after close(). Construct a new client to reconnect.`,
      );
    }
  };

  const listWith = async (signal: AbortSignal | undefined): Promise<ClientListing> => {
    // Every page of the server's list (`toolList.ts`). `signal` rides each
    // page in the SDK's trailing options argument, never in the params — see
    // `wrapMcpTool`.
    // Each page request is counted in this connection's listings, whatever it
    // settles to (`listingGenerations.ts`).
    const listing = await listEveryPage(connection, signal, kit.listings);
    // A list that did not end cannot say which entries name nothing.
    if (listing.incomplete === undefined) noteUnlisted(replay, listing.tools, name, unlisted);
    // Every tool carries the checks of the list it came from (`callChecks.ts`):
    // the SDK's `Client` holds them only while a one-page list's answer is its
    // latest, and only then are they left to it.
    const tools = listing.tools.map((t) =>
      wrapMcpTool(
        name,
        connection,
        t,
        opts.signal,
        resultMode,
        ledger,
        strict,
        checksFor(t, kit, listing.generation),
      ),
    );
    // Never a list cut short: what was listed travels on the refusal instead.
    if (listing.incomplete !== undefined) {
      throw new McpToolListIncompleteError(listing.incomplete, name, listing.pages, tools);
    }
    return { tools, listed: listing.tools };
  };
  const buildTools = async (): Promise<readonly Tool[]> => (await listWith(opts.signal)).tools;

  const closeLocally = async (): Promise<void> => {
    try {
      await connection.close();
    } finally {
      // Nothing this connection sent is awaited any more, however it closed.
      ledger?.close();
    }
  };
  // The remote session ended, then the local side — at most once.
  const end = (): Ending => {
    if (ended !== undefined) return ended;
    closed = true;
    cache = null;
    ended = ending(closeLocally);
    return ended;
  };

  const client: McpClient = {
    name,
    async tools(): Promise<readonly Tool[]> {
      ensureOpen('tools');
      if (!cache) cache = await buildTools();
      return cache;
    },
    async refresh(): Promise<readonly Tool[]> {
      ensureOpen('refresh');
      cache = await buildTools();
      return cache;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      cache = null;
      await closeLocally();
    },
    async terminate() {
      if (ended !== undefined) return ended.outcome;
      ensureOpen('terminate');
      return end().outcome;
    },
  };
  const port: ClientPort = {
    async listing(signal) {
      ensureOpen('tools');
      const listing = await listWith(signal);
      cache = listing.tools;
      return listing;
    },
    bind: (listed) =>
      // No listing generation: this connection's SDK holds no checks for a
      // definition it did not list, so the tool always runs its own.
      wrapMcpTool(
        name,
        connection,
        listed,
        opts.signal,
        resultMode,
        ledger,
        strict,
        checksFor(listed, kit, undefined),
      ),
    end,
  };
  return { client, port };
}

// ─── Getting a connection ──────────────────────────────────────────

/** A connection, and — when the library built its transport — the ledger its requests are claimed by. */
interface OpenConnection {
  readonly connection: McpConnection;
  readonly ledger?: RequestLedger;
  /** What its tools' own checks run with, and its list requests counted (`callChecks.ts`). */
  readonly kit: CallCheckKit;
  /** How this connection's remote session is ended, given its local close (`terminate.ts`). */
  readonly ending: (close: () => Promise<void>) => Ending;
}

/** An ending that sends nothing: the local close, and the outcome that says why. */
function endingWithout(remote: 'no-session' | 'unavailable'): OpenConnection['ending'] {
  return (close) => {
    const settled = Promise.resolve()
      .then(close)
      .then(
        () => undefined,
        () => undefined,
      );
    return { outcome: settled.then(() => outcomeWithout(remote)), settled };
  };
}

/**
 * The one funnel every arm passes through, in precedence order: a connection
 * you handed over, the internal test seam, then the library building one.
 * Only the last has a ledger: a connection built elsewhere has no retry series
 * of ours to file a call's attempts.
 *
 * A call with neither `connection` nor `sdk` reaches `resolveClient` with two
 * `undefined` arguments and takes the identical path it always took.
 */
async function openConnection(
  opts: McpClientOptions | McpConnectionOptions,
  replay: ReplayDeclaration,
  name: string,
  validator: McpJsonSchemaValidator | undefined,
  seam: PooledClientSeam | undefined,
): Promise<OpenConnection> {
  // A client built elsewhere: the library loads nothing, so only the caller's
  // validator can check a tool's output itself, and errors take the SDK's shape.
  // Its list requests are counted per client: every mcpClient over it shares one
  // count, as they share the SDK's one set of checks (`listingGenerations.ts`).
  // The library did not build its transport, so it cannot end the session.
  if (opts.connection !== undefined) {
    const kit = callCheckKit(name, listingsOf(opts.connection), validator);
    return { connection: opts.connection, kit, ending: endingWithout('unavailable') };
  }
  if (opts._client !== undefined) {
    return {
      connection: opts._client,
      kit: callCheckKit(name, listingsOf(opts._client), validator),
      ending: endingWithout('unavailable'),
    };
  }
  // `refuseConflictingOptions` has already refused the case where this is
  // absent, so the assertion documents that guarantee rather than assuming it.
  const transport = opts.transport as McpTransport;
  return resolveClient(
    transport,
    opts.clientInfo,
    opts.signal,
    opts.retryOnThrottle,
    opts.sdk,
    replay,
    name,
    validator,
    seam,
  );
}

// ─── SDK construction (lazy require, unless the caller supplied it) ─

async function resolveClient(
  transport: McpTransport,
  clientInfo?: { name: string; version: string },
  signal?: AbortSignal,
  retryOnThrottle?: RetryOnThrottle,
  sdk?: McpSdk,
  replay?: ReplayDeclaration,
  name = 'mcp',
  validator?: McpJsonSchemaValidator,
  seam?: PooledClientSeam,
): Promise<OpenConnection> {
  if (sdk !== undefined) assertSdk(sdk, transport.transport);
  const mod: McpSdkExports = sdk ?? loadClientModule();

  // A caller's validator is the client's too, so one validator checks every
  // page; without one, the options are exactly what they always were. A pooled
  // client hears the server's tools-changed notice with the SDK's automatic
  // refresh OFF: the notice only makes the pool list again, through this
  // client's own discovery, which counts every listing (`listingGenerations.ts`).
  const options: {
    capabilities: Record<string, unknown>;
    jsonSchemaValidator?: unknown;
    listChanged?: unknown;
  } =
    validator === undefined
      ? { capabilities: {} }
      : { capabilities: {}, jsonSchemaValidator: validator };
  if (seam !== undefined) {
    options.listChanged = {
      tools: { autoRefresh: false, debounceMs: 0, onChanged: () => seam.onToolsChanged() },
    };
  }
  const client: McpSdkClient = new mod.Client(clientInfo ?? DEFAULT_CLIENT_INFO, options);

  const built = await buildTransport(transport, retryOnThrottle, sdk, replay, name, seam);
  // With the SDK loaded here, so is what a tool's own checks run with: its
  // default validator and its own error class. With `sdk`, the loader is never
  // touched (`callChecks.ts`).
  const kit =
    sdk === undefined
      ? callCheckKit(name, listingsOf(client), validator, loadCheckModules(validator))
      : callCheckKit(name, listingsOf(client), validator);
  // Same rule as callTool: options ride beside the transport, never inside it.
  // A pooled client connects under the pool's own signal and open deadline;
  // its lifetime signal (`signal`) rides every later request.
  const connectSignal = seam?.connectSignal ?? signal;
  try {
    if (connectSignal) await client.connect(built.transport, { signal: connectSignal });
    else await client.connect(built.transport);
  } catch (error) {
    // A pooled open that failed may still have opened a session on the server:
    // the pool can end it once the open's work has settled (`clientPort.ts`).
    if (seam !== undefined) {
      const transport = built.transport as { readonly sessionId?: string };
      rememberHalfOpen(error, {
        hasSession: () => transport?.sessionId !== undefined,
        end: () =>
          built.ending(async () => {
            try {
              await client.close();
            } finally {
              built.ledger?.close();
            }
          }),
      });
    }
    throw error;
  }
  return {
    connection: client,
    kit,
    ...(built.ledger !== undefined && { ledger: built.ledger }),
    ending: built.ending,
  };
}

/**
 * What the SDK's `Client` checks a tool's call with, loaded with the SDK on the
 * Node loader path (the bundling law: when the client is built, never at a
 * later tool call): its own `McpError`, and — unless the caller gave a
 * validator — its default validator, `AjvJsonSchemaValidator`. Both modules are
 * the ones `client/index.js` already loaded. An SDK without one of them (older
 * than its public validator subpath) leaves that slot empty: errors then take
 * the SDK's shape, and an output no validator here can check is never returned.
 */
function loadCheckModules(validator: McpJsonSchemaValidator | undefined): {
  readonly McpError?: unknown;
  readonly Validator?: unknown;
} {
  const McpError = loadOptional<{ McpError?: unknown }>(() =>
    lazyRequire<{ McpError?: unknown }>('@modelcontextprotocol/sdk/types.js'),
  )?.McpError;
  const Validator =
    validator === undefined
      ? loadOptional<{ AjvJsonSchemaValidator?: unknown }>(() =>
          lazyRequire<{ AjvJsonSchemaValidator?: unknown }>(
            '@modelcontextprotocol/sdk/validation/ajv',
          ),
        )?.AjvJsonSchemaValidator
      : undefined;
  return { McpError, Validator };
}

/** A module this SDK may not have: `undefined` when it cannot be loaded. */
function loadOptional<T>(load: () => T): T | undefined {
  try {
    return load();
  } catch {
    return undefined;
  }
}

/**
 * An injected `sdk` is checked before anything is built, so a wrong import (a
 * namespace object, one module of the two) is refused by name here rather
 * than surfacing later as "x is not a constructor".
 */
function assertSdk(sdk: McpSdk, transport: McpTransport['transport']): void {
  const needed: ReadonlyArray<keyof McpSdk> =
    transport === 'stdio' ? ['Client'] : ['Client', 'StreamableHTTPClientTransport'];
  const given = sdk as unknown as Readonly<Record<string, unknown>> | null;
  const missing = needed.filter(
    (key) => typeof given !== 'object' || given === null || typeof given[key] !== 'function',
  );
  if (missing.length === 0) return;
  const sources: Record<keyof McpSdk, string> = {
    Client: "`import { Client } from '@modelcontextprotocol/sdk/client/index.js'`",
    StreamableHTTPClientTransport:
      '`import { StreamableHTTPClientTransport } from ' +
      "'@modelcontextprotocol/sdk/client/streamableHttp.js'`",
  };
  throw new TypeError(
    `mcpClient: \`sdk\` has no ${missing.map((key) => `\`${key}\``).join(' or ')} constructor. ` +
      `Pass ${needed.length > 1 ? 'the classes themselves' : 'the class itself'}: ` +
      `${needed.map((key) => sources[key]).join(', ')}, ` +
      `then \`sdk: { ${needed.join(', ')} }\`.`,
  );
}

/** What every not-installed message adds: the bundler case, and the hook past it. */
const BUNDLED_HINT =
  '  Installed, and your app is bundled (esbuild, webpack)? The bundler cannot follow\n' +
  '  this lazy load: import the SDK yourself and pass it as `sdk`\n' +
  '  (sdk: { Client, StreamableHTTPClientTransport }), or pass `connection`.';

/** The Node loader path, unchanged — reached only when no `sdk` was supplied. */
function loadClientModule(): McpSdkExports {
  try {
    return lazyRequire<McpSdkExports>('@modelcontextprotocol/sdk/client/index.js');
  } catch (err) {
    throw new Error(
      sdkLoadFailure(err, {
        notInstalled:
          'mcpClient requires @modelcontextprotocol/sdk.\n' +
          '  Install:  npm install @modelcontextprotocol/sdk\n' +
          BUNDLED_HINT,
        caller: 'mcpClient',
        specifier: '@modelcontextprotocol/sdk/client/index.js',
        instead:
          'Pass `sdk` (the two SDK modules, imported statically) or `connection` ' +
          '(a client you connected yourself).',
      }),
    );
  }
}

/** The SDK transport, the ledger its retry series files each call's attempts through, and how its session ends. */
interface BuiltTransport {
  readonly transport: unknown;
  readonly ledger?: RequestLedger;
  readonly ending: OpenConnection['ending'];
}

async function buildTransport(
  t: McpTransport,
  retryOnThrottle?: RetryOnThrottle,
  sdk?: McpSdk,
  replay?: ReplayDeclaration,
  name = 'mcp',
  seam?: PooledClientSeam,
): Promise<BuiltTransport> {
  if (t.transport === 'stdio') {
    // Deliberately NOT served by `sdk`: stdio spawns a subprocess, so it can
    // never run in a browser, and `client/stdio.js` is the SDK's one client
    // module that imports `node:process`/`node:stream`. Keeping it behind the
    // loader is what keeps it off every browser module graph.
    let stdioMod: McpStdioExports;
    try {
      stdioMod = lazyRequire<McpStdioExports>('@modelcontextprotocol/sdk/client/stdio.js');
    } catch (err) {
      throw new Error(
        sdkLoadFailure(err, {
          notInstalled:
            'mcpClient(stdio) requires @modelcontextprotocol/sdk/client/stdio.js — ' +
            'check that @modelcontextprotocol/sdk is installed at the latest version.',
          caller: 'mcpClient(stdio)',
          specifier: '@modelcontextprotocol/sdk/client/stdio.js',
          instead:
            'stdio spawns a subprocess, so it cannot run in a browser at all — ' +
            "reach the server over `transport: { transport: 'http', url }` instead.",
        }),
      );
    }
    // No fetch, so no retry series: a stdio call has no attempts to file.
    // stdio has no session id to end: its ending is the local close.
    const stdio = new stdioMod.StdioClientTransport({
      command: t.command,
      args: t.args ? [...t.args] : [],
      ...(t.env && { env: { ...t.env } }),
      ...(t.cwd !== undefined && { cwd: t.cwd }),
    });
    if (seam === undefined) return { transport: stdio, ending: endingWithout('no-session') };
    // A pooled client's sends are watched, so the pool's gate is asked at
    // `send()` — on stdio, which writes without waiting, the last boundary.
    const ledger = new RequestLedger({
      server: name,
      strict: replay?.policy === 'app-authorized',
      guardFor: seam.guardFor,
    });
    return watched(stdio, ledger, endingWithout('no-session'));
  }

  // http + gateway transports both ride Streamable HTTP. They differ only in
  // WHEN the auth headers are decided: `http` fixes them at construction,
  // `gateway` vends them inside every request (see gatewayTransport.ts).
  const httpMod: McpHttpExports = sdk ?? loadHttpModule(t.transport);
  // Throttle retry wraps the OUTERMOST fetch, so every attempt is re-signed
  // and re-vended: signatures expire, and a token that would have died during
  // the wait is simply never the one reused. `retryingFetch` returns its input
  // untouched when retry is off — including `undefined`, so a plain `http`
  // transport with no custom fetch still passes none and behaves exactly as it
  // did before 8.11.0. A transport fetch that already runs a retry series of
  // its own (AgentCore Runtime's) is never wrapped: `retryingFetch` joins the
  // 429 rule to that series, so one call is one series.
  //
  // The ledger joins the same series, so each request a dispatched tool call
  // sends files its attempts into that call's run; the transport's `send` is
  // watched to bind each request to its call (`requestLedger.ts`). The app's
  // replay declaration joins with it: the series asks it before sending a tool
  // call again (`replay.ts`). `retryOnThrottle: false` turns off the 429 rule
  // and nothing else: when the declaration still needs a series — a tool
  // declared repeatable on 'network', or the 'app-authorized' policy — the
  // series stays, with that rule switched off (`seriesWithoutThrottle`).
  // Otherwise a fetch that runs no series gets neither ledger nor declaration:
  // there is nothing to file and nothing is sent again.
  const retried = (inner: ThrottleFetch | undefined): ThrottleFetch | undefined =>
    retryOnThrottle === false && replay !== undefined && needsSeries(replay)
      ? seriesWithoutThrottle(inner)
      : retryingFetch(inner, retryOnThrottle);
  // Under 'app-authorized' the ledger refuses a request it cannot match to its
  // call, and awaits each matched request's answer (`requestLedger.ts`).
  const ledger = new RequestLedger({
    server: name,
    strict: replay?.policy === 'app-authorized',
    ...(seam !== undefined && { guardFor: seam.guardFor }),
  });
  // The pass-through fetch every transport the library builds carries: it
  // changes no request, and reads a `DELETE`'s answer for `terminate()`
  // (`terminate.ts`), because the SDK treats a 405 as success. A pooled client's
  // requests also cross the pool's gate here, before anything else of ours.
  const watch = new DeleteWatch();
  const outermost = (inner: ThrottleFetch | undefined): ThrottleFetch =>
    watch.fetch(
      seam === undefined
        ? inner
        : seam.wrapFetch(inner ?? platformFetch, (body) => guardOfCall(ledger, body)),
    );
  if (t.transport === 'gateway') {
    // The consumer's own `fetch` (9.32.0) goes UNDERNEATH the vending, not
    // beside it: `createVendingFetch` resolves the credential, applies it to
    // this one request, and then calls the base fetch — so an mTLS agent or a
    // DPoP signer sees the final headers and has the last word, while the
    // credential is still vended per request. Passing `undefined` is the
    // default global `fetch`, which is byte-identical to every release before
    // the seam existed.
    const gatewayFetch = retried(createVendingFetch(t, t.fetch));
    const ledgered = gatewayFetch && ledgeredFetch(gatewayFetch, ledger, replay);
    const sdkTransport = new httpMod.StreamableHTTPClientTransport(
      transportUrl(t.url, 'mcpClient'),
      { fetch: outermost(ledgered ?? gatewayFetch) },
    );
    return watched(
      sdkTransport,
      ledgered !== undefined || seam !== undefined ? ledger : undefined,
      sessionEnding(sdkTransport, watch),
    );
  }
  // Both options ride the SAME SDK transport, and both are forwarded when both
  // are given. The SDK folds `requestInit.headers` into the `init.headers` it
  // hands the custom fetch, so a signer sees the static headers and has the
  // final word over the bytes — see `McpHttpTransport.fetch`.
  const httpFetch = retried(t.fetch);
  const ledgered = httpFetch && ledgeredFetch(httpFetch, ledger, replay);
  const sdkTransport = new httpMod.StreamableHTTPClientTransport(transportUrl(t.url, 'mcpClient'), {
    ...(t.headers && { requestInit: { headers: { ...t.headers } } }),
    fetch: outermost(ledgered ?? httpFetch),
  });
  return watched(
    sdkTransport,
    ledgered !== undefined || seam !== undefined ? ledger : undefined,
    sessionEnding(sdkTransport, watch),
  );
}

/** The guard of the pooled tool call `body` belongs to, by its ledger claim. */
function guardOfCall(ledger: RequestLedger, body: unknown): RequestGuard | undefined {
  return ledger.claim(body)?.guard;
}

/** How an SDK Streamable HTTP transport's session ends: its own `terminateSession()`. */
function sessionEnding(transport: unknown, watch: DeleteWatch): OpenConnection['ending'] {
  const terminable = transport as TerminableTransport;
  if (typeof terminable?.terminateSession !== 'function') return endingWithout('unavailable');
  return (close) => endSession(terminable, watch, close);
}

/**
 * `transport` with its sends watched by `ledger` — the SAME object, its own
 * `send` installed in place. As it is, with no ledger, when there is none or it
 * cannot be watched: then no call expects its attempts filed.
 */
function watched(
  transport: unknown,
  ledger: RequestLedger | undefined,
  ending: OpenConnection['ending'],
): BuiltTransport {
  if (ledger === undefined || transport === null || typeof transport !== 'object') {
    return { transport, ending };
  }
  return ledger.watch(transport) === undefined
    ? { transport, ending }
    : { transport, ledger, ending };
}

/** The platform's fetch, looked up at call time so a later polyfill still wins. */
const platformFetch: ThrottleFetch = (input, init) => globalThis.fetch(input, init);

/** The Node loader path for Streamable HTTP — reached only with no `sdk`. */
function loadHttpModule(transport: 'http' | 'gateway'): McpHttpExports {
  try {
    return lazyRequire<McpHttpExports>('@modelcontextprotocol/sdk/client/streamableHttp.js');
  } catch (err) {
    throw new Error(
      sdkLoadFailure(err, {
        notInstalled:
          `mcpClient(${transport}) requires @modelcontextprotocol/sdk/client/streamableHttp.js — ` +
          'check that @modelcontextprotocol/sdk is installed at the latest version.\n' +
          BUNDLED_HINT,
        caller: `mcpClient(${transport})`,
        specifier: '@modelcontextprotocol/sdk/client/streamableHttp.js',
        instead:
          'Pass `sdk` (the two SDK modules, imported statically) or `connection` ' +
          '(a client you connected yourself).',
      }),
    );
  }
}

/**
 * Dev mode, once per client and name: a replay entry for a tool the server does
 * not list applies to nothing — a misspelled name would leave a tool that makes
 * changes outside the side-effect guard, so it is named.
 */
function noteUnlisted(
  replay: ReplayDeclaration,
  listed: readonly McpListedTool[],
  server: string,
  noted: Set<string>,
): void {
  if (replay.tools.size === 0 || !isDevMode()) return;
  const names = new Set(listed.map((tool) => tool.name));
  for (const tool of replay.tools.keys()) {
    if (names.has(tool) || noted.has(tool)) continue;
    noted.add(tool);
    // eslint-disable-next-line no-console
    console.warn(
      `[agentfootprint] mcpClient[${server}]: \`replay.tools\` names ${JSON.stringify(tool)}, ` +
        "which the server does not list, so the entry applies to nothing. Check the name against the server's tool list.",
    );
  }
}

// ─── Tool wrapping ─────────────────────────────────────────────────

/**
 * @internal What a listed MCP tool looks like as a `Tool`, less its `execute`:
 * its schema, its provenance and the declarations its `_meta` carries. The ONE
 * shape both an `mcpClient` tool and an MCP client pool's bound tool take.
 */
export function mcpToolShape(serverName: string, mcp: McpListedTool): Omit<Tool, 'execute'> {
  return {
    schema: {
      name: mcp.name,
      description: mcp.description ?? `MCP tool: ${mcp.name}`,
      inputSchema: mcp.inputSchema,
    },
    // Provenance, carried to the decision point. Governance that matches on a
    // bare tool name cannot tell two servers' identically-named tools apart;
    // this is the fact that lets it. See `Tool.source`.
    source: serverName,
    // The DECLARATIONS the server sent in MCP's `_meta` bag (9.71.0) — read
    // defensively, per field, by the same rules `defineTool` enforces, and
    // NEVER throwing: a malformed field is warned about once and dropped, and
    // this tool still registers. That is what keeps one bad tool from killing
    // a forty-tool bulk register. A server that sent no bag adds no keys here,
    // so the Tool is byte-identical to one built before this existed.
    ...readToolExtras(mcp._meta, {
      server: serverName,
      tool: mcp.name,
      inputSchema: mcp.inputSchema,
    }),
  };
}

function wrapMcpTool(
  serverName: string,
  connection: McpConnection,
  mcp: McpListedTool,
  signal?: AbortSignal,
  resultMode?: McpClientOptions['resultMode'],
  ledger?: RequestLedger,
  strict = false,
  checks?: CallChecks,
): Tool {
  const tool: Tool = {
    ...mcpToolShape(serverName, mcp),
    execute: async (args, ctx) => {
      // The agent passes args as `unknown` per Tool contract. MCP
      // expects a JSON object — non-object inputs become `{}` rather
      // than failing the SDK call.
      const argsObj =
        args !== null && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      // The abort signal is NOT a request param — it belongs to the SDK's
      // third argument (`RequestOptions`). Put it in the params object and
      // it gets serialized onto the wire as an empty `{}` and the call is
      // uncancellable: a silent no-op that only a real transport reveals.
      // `resultSchema` (2nd arg) is left to the SDK's own default.
      // The call's time (`ctx.time`, the time layer) crosses in the request's own
      // `_meta` bag, under the one namespaced key; a call without it sends no `_meta`.
      const params = {
        name: mcp.name,
        arguments: argsObj,
        ...(ctx?.time !== undefined && { _meta: callMetaOf(ctx.time) }),
      };
      // The call's lifetime (`callLifetime.ts`): its context's signal and the
      // client's cancel the SDK request while it runs; the call puts a private
      // marker in its params' `_meta` (`call.params`), which ties the request
      // the SDK sends to this call — through any copy the SDK makes — so the
      // retry series that sends it files its attempts into the call's run; and
      // however the call settles, a series still sending is cut, inside the
      // call. The transport takes the marker out: the server receives the
      // request it always did.
      //
      // How it settles is its verdict: `completed` when the server answered and
      // not with an error (a result it then cannot decode still completed).
      // Under 'app-authorized', a call that genuinely lacked an answer somewhere
      // and does not complete fails as "may have run"; a received refusal or
      // error is delivered as it came (`callLifetime.ts`). That contract needs
      // each request matched to its call and each answer seen: a connection
      // that cannot establish both refuses the call here, before anything is
      // sent (`replayUnavailable.ts`).
      const unavailable = strict ? unavailableBeforeSending(ledger) : undefined;
      if (unavailable !== undefined) {
        throw new McpReplayUnavailableError(unavailable, serverName, mcp.name);
      }
      // Whose checks this call runs under, decided before anything is sent
      // (`callChecks.ts`): the SDK's `Client` holds them while this tool's
      // one-page list is still its latest answer and no list request is out;
      // otherwise the tool's own checks run. An output they cannot check is
      // refused here, unsent.
      const own = checks !== undefined && !checks.heldBySdk();
      if (own && outputUnchecked(checks)) {
        throw new McpOutputUncheckedError(serverName, mcp.name, false);
      }
      const call = openCall(params, ctx, signal, ledger, serverName);
      let verdict: CallVerdict = 'failed';
      try {
        const send = (): Promise<McpCallToolResult> =>
          call.signal
            ? connection.callTool(call.params, undefined, { signal: call.signal })
            : connection.callTool(call.params);
        // The tool's own checks run where the SDK's `callTool` runs them, so a
        // call fails as it would with the SDK holding them: the task refusal
        // before sending, the output checks once the answer is in.
        if (own) refuseRequiredTask(checks);
        const result = await send();
        // A list request that went out while the call was out may have replaced
        // the SDK's checks before it read the answer, so the tool's own checks
        // read it too.
        if (checks !== undefined && (own || !checks.heldBySdk())) checkOutput(checks, result);
        verdict = isToolError(result) ? 'tool-error' : 'completed';
        return readToolResult(result, mcp.name, serverName, resultMode);
      } catch (error) {
        throw call.failed(error, verdict);
      } finally {
        call.close(verdict);
      }
    },
  };
  return tool;
}

// ─── Module shim types (for the lazy-required SDK) ─────────────────

/**
 * The two portable module shapes are now PUBLIC as `McpSdk` (types.ts) — a
 * caller who supplies them has to be able to name them. These aliases keep the
 * lazy-require sites reading the way they always did, and are what makes
 * `sdk ?? loadClientModule()` typecheck as one thing.
 */
type McpSdkExports = Pick<McpSdk, 'Client'>;
type McpHttpExports = Pick<McpSdk, 'StreamableHTTPClientTransport'>;

/**
 * Deliberately NOT part of `McpSdk`: stdio spawns a subprocess. It cannot run
 * in a browser, so there is nothing for a caller to portably supply, and
 * keeping it private is what keeps `client/stdio.js` — the SDK's only
 * Node-importing client module — out of the public contract.
 */
interface McpStdioExports {
  readonly StdioClientTransport: new (params: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
  }) => unknown;
}
