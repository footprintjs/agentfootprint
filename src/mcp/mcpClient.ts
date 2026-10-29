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
  McpClient,
  McpClientOptions,
  McpConnection,
  McpConnectionOptions,
  McpListedTool,
  McpSdk,
  McpSdkClient,
  McpTransport,
} from './types.js';
import { callMetaOf, readToolExtras } from './toolExtras.js';
import { isToolError, readToolResult, resultModeOf } from './toolResult.js';
import { listEveryPage, McpToolListIncompleteError } from './toolList.js';
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
  const name = opts.name ?? 'mcp';
  const resultMode = resultModeOf(opts.resultMode, name);
  // Before anything connects: an option that names a behaviour which cannot
  // happen on the chosen arm is a defect, not a preference.
  refuseConflictingOptions(opts, name);
  // The app's replay declaration — who may send a tool call again — read and
  // checked once, here, before anything connects (`replay.ts`).
  const replay = replayDeclarationOf(opts.replay, `mcpClient[${name}]`);
  const strict = replay.policy === 'app-authorized';
  const { connection, ledger } = await openConnection(opts, replay, name);
  const unlisted = new Set<string>();

  // Tool cache so consumers calling `.tools()` more than once don't
  // hammer the server. `.refresh()` invalidates it.
  let cache: readonly Tool[] | null = null;
  let closed = false;

  const ensureOpen = (op: string): void => {
    if (closed) {
      throw new Error(
        `mcpClient[${name}].${op}() called after close(). Construct a new client to reconnect.`,
      );
    }
  };

  const buildTools = async (): Promise<readonly Tool[]> => {
    // Every page of the server's list (`toolList.ts`). `signal` rides each
    // page in the SDK's trailing options argument, never in the params — see
    // `wrapMcpTool`.
    const listing = await listEveryPage(connection, opts.signal);
    // A list that did not end cannot say which entries name nothing.
    if (listing.incomplete === undefined) noteUnlisted(replay, listing.tools, name, unlisted);
    const tools = listing.tools.map((t) =>
      wrapMcpTool(name, connection, t, opts.signal, resultMode, ledger, strict),
    );
    // Never a list cut short: what was listed travels on the refusal instead.
    if (listing.incomplete !== undefined) {
      throw new McpToolListIncompleteError(listing.incomplete, name, listing.pages, tools);
    }
    return tools;
  };

  return {
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
      try {
        await connection.close();
      } finally {
        // Nothing this connection sent is awaited any more, however it closed.
        ledger?.close();
      }
    },
  };
}

// ─── Getting a connection ──────────────────────────────────────────

/** A connection, and — when the library built its transport — the ledger its requests are claimed by. */
interface OpenConnection {
  readonly connection: McpConnection;
  readonly ledger?: RequestLedger;
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
): Promise<OpenConnection> {
  if (opts.connection !== undefined) return { connection: opts.connection };
  if (opts._client !== undefined) return { connection: opts._client };
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
): Promise<OpenConnection> {
  if (sdk !== undefined) assertSdk(sdk, transport.transport);
  const mod: McpSdkExports = sdk ?? loadClientModule();

  const client: McpSdkClient = new mod.Client(clientInfo ?? DEFAULT_CLIENT_INFO, {
    capabilities: {},
  });

  const built = await buildTransport(transport, retryOnThrottle, sdk, replay, name);
  // Same rule as callTool: options ride beside the transport, never inside it.
  if (signal) await client.connect(built.transport, { signal });
  else await client.connect(built.transport);
  return { connection: client, ...(built.ledger !== undefined && { ledger: built.ledger }) };
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

/** The SDK transport, and the ledger its retry series files each call's attempts through. */
interface BuiltTransport {
  readonly transport: unknown;
  readonly ledger?: RequestLedger;
}

async function buildTransport(
  t: McpTransport,
  retryOnThrottle?: RetryOnThrottle,
  sdk?: McpSdk,
  replay?: ReplayDeclaration,
  name = 'mcp',
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
    return {
      transport: new stdioMod.StdioClientTransport({
        command: t.command,
        args: t.args ? [...t.args] : [],
        ...(t.env && { env: { ...t.env } }),
        ...(t.cwd !== undefined && { cwd: t.cwd }),
      }),
    };
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
  });
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
    return watched(
      new httpMod.StreamableHTTPClientTransport(transportUrl(t.url, 'mcpClient'), {
        fetch: ledgered ?? gatewayFetch,
      }),
      ledgered && ledger,
    );
  }
  // Both options ride the SAME SDK transport, and both are forwarded when both
  // are given. The SDK folds `requestInit.headers` into the `init.headers` it
  // hands the custom fetch, so a signer sees the static headers and has the
  // final word over the bytes — see `McpHttpTransport.fetch`.
  const httpFetch = retried(t.fetch);
  const ledgered = httpFetch && ledgeredFetch(httpFetch, ledger, replay);
  const fetch = ledgered ?? httpFetch;
  return watched(
    new httpMod.StreamableHTTPClientTransport(transportUrl(t.url, 'mcpClient'), {
      ...(t.headers && { requestInit: { headers: { ...t.headers } } }),
      ...(fetch && { fetch }),
    }),
    ledgered && ledger,
  );
}

/**
 * `transport` with its sends watched by `ledger` — the SAME object, its own
 * `send` installed in place. As it is, with no ledger, when there is none or it
 * cannot be watched: then no call expects its attempts filed.
 */
function watched(transport: unknown, ledger: RequestLedger | undefined): BuiltTransport {
  if (ledger === undefined || transport === null || typeof transport !== 'object') {
    return { transport };
  }
  return ledger.watch(transport) === undefined ? { transport } : { transport, ledger };
}

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

function wrapMcpTool(
  serverName: string,
  connection: McpConnection,
  mcp: McpListedTool,
  signal?: AbortSignal,
  resultMode?: McpClientOptions['resultMode'],
  ledger?: RequestLedger,
  strict = false,
): Tool {
  const tool: Tool = {
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
      const call = openCall(params, ctx, signal, ledger, serverName);
      let verdict: CallVerdict = 'failed';
      try {
        const result = call.signal
          ? await connection.callTool(call.params, undefined, { signal: call.signal })
          : await connection.callTool(call.params);
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
