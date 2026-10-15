/**
 * agentCoreRuntimeMcpTransport — an MCP server hosted on AWS Bedrock
 * **AgentCore Runtime**, reached as an ordinary MCP transport.
 *
 *   const orders = await mcpClient({
 *     name: 'orders',
 *     transport: agentCoreRuntimeMcpTransport({
 *       agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders_mcp-a1b2c3',
 *       region: 'us-west-2',
 *     }),
 *   });
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `agentCoreGatewayTransport` reaches a Gateway; `agentCoreRuntimeHost` hosts
 * OUR agent on Runtime. Neither calls an MCP server somebody deployed TO
 * Runtime, and that server is not reachable as a plain URL: every request goes
 * through `InvokeAgentRuntime`, it lands in a runtime SESSION that has to be
 * carried from call to call, and the platform answers a request that arrives
 * while that session is still coming up with an HTTP 200 whose body says
 * "Session operation in progress, please retry" — which no MCP client retries.
 *
 * ── What it is: one port, three strategies ───────────────────────────────────
 * The port is the existing one: this returns an `http` member of
 * `McpTransport`, so `mcpClient` builds it like any other Streamable HTTP
 * server and knows nothing about AgentCore. Everything AgentCore-specific sits
 * in the `fetch` it carries, composed from three choices, one file each:
 *
 *   session (`session.ts`)      'per-call' (the default: a session per request),
 *                               or 'reuse' (one session per MCP client, keyed by
 *                               a handle the transport issues)
 *   retry   (`sessionBusy.ts`)  the session-busy refusal, retried with bounded
 *                               backoff by the SAME loop `mcpClient` uses for a
 *                               429 (`mcp/throttleRetry.ts` · `retryingFetchWhen`)
 *   auth    (`invoke.ts`)       'sigv4' through the AWS SDK's InvokeAgentRuntime,
 *                               or a bearer token over the documented HTTPS
 *                               endpoint — the SDK has no bearer scheme, and the
 *                               API reference says an OAuth caller must use HTTPS
 *
 * in that order, outermost first: the session is applied once per request, so
 * every attempt of it lands in the same runtime session, and every attempt is
 * signed (or vended) afresh, the ordering `mcp/throttleRetry.ts` requires.
 * What the MCP client reads of a failure is rewritten from the library's own
 * fixed sentences and safe ids (`safeAnswer.ts`), never the service's text.
 * `mcpClient`'s own 429 retry still wraps the whole thing.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────────
 * Deploy or manage a runtime (a control-plane job), or host one (that is
 * `agentCoreRuntimeHost`). This is the CLIENT side of a server somebody already
 * deployed with `--protocol MCP`.
 *
 * Pattern: Facade over three Strategies. Role: outer ring, vendor adapter.
 */

import {
  createVendingFetch,
  gatewayTransport,
  type FetchLike,
} from '../../../mcp/gatewayTransport.js';
import {
  retryingFetchWhen,
  type RetryOnThrottle,
  type ThrottleFetch,
  type ThrottleRetryOptions,
} from '../../../mcp/throttleRetry.js';
import type { McpHttpTransport } from '../../../mcp/types.js';
import type { CredentialProvider } from '../../../identity/types.js';
import {
  invokeFetch,
  invokeSdk,
  type AgentCoreRuntimeSdkClient,
  type BedrockAgentCoreRuntimeSdkModule,
} from './invoke.js';
import { safeAnswer } from './safeAnswer.js';
import { sessionStrategy, type AgentCoreRuntimeSession } from './session.js';
import { sessionBusy } from './sessionBusy.js';

/**
 * A bearer token, for a runtime whose inbound auth is OAuth (a JWT authorizer).
 *
 * Vended PER REQUEST by the provider — the same once-and-dropped rule as
 * `gatewayTransport`, through the same code.
 */
export interface AgentCoreRuntimeBearerAuth {
  /** Who vends the token. `agentCoreIdentity()` or any `CredentialProvider`. */
  readonly bearer: CredentialProvider;
  /** The downstream service id your provider keys on. Default `'runtime'`. */
  readonly service?: string;
  /** OAuth scopes, when the provider uses them. */
  readonly scopes?: readonly string[];
  /**
   * `'machine'` (2-legged), the only mode. `'user'` is refused: the transport
   * asks for its token without naming any user, so a user-delegated token
   * would be sent for whoever calls through the client. For a token per user,
   * build a transport per user whose provider vends that user's token.
   */
  readonly mode?: 'machine';
  /**
   * Your own `fetch`, called UNDERNEATH the per-request vending — an HTTP
   * agent, a proxy. It sees the final headers, the vended one included.
   */
  readonly fetch?: FetchLike;
}

/**
 * How requests are authenticated — the runtime's inbound auth decides which.
 *
 *   - `'sigv4'` — IAM. The AWS SDK signs `InvokeAgentRuntime` with your AWS
 *     credentials (the default chain, or the `client` you pass).
 *   - `{ bearer }` — OAuth. A plain HTTPS request with `Authorization: Bearer`,
 *     because the SDK cannot send a bearer token.
 */
export type AgentCoreRuntimeAuth = 'sigv4' | AgentCoreRuntimeBearerAuth;

/**
 * The session-busy retry: the same ceilings and the same `onRetry` report as
 * `mcpClient`'s `retryOnThrottle`, applied to AgentCore's own refusal.
 */
export type AgentCoreRuntimeRetryOptions = ThrottleRetryOptions;

/** Options for {@link agentCoreRuntimeMcpTransport}. */
export interface AgentCoreRuntimeMcpTransportOptions {
  /**
   * The runtime hosting the MCP server — its ARN, as `agentcore deploy` prints
   * it, or its id together with {@link accountId}.
   */
  readonly agentRuntimeArn: string;
  /** The region it runs in, e.g. `'us-west-2'`. */
  readonly region: string;
  /** The endpoint (version) to invoke. The runtime's default endpoint when omitted. */
  readonly qualifier?: string;
  /** The owning account — required by AgentCore when `agentRuntimeArn` is an id, not an ARN. */
  readonly accountId?: string;
  /** How requests are authenticated. Default `'sigv4'`. */
  readonly auth?: AgentCoreRuntimeAuth;
  /**
   * Which runtime session each request lands in. Default `'per-call'`.
   *
   *   - `'per-call'` — every request in a session of its own; nothing carries
   *     over, so one client can serve every user of a process. Needs a
   *     stateless server (the runtime's recommended default).
   *   - `'reuse'` — one session per CLIENT: each `mcpClient` built on this
   *     transport keeps its own runtime session for its life. **Build one
   *     client per conversation**: a client shared by two users is one
   *     session — one microVM, one server state — for both.
   */
  readonly session?: AgentCoreRuntimeSession;
  /**
   * Retry AgentCore's "session operation in progress" refusal — the MCP
   * contract's HTTP 200 with JSON-RPC -32005, or the API's 409
   * `RetryableConflictException`. On by default: up to 5 attempts, never more
   * than 10 s of waiting in total, jittered exponential backoff. `false` lets
   * the refusal through on the first attempt.
   *
   * Nothing else is retried here: a 429 goes to `mcpClient`'s own throttle
   * retry, and a 5xx, a dropped connection or any other JSON-RPC error
   * (throttling's -32003 included) is delivered as it is — it may be the
   * record of work that ran.
   */
  readonly retry?: boolean | AgentCoreRuntimeRetryOptions;
  /**
   * SigV4 only: a `BedrockAgentCoreClient` you built, so its credentials,
   * region and retry settings are the ones used. Refused with `{ bearer }`.
   *
   * **Build it with `maxAttempts: 1`.** The client this transport builds has
   * the SDK's own retry off, because the SDK's standard policy re-sends a call
   * after a 5xx or a dropped connection — work that may already have run. Your
   * client keeps whatever policy you gave it.
   */
  readonly client?: AgentCoreRuntimeSdkClient;
  /** @internal Test injection — the AWS SDK module. */
  readonly _sdk?: BedrockAgentCoreRuntimeSdkModule;
}

/** The session-busy retry's own ceilings, when the caller set none. */
const DEFAULT_RETRY: AgentCoreRuntimeRetryOptions = { maxAttempts: 5, maxWaitMs: 10_000 };

/** What a bearer token is vended for, unless the caller names another service. */
const DEFAULT_BEARER_SERVICE = 'runtime';

/** A region is a DNS label run, nothing more — it is spliced into a hostname. */
const REGION_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * An MCP transport for a server hosted on AgentCore Runtime.
 *
 * @throws when the runtime or region is missing, when a strategy is unknown,
 *   when `client` is given beside `{ bearer }`, or — for `'sigv4'` — when the
 *   AWS SDK peer dependency cannot be loaded.
 */
export function agentCoreRuntimeMcpTransport(
  options: AgentCoreRuntimeMcpTransportOptions,
): McpHttpTransport {
  const url = agentCoreRuntimeUrl(options);
  const send = authStrategy(options, url);
  const retried = retryingFetchWhen(send, retryConfig(options.retry), sessionBusy) ?? send;
  const session = sessionStrategy(options.session ?? 'per-call');

  // The session is applied ONCE per request the MCP client makes, outside the
  // retry: every attempt of one request goes to the same runtime session (a
  // busy refusal is about THAT session coming up), and only the final answer
  // binds anything.
  const sessioned: ThrottleFetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const step = session.request(headers, (init?.method ?? 'GET').toUpperCase());
    if ('answer' in step) return step.answer;
    const response = await retried(input, { ...init, headers });
    // What the MCP client may read of a failure is rewritten from safe parts —
    // ONE rule for both auth paths, after the retry has read the original.
    return step.settle(await safeAnswer(response));
  };

  return { transport: 'http', url, fetch: sessioned };
}

/** Where a runtime's MCP endpoint is, as {@link agentCoreRuntimeUrl} needs it. */
export interface AgentCoreRuntimeUrlOptions {
  readonly agentRuntimeArn: string;
  readonly region: string;
  readonly qualifier?: string;
  readonly accountId?: string;
}

/**
 * The HTTPS endpoint of a runtime's MCP server:
 * `https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{url-encoded ARN}/invocations`,
 * with `qualifier` / `accountId` as query parameters when given — the request
 * line of `InvokeAgentRuntime`, and the URL AgentCore's own MCP examples dial.
 *
 * @throws when `agentRuntimeArn` or `region` is missing, or the region is not
 *   shaped like one (it becomes part of a hostname).
 */
export function agentCoreRuntimeUrl(options: AgentCoreRuntimeUrlOptions): string {
  const { agentRuntimeArn, region, qualifier, accountId } = options;
  if (!agentRuntimeArn || !region) {
    throw new TypeError(
      'agentCoreRuntimeUrl: both `agentRuntimeArn` and `region` are required — the runtime ' +
        'is named by the first and reached through the second.',
    );
  }
  if (!REGION_SHAPE.test(region)) {
    throw new TypeError(
      `agentCoreRuntimeUrl: \`region\` ${JSON.stringify(region)} is not a region name ` +
        "(lowercase letters, digits and '-', e.g. 'us-west-2'). It becomes part of the " +
        'hostname, so it is refused rather than spliced in.',
    );
  }
  const query = new URLSearchParams();
  if (qualifier) query.set('qualifier', qualifier);
  if (accountId) query.set('accountId', accountId);
  const base =
    `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/` +
    `${encodeURIComponent(agentRuntimeArn)}/invocations`;
  const search = query.toString();
  return search === '' ? base : `${base}?${search}`;
}

// ── The auth strategy ─────────────────────────────────────────────────

/** The innermost `fetch`: the one that authenticates and sends. */
function authStrategy(options: AgentCoreRuntimeMcpTransportOptions, url: string): ThrottleFetch {
  const auth = options.auth ?? 'sigv4';
  if (auth === 'sigv4') {
    const { client, InvokeAgentRuntimeCommand } = invokeSdk({
      region: options.region,
      ...(options.client !== undefined && { client: options.client }),
      ...(options._sdk !== undefined && { sdk: options._sdk }),
    });
    return invokeFetch(
      {
        agentRuntimeArn: options.agentRuntimeArn,
        ...(options.qualifier !== undefined && { qualifier: options.qualifier }),
        ...(options.accountId !== undefined && { accountId: options.accountId }),
      },
      client,
      InvokeAgentRuntimeCommand,
    );
  }
  if (auth !== null && typeof auth === 'object' && auth.bearer !== undefined) {
    if (typeof (auth.bearer as { getCredential?: unknown }).getCredential !== 'function') {
      throw new TypeError(
        'agentCoreRuntimeMcpTransport: `auth.bearer` must be a CredentialProvider (an object ' +
          'with getCredential — agentCoreIdentity(), staticTokens(), your own), not the token ' +
          'itself: a token is vended per request so it can rotate, and is never held here.',
      );
    }
    if (options.client !== undefined) {
      throw new TypeError(
        'agentCoreRuntimeMcpTransport: `client` is the SigV4 strategy’s AWS SDK client, and ' +
          '`auth: { bearer }` sends no AWS SDK request — the SDK cannot carry a bearer token, ' +
          'so this path is plain HTTPS. Remove `client`, or use `auth: "sigv4"`.',
      );
    }
    if (auth.mode !== undefined && auth.mode !== 'machine') {
      // The vending request names no user: it carries `service`, `scopes` and
      // `mode`, never an identity or the user's own token. A user-delegated
      // token asked for that way belongs to nobody in particular — and would be
      // sent for whoever calls through the client.
      throw new TypeError(
        `agentCoreRuntimeMcpTransport: \`auth.mode\` must be 'machine' — got ${describe(
          auth.mode,
        )}. ` +
          'This transport asks its provider for a token without naming any user, so a ' +
          'user-delegated token would be sent for whoever calls through the client. Leave ' +
          '`mode` unset for the client credential; for a token per user, build a transport per ' +
          'user whose `bearer` provider vends that user’s token.',
      );
    }
    // The Gateway's vending fetch, reused as is: the token is vended per
    // request, applied to that one request, and dropped.
    return createVendingFetch(
      gatewayTransport({
        url,
        credentials: auth.bearer,
        service: auth.service ?? DEFAULT_BEARER_SERVICE,
        ...(auth.scopes !== undefined && { scopes: auth.scopes }),
        ...(auth.mode !== undefined && { mode: auth.mode }),
      }),
      auth.fetch,
    );
  }
  throw new TypeError(
    `agentCoreRuntimeMcpTransport: \`auth\` must be 'sigv4' or { bearer: <CredentialProvider> } ` +
      `— got ${describe(auth)}. Which one is decided by the runtime's inbound auth: IAM is ` +
      "'sigv4', an OAuth (JWT) authorizer is a bearer token.",
  );
}

// ── The retry strategy's configuration ────────────────────────────────

function retryConfig(retry: AgentCoreRuntimeMcpTransportOptions['retry']): RetryOnThrottle {
  if (retry === false) return false;
  const given = typeof retry === 'object' && retry !== null ? retry : {};
  // An explicitly `undefined` field means "not set" — it must fall back to this
  // transport's default, not erase it (and land on the loop's own default).
  const set = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined));
  return { ...DEFAULT_RETRY, ...set };
}

/**
 * A refused value, described by SHAPE — never echoed. A mistyped `auth` can be
 * the token itself (`auth: process.env.RUNTIME_TOKEN`), and an error message is
 * the last place it should land.
 */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `a string of ${value.length} characters`;
  if (typeof value === 'object') return `an object with keys [${Object.keys(value).join(', ')}]`;
  return typeof value;
}
