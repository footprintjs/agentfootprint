/**
 * mcpClientPool — a client per conversation, for one MCP server.
 *
 *   const orders = mcpClientPool({
 *     name: 'orders',
 *     transport: () =>
 *       agentCoreRuntimeMcpTransport({ agentRuntimeArn, region, session: 'reuse', client: aws }),
 *   });
 *   const agent = Agent.create({ provider, model }).toolProvider(orders.toolProvider()).build();
 *   await agent.run({ message, identity: { tenant, principal, conversationId } });
 *
 * Pattern: Facade over one state machine (`pool.ts`), its accounting (`work.ts`),
 *          its definitions (`definitions.ts`) and its bound tools (`boundTool.ts`).
 * Role:    `docs/design/2026-10-mcp-client-pool.md`. A `'reuse'` session costs a
 *          cold start once per conversation instead of once per call — but only
 *          if each conversation has a client of its own, opened once, bounded,
 *          never closed while in use, ended remotely and said to be. This is
 *          the one place that does all of it:
 *
 *   - one client per authenticated conversation, keyed by the library's
 *     identity encoding of the identity the CALLER named;
 *   - one open per key, under the pool's own signal and `initTimeoutMs`;
 *   - three budgets — open clients, endings, outstanding operations — each
 *     charged until the work under it has SETTLED, and `PoolFullError` at once
 *     when one is full: there is no queue;
 *   - tool definitions per client incarnation by default, shared only under the
 *     app's declared contract, every tool re-checked after each wait and at the
 *     send gate;
 *   - every ending through `terminate()`, with the remote outcome reported, and
 *     `close()` still only local.
 *
 * What it does not do: repeat a call, share anything across processes, bound a
 * remote session it could not end, or make a server enforce per-user
 * permissions.
 */

import type { ToolProvider } from '../../tools/toolProvider.js';
import { fileListUse } from '../../tools/mcpClientUse.js';
import { TOOL_TEARDOWN_TIMEOUT_MS } from '../../tools/toolSessions.js';
import type { McpTerminateOutcome } from '../types.js';
import { noteRefusal } from './boundTool.js';
import { poolKeyOf, scopeMatcher } from './identityKey.js';
import { leaseHandle, type McpPoolLease } from './lease.js';
import { listTools } from './listTools.js';
import { readPoolOptions, type McpClientPoolOptions, type McpPoolIdentity } from './options.js';
import { Pool, type McpPoolStats } from './pool.js';
import { UseFacts } from './record.js';

/** The scope `terminate` and `permissionsChanged` name. */
export interface McpPoolScope {
  /** Matched exactly, always: an absent tenant is "no tenant", never "every tenant". */
  readonly tenant?: string;
  /** Absent: every principal of the tenant (`permissionsChanged` only). */
  readonly principal?: string;
  /** Absent: every conversation of the principal. */
  readonly conversationId?: string;
}

/** One pool per MCP server: a client per conversation. */
export interface McpClientPool {
  /** The pool's name: the server. */
  readonly name: string;
  /**
   * The agent path: a `ToolProvider` (id `mcp-pool:<name>`) whose `list(ctx)`
   * takes the run's caller identity (`ToolDispatchContext.callerIdentity`) and
   * returns that conversation's tools, bound to it. A bound tool's `execute`
   * takes a lease on the key's client for one call, opening the client first
   * when the key has none; nothing is held between calls. A run with no caller
   * identity is refused (`no-identity`) — a derived one counts as none.
   */
  toolProvider(): ToolProvider;
  /**
   * Hold `identity`'s conversation client — opened or reused — until
   * `release()`, at most `maxLeaseMs`. The only way to protect a client between
   * calls (a host holds one around `agent.run()`).
   *
   * @throws `McpPoolRefusedError` (`no-identity`, `incomplete-identity`,
   *   `init-timeout`, `init-failed`, `closed`) or `PoolFullError`
   */
  acquire(
    identity: McpPoolIdentity,
    options?: { readonly signal?: AbortSignal },
  ): Promise<McpPoolLease>;
  /**
   * End the conversations `scope` names — one (`{ tenant, principal,
   * conversationId }`) or every one of a principal (`{ tenant, principal }`).
   * New leases stop at once; the next acquire for a key opens a new client.
   * In-flight work is waited for up to 5 s; then each client is ended through
   * `terminate()` once an ending slot and an operation slot are reserved. A
   * client still leased, or whose slots cannot be reserved yet, is reported
   * deferred (`onEvent`), never as ended, and is ended when it can be.
   *
   * @returns one `McpTerminateOutcome` per client it ended
   */
  terminate(scope: McpPoolScope): Promise<readonly McpTerminateOutcome[]>;
  /**
   * Shut down: refuse new work, revoke app leases, abort in-flight calls
   * through the pool's own signal, then end every client as slots can be
   * reserved, at most `maxEnding` at a time. Resolves after a bounded wait;
   * the clients it could not end yet are reported deferred and the work still
   * unsettled stays charged until it settles (`stats()`). Idempotent.
   *
   * @returns one `McpTerminateOutcome` per client it ended
   */
  close(): Promise<readonly McpTerminateOutcome[]>;
  /** Resolves once every charged operation and every ending has settled. */
  settled(): Promise<void>;
  /**
   * The app's permission signal: every tool list in the scope stops being
   * served, and every tool bound to one is refused (`stale-tools`) before it is
   * sent. Per process: a fleet sends it to every process, or versions its
   * `authorization` names.
   */
  permissionsChanged(scope: { readonly tenant?: string; readonly principal?: string }): void;
  /** The server changed (a deploy hook): every tool list stops being served. */
  toolsChanged(): void;
  /** Run the lazy sweep now: revoked leases, idle ends, deferred ends. No timer is ever installed. */
  sweep(): void;
  /** Counts only — never keys. They report; the budgets enforce. */
  stats(): McpPoolStats;
}

/**
 * Build a pool for one MCP server.
 *
 * @throws TypeError when an option is missing, mistyped or out of range, or when
 *   `connection` is given — here, when the pool is built
 */
export function mcpClientPool(options: McpClientPoolOptions): McpClientPool {
  const settings = readPoolOptions(options);
  const pool = new Pool(settings);
  const rules = {
    requirePrincipal: settings.requirePrincipal,
    requireTenant: settings.requireTenant,
  };
  let closing: Promise<readonly McpTerminateOutcome[]> | undefined;

  const provider: ToolProvider = {
    id: `mcp-pool:${settings.name}`,
    list: async (ctx) => {
      const facts = new UseFacts(settings.name, 'list');
      try {
        const key = poolKeyOf(ctx.callerIdentity, rules);
        if (typeof key === 'string') throw pool.refused(key);
        return await listTools(pool, key, ctx.signal, facts);
      } catch (error) {
        noteRefusal(facts, error);
        throw error;
      } finally {
        // Filed against the context the tools slot passed; the slot emits it.
        fileListUse(ctx, facts.toUse());
      }
    },
  };

  return {
    name: settings.name,
    toolProvider: () => provider,
    async acquire(identity, acquireOptions) {
      const key = poolKeyOf(identity, rules);
      if (typeof key === 'string') throw pool.refused(key);
      pool.interact();
      const operation = pool.admit('acquire', 'open', acquireOptions?.signal);
      try {
        const facts = new UseFacts(settings.name, 'list');
        const client = await pool.leaseClient(key, operation, facts);
        return leaseHandle(pool, key, pool.holdLease(client));
      } finally {
        operation.finish();
      }
    },
    async terminate(scope) {
      assertScope(scope, settings.name);
      pool.interact();
      return pool.terminate(scopeMatcher(scope), 'terminated', TOOL_TEARDOWN_TIMEOUT_MS);
    },
    close() {
      closing ??= pool.closeAll(TOOL_TEARDOWN_TIMEOUT_MS);
      return closing;
    },
    settled: () => pool.settled(),
    permissionsChanged(scope) {
      assertFields(scope, settings.name, 'permissionsChanged');
      pool.permissionsChanged(scope);
    },
    toolsChanged: () => pool.toolsChanged(),
    sweep: () => pool.interact(),
    stats: () => pool.stats(),
  };
}

/**
 * A `terminate` scope names a principal or a conversation: ending every
 * conversation of a whole tenant is `close()`'s job, and a mistyped scope must
 * not do it.
 */
function assertScope(scope: McpPoolScope, name: string): void {
  assertFields(scope, name, 'terminate');
  const named = (value: string | undefined): boolean => value !== undefined && value !== '';
  if (!named(scope.principal) && !named(scope.conversationId)) {
    throw new TypeError(
      `mcpClientPool[${name}].terminate: the scope must name a principal or a conversation ` +
        '({ tenant, principal } or { tenant, principal, conversationId }).',
    );
  }
}

/** Every field present is a string. Never quoted: a scope is an identity. */
function assertFields(scope: unknown, name: string, door: string): void {
  if (scope === null || typeof scope !== 'object') {
    throw new TypeError(`mcpClientPool[${name}].${door}: the scope must be an object.`);
  }
  for (const field of ['tenant', 'principal', 'conversationId'] as const) {
    const value = (scope as Record<string, unknown>)[field];
    if (value !== undefined && typeof value !== 'string') {
      throw new TypeError(
        `mcpClientPool[${name}].${door}: \`${field}\` must be a string when present.`,
      );
    }
  }
}
