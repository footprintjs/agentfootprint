/**
 * listTools — one conversation's tools, bound to it: one listing operation.
 *
 * Pattern: one admitted operation per call, the provider's and the lease's alike.
 * Role:    § 3.2 and § 6 of the design. A listing is one `list(ctx)` for one
 *          conversation, admitted against `maxOperations`. Its setup — the open
 *          of the key's client, the `tools/list` — runs inside its slot.
 *
 *   - PER CLIENT: the conversation's own client is opened (or reused) and its own
 *     list served, listed again when it cannot be served as it stands.
 *   - SHARED, under the app's contract: the plan is resolved and the context
 *     computed WITHOUT opening anything; a current entry is served touching no
 *     client (`client: 'not-needed'`); a listing already under way for it is
 *     joined; otherwise the listing runs on THIS conversation's own client —
 *     never in another conversation's session.
 *
 * A refused listing never reaches the model as a tool result: it fails that
 * iteration's tool discovery (`agentfootprint.tools.discovery_failed`), as any
 * failing `ToolProvider` does. A list that cannot be read to its end
 * (`McpToolListIncompleteError`, from the client's own discovery) is never
 * served cut short.
 */

import { untilAborted } from '../../lib/abort.js';
import type { Tool } from '../../tools/tools.js';
import { isLocalSessionHandleLost, LocalSessionHandleLostError } from '../../tools/toolSessions.js';
import { ServerEndedSessionError } from './sessionEnded.js';
import { boundTool } from './boundTool.js';
import type { PoolKey } from './identityKey.js';
import { resolvePlan, type ClientPlan } from './plan.js';
import type { Pool, ServedList } from './pool.js';
import type { PooledClient } from './pooledClient.js';
import type { UseFacts } from './record.js';

/** List `key`'s conversation's tools, bound to it, under one admitted operation. */
export async function listTools(
  pool: Pool,
  key: PoolKey,
  signal: AbortSignal | undefined,
  facts: UseFacts,
): Promise<readonly Tool[]> {
  facts.keyHash = key.keyHash;
  pool.interact();
  const operation = pool.admit('listing', 'listing', signal);
  try {
    const current = pool.clients.currentFor(key.key);
    let plan: ClientPlan | undefined;
    if (current === undefined) {
      try {
        plan = resolvePlan(pool.settings, key);
      } catch (cause) {
        throw pool.refused('init-failed', cause);
      }
    }
    const planNow = current?.plan ?? (plan as ClientPlan);
    if (planNow.shared) {
      const served = await sharedWithoutClient(pool, key, planNow, operation.signal);
      if (served !== undefined) {
        facts.client = 'not-needed';
        facts.definitions = 'shared';
        facts.definitionsAgeMs = Math.max(0, pool.now() - served.list.listedAt);
        return bindAll(pool, key, served, undefined);
      }
    }
    const client = await pool.leaseClient(key, operation, facts, plan);
    let served: ServedList;
    try {
      served = await pool.ensureListed(client, pool.servedListOf(client), operation);
    } catch (error) {
      throw classifiedListing(pool, client, facts, error);
    }
    facts.definitions = served.shared ? 'shared' : 'listed';
    if (served.shared) facts.definitionsAgeMs = Math.max(0, pool.now() - served.list.listedAt);
    return bindAll(pool, key, served, client);
  } finally {
    operation.finish();
  }
}

/**
 * The shared entry for `plan`, when it can be served without touching a client
 * — at once, or once a listing already under way for it is done.
 */
async function sharedWithoutClient(
  pool: Pool,
  key: PoolKey,
  plan: ClientPlan,
  signal: AbortSignal,
): Promise<ServedList | undefined> {
  const entry = pool.shared.entryFor(plan.context, key.tenant);
  const servable = (): boolean => entry.list.servable(pool.now(), pool.settings.definitionTtlMs);
  if (!servable() && entry.list.listing !== undefined) {
    // Joined inside this operation's own slot; if it fails, this one lists itself.
    await untilAborted(entry.list.listing, signal).catch(() => undefined);
  }
  return servable() ? { list: entry.list, shared: true, context: plan.context } : undefined;
}

/** Every definition of `served`, bound to `key` and to the list it came from. */
function bindAll(
  pool: Pool,
  key: PoolKey,
  served: ServedList,
  client: PooledClient | undefined,
): readonly Tool[] {
  const base = {
    key,
    context: served.context,
    shared: served.shared,
    listId: served.list.id,
    generation: served.list.generation,
    ...(!served.shared && client !== undefined && { clientId: client.clientId }),
  };
  return served.list.all().map((definition) => boundTool(pool, { ...base, definition }));
}

/** A listing that failed because the client's session expired or its handle was lost. */
function classifiedListing(
  pool: Pool,
  client: PooledClient,
  facts: UseFacts,
  error: unknown,
): unknown {
  if (client.lost === 'expired') {
    facts.client = 'expired';
    facts.evidence = 'server-404';
    return new ServerEndedSessionError(pool.settings.name, client.clientId, error);
  }
  if (client.lost === 'handle-lost') {
    facts.client = 'handle-lost';
    facts.evidence = 'transport-forgot-handle';
    return isLocalSessionHandleLost(error)
      ? error
      : new LocalSessionHandleLostError({ cause: error });
  }
  return error;
}
