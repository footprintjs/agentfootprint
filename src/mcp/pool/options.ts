/**
 * options — what `mcpClientPool` is built from, read and checked once.
 *
 * Pattern: one options type + one reader that refuses by name.
 * Role:    The pool's budgets and clocks (`docs/design/2026-10-mcp-client-pool.md`
 *          § 3.1). Every number is checked when the pool is built, never at the
 *          first call. The pool takes the `mcpClient` options that shape one
 *          connection and hands them to every client it opens; it never takes
 *          `connection`, because it must build the transport itself — to end
 *          the session, to hear the tools-changed notice, and to place the send
 *          gate.
 */

import type { MemoryIdentity } from '../../memory/identity/types.js';
import { replayDeclarationOf, type McpReplayOptions } from '../replay.js';
import type { RetryOnThrottle } from '../throttleRetry.js';
import type { McpJsonSchemaValidator, McpSdk, McpTransport } from '../types.js';
import type { McpPoolReport } from './record.js';
import type { PoolClientOpener } from './plan.js';

/** The identity a pool keys a client by: `{ tenant?, principal?, conversationId }`. */
export type McpPoolIdentity = MemoryIdentity;

/** What a conversation's tool list may be shared under: two names the app vouches for. */
export interface McpPoolShareContext {
  /**
   * What the transport hides in its code — a signer's role, the credentials of
   * an AWS client, a custom `fetch`. Hashed into the context, never recorded.
   */
  readonly configuration: string;
  /**
   * What the server's tool visibility depends on — a role and a policy version
   * (`'analyst@policy-7'`). A version in the name reaches a new entry without
   * `permissionsChanged`, for conversations that already have a client too:
   * their tools are listed again under the new name, and a tool bound under the
   * old one is refused before it is sent. Hashed into the context, never
   * recorded.
   */
  readonly authorization: string;
}

/**
 * Share tool definitions between conversations — declared by the app, checked by
 * the pool. `share` is asked for every conversation before anything opens, and
 * again at every listing, every call and every send gate after that, so a
 * changed answer takes effect at the next one; it must be synchronous and
 * cheap. A listing's answer is kept only if the names still give the context it
 * was listed for when it arrives — otherwise it is dropped and listed again. Return both names, or `undefined` to keep that conversation's list to
 * itself. Conversations share a list only when the transport's comparable
 * data, both names and the tenant are all equal. A `share` that throws refuses
 * the open (`init-failed`) or, for a conversation that already has a client,
 * that listing or call (`binding-changed`) — its error as `cause`. Never share
 * a server whose list follows the session (one that unlocks tools as a
 * conversation goes on).
 */
export interface McpPoolDefinitionSharing {
  readonly share: (identity: McpPoolIdentity) => McpPoolShareContext | undefined;
}

/** Options for {@link mcpClientPool}. */
export interface McpClientPoolOptions {
  /** The server's name: every tool's `source`, the provider's id, and the record. */
  readonly name: string;
  /**
   * The transport each client is opened over. A FUNCTION of the identity is
   * preferred: it is called before each client opens (and again for every
   * replacement) with the identity the client is for, so each client gets a
   * transport — and a session map — of its own, and a provider can vend THAT
   * user's credential. One shared object serves every client; a shared
   * `'reuse'` runtime transport then needs `maxClients + maxEnding` at or below
   * its 256 remembered connections.
   */
  readonly transport: McpTransport | ((identity: McpPoolIdentity) => McpTransport);
  /** Open clients — opening, busy or idle. Default 64. */
  readonly maxClients?: number;
  /** Open clients for one principal (one tenant's principal). Default 8. */
  readonly maxClientsPerPrincipal?: number;
  /** Clients being ended at once, until each ending's work has settled. Default 8. */
  readonly maxEnding?: number;
  /**
   * Opens, listings, calls and endings outstanding on any client, each from
   * its admission until its work has settled — not merely until its caller was
   * answered. Default 256. Size it above `maxEnding`.
   */
  readonly maxOperations?: number;
  /** One open per conversation, under this ceiling. Default 30 000 ms. */
  readonly initTimeoutMs?: number;
  /**
   * End a client idle this long, at the next pool interaction (no timer is
   * installed). Default 600 000 ms — below AgentCore Runtime's 900 s idle
   * timeout; set it lower for a runtime configured lower.
   */
  readonly idleMs?: number;
  /** An app lease (`acquire`) is revoked past this. Default 900 000 ms (15 minutes). */
  readonly maxLeaseMs?: number;
  /** A tool list is listed again after this, at the next list. Default 600 000 ms. */
  readonly definitionTtlMs?: number;
  /** `'per-client'` (the default), or the app's declared sharing contract. */
  readonly definitions?: 'per-client' | McpPoolDefinitionSharing;
  /** Refuse an identity without a `principal`. Default `true`. */
  readonly requirePrincipal?: boolean;
  /** Refuse an identity without a `tenant` — for multitenant hosts. Default `false`. */
  readonly requireTenant?: boolean;
  /**
   * What happens outside a run — endings, deferred endings, revoked leases,
   * work that settled after its deadline. Ids and outcomes only. A throwing
   * handler is swallowed and changes nothing.
   */
  readonly onEvent?: (report: McpPoolReport) => void;
  /** Passed to every client: how a tool's result is decoded (`McpClientOptions.resultMode`). */
  readonly resultMode?: 'text' | 'structured' | 'structured-or-json';
  /** Passed to every client: the `initialize` identity. */
  readonly clientInfo?: { readonly name: string; readonly version: string };
  /** Passed to every client: the 429 retry (`McpClientOptions.retryOnThrottle`). */
  readonly retryOnThrottle?: RetryOnThrottle;
  /**
   * Passed to every client: who may send a tool call again
   * (`McpClientOptions.replay`). Read and checked when the pool is built. The
   * default stays `'compatibility'`. Whatever the policy, the pool's own send
   * gate refuses a pooled request it cannot check (`request-unmatched`).
   */
  readonly replay?: McpReplayOptions;
  /** Passed to every client: the two SDK modules, imported by you (`McpClientOptions.sdk`). */
  readonly sdk?: McpSdk;
  /**
   * Passed to every client: the JSON Schema validator a tool's own output checks
   * use (`McpClientOptions.jsonSchemaValidator`). With `sdk`, give it: a shared
   * definition always runs its own checks, and without a validator a tool that
   * declares an `outputSchema` is refused unsent.
   */
  readonly jsonSchemaValidator?: McpJsonSchemaValidator;
  /** Clock seam — tests drive idle, lease and definition ages without waiting. */
  readonly now?: () => number;
  /** @internal Test seam: how a client is opened (the real path is `openPooledClient`). */
  readonly _open?: PoolClientOpener;
}

/** The defaults, named so a test and a docstring cannot drift from the code. */
export const MCP_POOL_DEFAULTS = Object.freeze({
  maxClients: 64,
  maxClientsPerPrincipal: 8,
  maxEnding: 8,
  maxOperations: 256,
  initTimeoutMs: 30_000,
  idleMs: 600_000,
  maxLeaseMs: 900_000,
  definitionTtlMs: 600_000,
});

/** At most this many shared definition entries are kept; the least recently used goes first. */
export const MAX_DEFINITION_ENTRIES = 256;

/** A list longer than this is used by its own client and never shared. */
export const MAX_SHARED_TOOLS = 512;

/** The pool's settings, read once. */
export interface PoolSettings {
  readonly name: string;
  readonly transport: (identity: McpPoolIdentity) => McpTransport;
  readonly maxClients: number;
  readonly maxClientsPerPrincipal: number;
  readonly maxEnding: number;
  readonly maxOperations: number;
  readonly initTimeoutMs: number;
  readonly idleMs: number;
  readonly maxLeaseMs: number;
  readonly definitionTtlMs: number;
  readonly share: McpPoolDefinitionSharing['share'] | undefined;
  readonly requirePrincipal: boolean;
  readonly requireTenant: boolean;
  readonly onEvent: ((report: McpPoolReport) => void) | undefined;
  readonly client: {
    readonly resultMode?: McpClientPoolOptions['resultMode'];
    readonly clientInfo?: McpClientPoolOptions['clientInfo'];
    readonly retryOnThrottle?: RetryOnThrottle;
    readonly replay?: McpReplayOptions;
    readonly sdk?: McpSdk;
    readonly jsonSchemaValidator?: McpJsonSchemaValidator;
  };
  readonly now: () => number;
  readonly open: PoolClientOpener | undefined;
}

/**
 * Read `options` once.
 *
 * @throws TypeError naming the option, when one is missing, mistyped or out of
 *   range, or when `connection` is given — here, when the pool is built.
 */
export function readPoolOptions(options: McpClientPoolOptions): PoolSettings {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('mcpClientPool: options must be an object with `name` and `transport`.');
  }
  const { name } = options;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError(
      'mcpClientPool: `name` must be a non-empty string — the server name every tool and record carries.',
    );
  }
  const where = `mcpClientPool[${name}]`;
  if ((options as { readonly connection?: unknown }).connection !== undefined) {
    throw new TypeError(
      `${where}: \`connection\` is not taken. The pool builds every client's transport itself — ` +
        'to end its session, to hear the tools-changed notice and to place the send gate. Pass ' +
        '`transport`, or a function of the identity that returns one.',
    );
  }
  const transport = transportOf(options.transport, where);
  const count = (key: keyof typeof MCP_POOL_DEFAULTS): number =>
    positiveInteger(options[key], MCP_POOL_DEFAULTS[key], key, where);
  const definitions = options.definitions ?? 'per-client';
  if (definitions !== 'per-client' && typeof definitions?.share !== 'function') {
    throw new TypeError(
      `${where}: \`definitions\` must be 'per-client' or { share: (identity) => names | undefined }.`,
    );
  }
  if (options.onEvent !== undefined && typeof options.onEvent !== 'function') {
    throw new TypeError(`${where}: \`onEvent\` must be a function.`);
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError(`${where}: the clock option must be a function returning milliseconds.`);
  }
  // Refused by field now, as each client would refuse it at its first open.
  if (options.replay !== undefined) replayDeclarationOf(options.replay, where);
  return {
    name,
    transport,
    maxClients: count('maxClients'),
    maxClientsPerPrincipal: count('maxClientsPerPrincipal'),
    maxEnding: count('maxEnding'),
    maxOperations: count('maxOperations'),
    initTimeoutMs: count('initTimeoutMs'),
    idleMs: count('idleMs'),
    maxLeaseMs: count('maxLeaseMs'),
    definitionTtlMs: count('definitionTtlMs'),
    share: definitions === 'per-client' ? undefined : definitions.share,
    requirePrincipal: flag(options.requirePrincipal, true, 'requirePrincipal', where),
    requireTenant: flag(options.requireTenant, false, 'requireTenant', where),
    onEvent: options.onEvent,
    client: {
      ...(options.resultMode !== undefined && { resultMode: options.resultMode }),
      ...(options.clientInfo !== undefined && { clientInfo: options.clientInfo }),
      ...(options.retryOnThrottle !== undefined && { retryOnThrottle: options.retryOnThrottle }),
      ...(options.replay !== undefined && { replay: options.replay }),
      ...(options.sdk !== undefined && { sdk: options.sdk }),
      ...(options.jsonSchemaValidator !== undefined && {
        jsonSchemaValidator: options.jsonSchemaValidator,
      }),
    },
    now: options.now ?? Date.now,
    open: options._open,
  };
}

/** One transport for everyone, or a function of the identity — as a function either way. */
function transportOf(
  value: McpClientPoolOptions['transport'] | undefined,
  where: string,
): PoolSettings['transport'] {
  if (typeof value === 'function') return value;
  if (value !== null && typeof value === 'object' && typeof value.transport === 'string') {
    return () => value;
  }
  throw new TypeError(
    `${where}: \`transport\` must be an MCP transport ({ transport: 'http' | 'gateway' | 'stdio', … }) ` +
      'or a function of the identity that returns one.',
  );
}

/** A whole number ≥ 1, or the default when absent. */
function positiveInteger(value: unknown, fallback: number, key: string, where: string): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
  throw new TypeError(`${where}: \`${key}\` must be a whole number ≥ 1.`);
}

/** A boolean, or the default when absent. */
function flag(value: unknown, fallback: boolean, key: string, where: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  throw new TypeError(`${where}: \`${key}\` must be true or false.`);
}
