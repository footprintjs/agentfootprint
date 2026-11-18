import type { ClientSet } from '../clientSet.js';
import type { McpPoolRefusedError } from '../errors.js';
import type { PoolKey } from '../identityKey.js';
import type { PoolSettings } from '../options.js';
import type { ClientPlan } from '../plan.js';
import type { EndReason, PooledClient } from '../pooledClient.js';
import type { Reporter, UseFacts } from '../record.js';
import type { Operation } from '../work.js';
import type { HeldLease } from './contracts.js';

/** Existing pool owners and callbacks used by lease lifecycle work. */
export interface LeasesHost {
  readonly clients: ClientSet;
  readonly leases: Set<HeldLease>;
  readonly settings: Pick<PoolSettings, 'maxLeaseMs'>;
  readonly reporter: Reporter;
  readonly closed: boolean;
  now(): number;
  refused(reason: McpPoolRefusedError['reason'], cause?: unknown): McpPoolRefusedError;
  openFor(
    key: PoolKey,
    operation: Operation,
    facts: UseFacts,
    resolved: ClientPlan | undefined,
  ): PooledClient;
  waitOpen(client: PooledClient, operation: Operation): Promise<void>;
  endClient(client: PooledClient, reason: EndReason): void;
  retryDeferred(): void;
  notifyIdle(): void;
}

/** Lease lifecycle work over the pool's authoritative state. */
export class PoolLeases {
  constructor(private readonly host: LeasesHost) {}

  /**
   * A library lease on `key`'s client for `operation`, opening one when the key
   * has none (inside the operation's slot). `plan` is the plan resolved for a
   * new client; a key that already has one keeps its own. The lease is
   * released when the operation SETTLES.
   */
  async leaseClient(
    key: PoolKey,
    operation: Operation,
    facts: UseFacts,
    plan?: ClientPlan,
  ): Promise<PooledClient> {
    facts.keyHash = key.keyHash;
    for (let round = 0; round < 3; round += 1) {
      const current = this.host.clients.currentFor(key.key);
      if (current === undefined) {
        const opened = this.host.openFor(key, operation, facts, plan);
        const leased = await this.leaseOnceOpen(opened, operation, facts);
        if (leased !== undefined) return leased;
        continue;
      }
      if (current.abandoned) throw this.host.refused('init-timeout');
      if (current.state === 'open') {
        if (facts.client === 'refused') facts.client = 'reused';
        return this.takeLease(current, operation, facts);
      }
      // Opening: join it, inside this operation's own slot.
      facts.client = 'joined';
      facts.clientId = current.clientId;
      facts.generation = current.generation;
      const leased = await this.leaseOnceOpen(current, operation, facts);
      if (leased !== undefined) return leased;
    }
    throw this.host.refused('init-failed');
  }

  /**
   * Wait for `client`'s open inside `operation`, holding a reservation on it
   * all the while — between the open settling and this lease the client is
   * busy, so nobody can evict, idle-end or end it — then check it again and
   * lease it in the same step, with no wait between. `undefined` when it no
   * longer serves: the caller's next round finds the key's next client.
   */
  private async leaseOnceOpen(
    client: PooledClient,
    operation: Operation,
    facts: UseFacts,
  ): Promise<PooledClient | undefined> {
    client.reserved += 1;
    try {
      await this.host.waitOpen(client, operation);
    } catch (error) {
      client.reserved -= 1;
      this.becameIdle(client);
      // The pool closed while it waited: that is the refusal, whatever the wait threw.
      throw this.host.closed ? this.host.refused('closed') : error;
    }
    client.reserved -= 1;
    if (!client.serving) {
      this.becameIdle(client);
      return undefined;
    }
    try {
      return this.takeLease(client, operation, facts);
    } catch (error) {
      this.becameIdle(client);
      throw this.host.closed ? this.host.refused('closed') : error;
    }
  }

  /** `client` may have just become idle: a deferred ending may run, and a waiter for idleness may go on. */
  private becameIdle(client: PooledClient): void {
    if (client.busy) return;
    this.host.retryDeferred();
    this.host.notifyIdle();
  }

  private takeLease(client: PooledClient, operation: Operation, facts: UseFacts): PooledClient {
    // The caller detached while it waited, or before it was admitted: nothing
    // more is done for it. The cached path reaches here with no wait at all,
    // so this is its only check.
    operation.check();
    client.leases += 1;
    client.usedAt = this.host.now();
    // Used again: an idle end or an eviction waiting for slots no longer applies.
    if (client.deferredEnd === 'idle' || client.deferredEnd === 'evicted') {
      client.deferredEnd = undefined;
    }
    facts.clientId = client.clientId;
    facts.generation = client.generation;
    if (client.initMs !== undefined && (facts.client === 'opened' || facts.client === 'joined')) {
      facts.initMs = client.initMs;
    }
    operation.onSettled(() => this.releaseLease(client));
    return client;
  }

  /** One lease ended: the client may now be idle, and a deferred ending may run. */
  releaseLease(client: PooledClient): void {
    client.leases -= 1;
    client.usedAt = this.host.now();
    if (!client.busy && client.deferredEnd !== undefined) {
      this.host.endClient(client, client.deferredEnd);
    }
    this.host.notifyIdle();
  }

  /** An app lease: a hold on a client for as long as the app keeps it, at most `maxLeaseMs`. */
  holdLease(client: PooledClient): HeldLease {
    client.leases += 1;
    client.usedAt = this.host.now();
    if (client.deferredEnd === 'idle' || client.deferredEnd === 'evicted') {
      client.deferredEnd = undefined;
    }
    const lease: HeldLease = { client, takenAt: this.host.now(), revoked: false, released: false };
    this.host.leases.add(lease);
    return lease;
  }

  /** End an app lease — at most once, whether released or revoked. */
  endLease(lease: HeldLease): void {
    if (!this.host.leases.delete(lease)) return;
    this.releaseLease(lease.client);
  }

  revokeExpiredLeases(): void {
    const now = this.host.now();
    for (const lease of [...this.host.leases]) {
      if (now - lease.takenAt < this.host.settings.maxLeaseMs) continue;
      lease.revoked = true;
      this.endLease(lease);
      this.host.reporter.report({
        kind: 'lease-revoked',
        clientId: lease.client.clientId,
        keyHash: lease.client.key.keyHash,
        durationMs: Math.max(0, now - lease.takenAt),
      });
    }
  }

  /** Every app lease is revoked: the pool is closing. */
  revokeAllLeases(): void {
    for (const lease of [...this.host.leases]) {
      lease.revoked = true;
      this.endLease(lease);
    }
  }
}
