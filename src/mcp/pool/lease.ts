/**
 * lease — the app's explicit, bounded hold on one conversation's client.
 *
 * Pattern: a handle that releases at most once, by hand or by `await using`.
 * Role:    § 3.3 and § 5.2 of the design. `acquire` is for code that drives a
 *          sequence itself, or a host that must keep a conversation's client
 *          from eviction for a whole turn (it holds one around `agent.run()`, and
 *          the provider then finds the same client). It is the only way to
 *          protect a client between calls: there is no hidden grace period.
 *
 * The `acquire` that opened it was the operation; the held lease is not one. It
 * is bounded by `maxLeaseMs`: past it, it is revoked at the next pool
 * interaction and reported, and its next use throws `lease-expired`. Calls
 * already in flight keep their own leases until they settle.
 */

import { ASYNC_DISPOSE } from '../../strategies/lifecycle.js';
import type { Tool } from '../../tools/tools.js';
import { noteRefusal } from './boundTool.js';
import type { PoolKey } from './identityKey.js';
import { listTools } from './listTools.js';
import type { HeldLease, Pool } from './pool.js';
import { UseFacts } from './record.js';

/** The app's hold on one conversation's client. Release it — or `await using` it. */
export interface McpPoolLease extends AsyncDisposable {
  /**
   * This conversation's tools, bound to it. A call through one needs the
   * conversation's identity on its context (`ToolExecutionContext.identity`);
   * the agent puts it there for a run that named one.
   *
   * @throws `McpPoolRefusedError` (`lease-expired`) once the lease was revoked
   *   or released; what a listing throws otherwise
   */
  tools(options?: { readonly signal?: AbortSignal }): Promise<readonly Tool[]>;
  /** Release the hold. Idempotent. */
  release(): void;
}

/** The lease handle for `held`, on `key`'s client. */
export function leaseHandle(pool: Pool, key: PoolKey, held: HeldLease): McpPoolLease {
  const release = (): void => {
    if (held.released) return;
    held.released = true;
    pool.endLease(held);
    pool.interact();
  };
  const handle = {
    async tools(options?: { readonly signal?: AbortSignal }): Promise<readonly Tool[]> {
      pool.interact();
      if (held.revoked || held.released) throw pool.refused('lease-expired');
      const facts = new UseFacts(pool.settings.name, 'list');
      try {
        return await listTools(pool, key, options?.signal, facts);
      } catch (error) {
        noteRefusal(facts, error);
        throw error;
      }
    },
    release,
    [ASYNC_DISPOSE]: async (): Promise<void> => release(),
  };
  // The computed key gives TypeScript a symbol index rather than the one
  // well-known member `AsyncDisposable` names; at runtime it IS
  // `Symbol.asyncDispose` on every engine this package supports.
  return handle as unknown as McpPoolLease;
}
