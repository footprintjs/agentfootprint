/**
 * clientSet — which clients the pool holds, and in which of its two sets.
 *
 * Pattern: two sets and their indexes, mutated only together.
 * Role:    § 5.3 of the design. The OPEN set holds every client that counts
 *          toward `maxClients` — opening, busy, idle, deferred, or an abandoned
 *          open that has not settled. The ENDING set holds every client from the
 *          decision to end it until that ending's work has settled, and counts
 *          toward `maxEnding`. A client leaves the open set only into the ending
 *          set (the one exception, a lost handle, leaves at once: there is
 *          nothing to send). So the pool holds at most `maxClients + maxEnding`
 *          client objects.
 *
 * Each key has at most one CURRENT client — the one new leases go to. A client
 * named by `terminate`, or whose session expired, stops being current at once
 * while it stays in the open set, counted, until it can end.
 *
 * What the pool remembers of a key after its client left — the incarnation
 * count and why the last one left — is bounded (`KEY_MEMORY`), least recently
 * used forgotten first: after that a key's count starts again at 1. The record
 * reads it; no binding depends on it.
 */

import type { EndReason, PooledClient } from './pooledClient.js';

/** How many keys' incarnation counts the pool remembers. */
export const KEY_MEMORY = 4096;

/** Why a key's previous client left, as the record names it. */
export type PreviousEnd = 'idle' | 'evicted' | 'expired' | 'handle-lost' | 'terminated';

/** What the pool remembers of a key. */
interface KeyMemory {
  incarnations: number;
  previous: PreviousEnd | undefined;
}

export class ClientSet {
  private readonly open = new Set<PooledClient>();
  private readonly ending = new Set<PooledClient>();
  private readonly current = new Map<string, PooledClient>();
  private readonly perPrincipal = new Map<string, number>();
  private readonly memory = new Map<string, KeyMemory>();

  /** Clients in the open set. */
  get openCount(): number {
    return this.open.size;
  }

  /** Clients in the ending set. */
  get endingCount(): number {
    return this.ending.size;
  }

  /** Every client in the open set. */
  openClients(): readonly PooledClient[] {
    return [...this.open];
  }

  /** Clients of the open set that count for `principal`. */
  principalCount(principal: string): number {
    return this.perPrincipal.get(principal) ?? 0;
  }

  /** The key's current client — opening or open, taking new leases — if it has one. */
  currentFor(key: string): PooledClient | undefined {
    return this.current.get(key);
  }

  /** The next incarnation number for `key`, and why its previous client left. */
  nextIncarnation(key: string): { readonly generation: number; readonly previous?: PreviousEnd } {
    const remembered = this.remember(key);
    remembered.incarnations += 1;
    const previous = remembered.previous;
    remembered.previous = undefined;
    return { generation: remembered.incarnations, ...(previous !== undefined && { previous }) };
  }

  /** A new client joins the open set as its key's current client. */
  admit(client: PooledClient): void {
    this.open.add(client);
    this.current.set(client.key.key, client);
    this.perPrincipal.set(client.key.principal, this.principalCount(client.key.principal) + 1);
  }

  /** The client stops taking new leases: its key has no current client until the next open. */
  retire(client: PooledClient, why: PreviousEnd): void {
    if (this.current.get(client.key.key) === client) this.current.delete(client.key.key);
    this.remember(client.key.key).previous = why;
  }

  /** The client moves from the open set into the ending set. */
  moveToEnding(client: PooledClient, why: PreviousEnd | undefined): void {
    if (why !== undefined) this.retire(client, why);
    else if (this.current.get(client.key.key) === client) this.current.delete(client.key.key);
    this.leaveOpen(client);
    this.ending.add(client);
  }

  /** The client's ending settled: it leaves the ending set. */
  ended(client: PooledClient): void {
    this.ending.delete(client);
  }

  /** The client leaves the open set without ending — a failed open, a lost handle. */
  drop(client: PooledClient, why?: PreviousEnd): void {
    if (why !== undefined) this.retire(client, why);
    else if (this.current.get(client.key.key) === client) this.current.delete(client.key.key);
    this.leaveOpen(client);
  }

  /**
   * The least recently used idle client of the open set — among those `pick`
   * accepts — or `undefined` when every one is busy.
   */
  leastRecentlyUsedIdle(pick: (client: PooledClient) => boolean): PooledClient | undefined {
    let oldest: PooledClient | undefined;
    for (const client of this.open) {
      if (client.busy || client.state !== 'open' || !pick(client)) continue;
      if (oldest === undefined || client.usedAt < oldest.usedAt) oldest = client;
    }
    return oldest;
  }

  private leaveOpen(client: PooledClient): void {
    if (!this.open.delete(client)) return;
    const left = this.principalCount(client.key.principal) - 1;
    if (left > 0) this.perPrincipal.set(client.key.principal, left);
    else this.perPrincipal.delete(client.key.principal);
  }

  private remember(key: string): KeyMemory {
    let remembered = this.memory.get(key);
    if (remembered !== undefined) this.memory.delete(key);
    else remembered = { incarnations: 0, previous: undefined };
    this.memory.set(key, remembered);
    while (this.memory.size > KEY_MEMORY) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
    return remembered;
  }
}

/** The record's `previous` for an end reason, when it names one. */
export function previousOf(reason: EndReason): PreviousEnd | undefined {
  switch (reason) {
    case 'idle':
    case 'evicted':
    case 'expired':
    case 'handle-lost':
      return reason;
    case 'terminated':
    case 'closed':
      return 'terminated';
    case 'abandoned-open':
      return undefined;
  }
}
