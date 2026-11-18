/** Capacity reservation and ending against the pool's authoritative owners. */

import { isLocalSessionHandleLost } from '../../../tools/toolSessions.js';
import type { McpTerminateOutcome } from '../../types.js';
import { previousOf, type ClientSet } from '../clientSet.js';
import type { McpPoolLimit, PoolFullError } from '../errors.js';
import type { PoolKey } from '../identityKey.js';
import type { PoolSettings } from '../options.js';
import type { EndReason, PooledClient } from '../pooledClient.js';
import type { Reporter } from '../record.js';
import type { Operation, OperationBudget, Work } from '../work.js';
import type { RequestEvidenceOutcome } from './contracts.js';
import { closeLocally } from './endings.js';

/** Actual pool owners and synchronous callbacks needed to end clients. */
export interface EndingHost {
  readonly clients: ClientSet;
  readonly budget: OperationBudget;
  readonly settings: PoolSettings;
  readonly reporter: Reporter;
  now(): number;
  full(limit: McpPoolLimit): PoolFullError;
  noteUnresolvedEnding(): void;
  notifySettled(): void;
}

export class PoolEndingLifecycle {
  constructor(private readonly host: EndingHost) {}

  // ─── Making room, and ending ───────────────────────────────────────

  /**
   * Make room for a new client of `key`: the principal's least recently used
   * idle client, then the pool's, moves to the ending set — or `PoolFullError`
   * at once, naming the budget. There is no queue.
   */
  makeRoom(key: PoolKey): void {
    if (
      this.host.clients.principalCount(key.principal) >= this.host.settings.maxClientsPerPrincipal
    ) {
      const victim = this.host.clients.leastRecentlyUsedIdle(
        (c) => c.key.principal === key.principal,
      );
      if (victim === undefined) throw this.host.full('principal');
      this.evict(victim);
    }
    if (this.host.clients.openCount >= this.host.settings.maxClients) {
      const victim = this.host.clients.leastRecentlyUsedIdle(() => true);
      if (victim === undefined) throw this.host.full('pool');
      this.evict(victim);
    }
  }

  /**
   * Move `victim` to the ending set to make room. When the slots cannot be
   * reserved, the arrival is refused at once, and the victim stays in the open
   * set, counted, reported deferred — ended once slots free.
   */
  private evict(victim: PooledClient): void {
    const reserved = this.reserveEnding();
    if (typeof reserved === 'string') {
      this.defer(victim, 'evicted');
      throw this.host.full(reserved);
    }
    // A victim already waiting to end for a stronger reason ends for that one.
    const waiting = victim.deferredEnd;
    const reason = waiting !== undefined && waiting !== 'idle' ? waiting : 'evicted';
    this.startEnding(victim, reason, reserved);
  }

  /** An ending slot and an operation slot, both, or which one is full. */
  private reserveEnding(): Operation | 'ending' | 'operations' {
    if (this.host.clients.endingCount >= this.host.settings.maxEnding) return 'ending';
    return this.host.budget.admit('ending', 'ending', [], this.host.now()) ?? 'operations';
  }

  /**
   * End `client` for `reason` — when it is idle and both slots can be reserved.
   * Otherwise it stays in the open set, still counted, and is reported deferred
   * (once); it is ended when its last lease ends or slots free.
   */
  endClient(client: PooledClient, reason: EndReason): void {
    if (client.state !== 'open' || client.busy || client.port === undefined) {
      this.defer(client, reason);
      return;
    }
    const reserved = this.reserveEnding();
    if (typeof reserved === 'string') {
      this.defer(client, reason);
      return;
    }
    this.startEnding(client, reason, reserved);
  }

  defer(client: PooledClient, reason: EndReason): void {
    const first = client.deferredEnd === undefined;
    // A stronger reason replaces a weaker one: terminated, closed or expired
    // outrank an idle end or an eviction.
    if (first || client.deferredEnd === 'idle' || client.deferredEnd === 'evicted') {
      client.deferredEnd = reason;
    }
    if (!first || client.state === 'ending' || client.state === 'ended') return;
    this.host.reporter.report({
      kind: 'deferred',
      clientId: client.clientId,
      keyHash: client.key.keyHash,
      reason,
      durationMs: 0,
    });
  }

  /**
   * Move `client` into the ending set under `operation`, and end it through
   * `terminate()` — or, for a lost handle, through its local close alone.
   */
  private startEnding(client: PooledClient, reason: EndReason, operation: Operation): void {
    client.deferredEnd = undefined;
    client.state = 'ending';
    this.host.clients.moveToEnding(client, previousOf(reason));
    client.phase = operation;
    const ending =
      client.lost === 'handle-lost'
        ? closeLocally(client)
        : (client.port as NonNullable<PooledClient['port']>).end();
    client.endingOutcome = ending.outcome;
    operation.track(ending.settled);
    void ending.outcome.then((outcome) => {
      this.noteEnded(client, reason, outcome);
      operation.finish();
    });
    operation.onSettled(() => {
      this.host.clients.ended(client);
      client.state = 'ended';
      client.phase = undefined;
      // The ending slot is free only now: deferred endings may run, and a
      // `settled()` waiting on the ending set may resolve.
      this.retryDeferred();
      this.host.notifySettled();
    });
  }

  private noteEnded(client: PooledClient, reason: EndReason, outcome: McpTerminateOutcome): void {
    if (!outcome.resolved) this.host.noteUnresolvedEnding();
    this.host.reporter.report({
      kind: 'ended',
      clientId: client.clientId,
      keyHash: client.key.keyHash,
      reason,
      remote: outcome.remote,
      resolved: outcome.resolved,
      ...(outcome.status !== undefined && { status: outcome.status }),
      ...(outcome.errorClass !== undefined && { errorClass: outcome.errorClass }),
      durationMs: outcome.durationMs,
    });
  }

  /**
   * A client whose handle this process lost: nothing can be sent for it, so it
   * leaves its key at once — the next use opens the key's next client — and is
   * ended under the ending rule like any other: its ending is its LOCAL close,
   * charged an ending slot and an operation slot until that close settles, its
   * remote outcome recorded unresolved. Busy, or with no slots free, it waits —
   * still counted in the open set, reported deferred.
   */
  lostHandle(client: PooledClient): void {
    if (client.lost !== undefined || client.state !== 'open') return;
    client.lost = 'handle-lost';
    client.closedToNew = true;
    this.host.clients.retire(client, 'handle-lost');
    this.endClient(client, 'handle-lost');
  }

  /** A client whose session the server ended: no new lease; ended (through `terminate()`) when idle. */
  expired(client: PooledClient): void {
    if (client.lost !== undefined) return;
    client.lost = 'expired';
    client.closedToNew = true;
    this.host.clients.retire(client, 'expired');
    this.endClient(client, 'expired');
  }

  sweepIdle(): void {
    const cutoff = this.host.now() - this.host.settings.idleMs;
    for (const client of this.host.clients.openClients()) {
      if (client.state !== 'open' || client.busy || client.deferredEnd !== undefined) continue;
      // Retired only once its ending starts (`startEnding`): while it waits
      // for slots, its own conversation may still use it.
      if (client.usedAt <= cutoff) this.endClient(client, 'idle');
    }
  }

  /** Retry every deferred ending whose client is now idle. */
  retryDeferred(): void {
    for (const client of this.host.clients.openClients()) {
      if (client.deferredEnd === undefined || client.busy || client.state !== 'open') continue;
      this.endClient(client, client.deferredEnd);
    }
  }

  /**
   * A request failed: when the pool's fetch read the server's own 404 for the
   * session, or this process lost the handle, the client leaves its key — the
   * next use opens the next client under the SAME key — and the error says so.
   */
  classifyFailure(client: PooledClient, work: Work, error: unknown): RequestEvidenceOutcome {
    if (isLocalSessionHandleLost(error) || work.evidence === 'handle-lost') {
      this.lostHandle(client);
      return 'handle-lost';
    }
    if (work.evidence === 'server-404') {
      this.expired(client);
      return 'expired';
    }
    return undefined;
  }
}
