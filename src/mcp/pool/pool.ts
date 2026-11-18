/**
 * pool — the state behind `mcpClientPool`: who holds which client, what is
 * charged, and what ends when.
 *
 * Pattern: one state machine, mutated only between awaits.
 * Role:    §§ 5–7 of the design. Every mutation of the sets and the budget runs
 *          synchronously — a check and the move it allows are never split by
 *          an await — so two callers cannot both take the last slot.
 *
 *   - ADMISSION: every listing, call, acquire and ending is admitted against
 *     `maxOperations` before anything is sent. At each interaction the lazy
 *     sweep (revoked leases, idle ends, deferred ends) runs FIRST, so it
 *     reserves its endings before the new operation is admitted.
 *   - ONE OPEN PER KEY, from a plan resolved at that moment, under the pool's own
 *     signal and `initTimeoutMs`, never a caller's. A caller that gives up
 *     detaches alone; the operation that started the open keeps its charge until
 *     the open's work settles. Past the deadline every waiter is refused at once
 *     (`init-timeout`), and until the open's work settles the key cannot open
 *     again. A failure reaches every current waiter and is not cached.
 *   - THE HANDOFF: every operation waiting for an open holds a RESERVATION on
 *     the client until it takes its lease, so between the open settling and
 *     that lease the client is busy — nobody can evict, idle-end or end it. The
 *     client's state is checked again after every wait, and the lease taken in
 *     the same step: a lease is never handed out on a client that is ending.
 *   - MAKING ROOM: the principal's, then the pool's, least recently used IDLE
 *     client moves to the ending set — or `PoolFullError` at once.
 *   - ENDING reserves an ending slot and an operation slot FIRST; when either is
 *     full the client stays in the open set, counted, reported deferred, and is
 *     ended when slots free. Every end goes through `terminate()` — but a client
 *     whose handle this process lost: nothing can be sent for it, so its ending
 *     is its local close alone, charged the same way until it settles.
 *   - SETTLEMENT, never an abort, returns a slot (`work.ts`).
 *   - NOTHING UNCHECKED: on a pooled client every request carries a guard — its
 *     call's, or the client's open, listing or ending — and a request with none
 *     is refused before it is sent (`request-unmatched`), at the watched `send`
 *     and at the pool's own fetch alike.
 */

import type { Tool } from '../../tools/tools.js';
import type { RequestGuard } from '../requestGuard.js';
import type { McpTerminateOutcome } from '../types.js';
import { ClientSet, type PreviousEnd } from './clientSet.js';
import { SharedDefinitions, type Definition } from './definitions.js';
import { McpPoolRefusedError, PoolFullError, type McpPoolLimit } from './errors.js';
import type { PoolKey } from './identityKey.js';
import type { PoolSettings } from './options.js';
import type { ClientPlan } from './plan.js';
import type { PooledClient, EndReason } from './pooledClient.js';
import { Reporter, type UseFacts } from './record.js';
import {
  OperationBudget,
  type Work,
  type Operation,
  type OperationKind,
  type WorkKind,
} from './work.js';
import type { HeldLease, RequestEvidenceOutcome, ServedList } from './pool/contracts.js';
import { PoolOpening } from './pool/opening.js';
import { PoolTransport } from './pool/transport.js';
import { PoolLeases } from './pool/leases.js';
import { PoolEndingLifecycle } from './pool/endingLifecycle.js';
import { PoolListing } from './pool/listing.js';
import { PoolDrain } from './pool/drain.js';
import { poolClosed } from './pool/refusals.js';

/** What `stats()` returns: counts, never keys. */
export interface McpPoolStats {
  /** Clients in the open set: opening, busy or idle. */
  readonly open: number;
  readonly busy: number;
  readonly idle: number;
  readonly opening: number;
  /** Clients being ended, until each ending's work has settled. */
  readonly ending: number;
  /** Operations charged. */
  readonly operations: number;
  /** Shared definition entries kept. */
  readonly entries: number;
  /** Charged work past its deadline that has not settled, by what it is doing. */
  readonly unsettled: Readonly<Record<WorkKind, number>>;
  /** Endings whose remote outcome was not confirmed. */
  readonly unresolvedEndings: number;
}

export class Pool {
  readonly clients = new ClientSet();
  readonly budget: OperationBudget;
  readonly shared = new SharedDefinitions();
  readonly reporter: Reporter;
  /** The pool's own signal: what every open, listing and call runs under; aborted at `close()`. */
  private readonly lifetime = new AbortController();
  private readonly leases = new Set<HeldLease>();
  private readonly settleWaiters: Array<() => void> = [];
  /** Waiting for some client to become idle (`terminate`, `close`). */
  private readonly idleWaiters = new Set<() => void>();
  closed = false;
  unresolvedEndings = 0;
  /** The guard of a request nothing covers: it refuses, so the request is never sent. */
  private readonly unmatched: RequestGuard = {
    check: () => {
      throw this.refused('request-unmatched');
    },
    track: () => undefined,
  };
  private readonly leaseOps: PoolLeases;
  private readonly openingOps: PoolOpening;
  private readonly transportOps: PoolTransport;
  private readonly endingOps: PoolEndingLifecycle;
  private readonly listingOps: PoolListing;
  private readonly drainOps: PoolDrain;

  constructor(readonly settings: PoolSettings) {
    this.budget = new OperationBudget(settings.maxOperations);
    this.reporter = new Reporter(settings.name, settings.onEvent);
    const readClosed = () => this.closed;
    const readSignal = () => this.signal;
    this.endingOps = new PoolEndingLifecycle({
      clients: this.clients,
      budget: this.budget,
      settings,
      reporter: this.reporter,
      now: () => this.now(),
      full: (limit) => this.full(limit),
      noteUnresolvedEnding: () => {
        this.unresolvedEndings += 1;
      },
      notifySettled: () => this.notifySettled(),
    });
    this.listingOps = new PoolListing({
      clients: this.clients,
      shared: this.shared,
      settings,
      get signal() {
        return readSignal();
      },
      now: () => this.now(),
      refused: (reason, cause) => this.refused(reason, cause),
      classifyFailure: (client, work, error) => this.classifyFailure(client, work, error),
    });
    this.transportOps = new PoolTransport({
      unmatched: this.unmatched,
      refused: (reason, cause) => this.refused(reason, cause),
      toolsChangedOn: (client) => this.listingOps.toolsChangedOn(client),
    });
    this.openingOps = new PoolOpening({
      clients: this.clients,
      settings,
      get signal() {
        return readSignal();
      },
      get closed() {
        return readClosed();
      },
      now: () => this.now(),
      refused: (reason, cause) => this.refused(reason, cause),
      makeRoom: (key) => this.endingOps.makeRoom(key),
      seamFor: (client, signal) => this.transportOps.seamFor(client, signal),
      endClient: (client, reason) => this.endClient(client, reason),
      notifyIdle: () => this.drainOps.notifyIdle(),
      retryDeferred: () => this.retryDeferred(),
      notifySettled: () => this.notifySettled(),
    });
    this.leaseOps = new PoolLeases({
      clients: this.clients,
      leases: this.leases,
      settings,
      reporter: this.reporter,
      get closed() {
        return readClosed();
      },
      now: () => this.now(),
      refused: (reason, cause) => this.refused(reason, cause),
      openFor: (key, operation, facts, resolved) =>
        this.openingOps.openFor(key, operation, facts, resolved),
      waitOpen: (client, operation) => this.openingOps.waitOpen(client, operation),
      endClient: (client, reason) => this.endClient(client, reason),
      retryDeferred: () => this.retryDeferred(),
      notifyIdle: () => this.drainOps.notifyIdle(),
    });
    this.drainOps = new PoolDrain({
      clients: this.clients,
      budget: this.budget,
      settings,
      idleWaiters: this.idleWaiters,
      settleWaiters: this.settleWaiters,
      shutDown: () => this.shutDown(),
      endClient: (client, reason) => this.endClient(client, reason),
      defer: (client, reason) => this.endingOps.defer(client, reason),
    });
    this.budget.whenReleased((operation) => {
      if (operation.settledLate) {
        this.reporter.report({
          kind: 'settled-late',
          work: operation.phase,
          durationMs: Math.max(0, this.now() - operation.admittedAt),
        });
      }
      this.retryDeferred();
      this.notifySettled();
    });
  }

  now(): number {
    return this.settings.now();
  }

  get signal(): AbortSignal {
    return this.lifetime.signal;
  }

  /**
   * The lazy sweep, run at the start of every interaction: leases past
   * `maxLeaseMs` revoked, idle clients ended, deferred endings retried — all of
   * it before a new operation is admitted.
   */
  interact(): void {
    this.revokeExpiredLeases();
    this.sweepIdle();
    this.retryDeferred();
  }

  /**
   * Admit one operation, or refuse at once: `closed`, or `PoolFullError`
   * (`limit: 'operations'`) — before anything is sent.
   */
  admit(kind: OperationKind, phase: WorkKind, callerSignal: AbortSignal | undefined): Operation {
    if (this.closed) throw this.refused('closed');
    const operation = this.budget.admit(
      kind,
      phase,
      [this.lifetime.signal, callerSignal],
      this.now(),
    );
    if (operation === undefined) throw this.full('operations');
    return operation;
  }

  refused(reason: McpPoolRefusedError['reason'], cause?: unknown): McpPoolRefusedError {
    return new McpPoolRefusedError(
      reason,
      this.settings.name,
      cause === undefined ? {} : { cause },
    );
  }

  full(limit: McpPoolLimit): PoolFullError {
    const max =
      limit === 'pool'
        ? this.settings.maxClients
        : limit === 'principal'
        ? this.settings.maxClientsPerPrincipal
        : limit === 'ending'
        ? this.settings.maxEnding
        : this.settings.maxOperations;
    const busy = this.clients.openClients().filter((c) => c.busy).length;
    return new PoolFullError(
      this.settings.name,
      limit,
      max,
      busy,
      this.clients.endingCount,
      this.budget.count,
    );
  }

  leaseClient(
    key: PoolKey,
    operation: Operation,
    facts: UseFacts,
    plan?: ClientPlan,
  ): Promise<PooledClient> {
    return this.leaseOps.leaseClient(key, operation, facts, plan);
  }

  releaseLease(client: PooledClient): void {
    return this.leaseOps.releaseLease(client);
  }

  holdLease(client: PooledClient): HeldLease {
    return this.leaseOps.holdLease(client);
  }

  endLease(lease: HeldLease): void {
    return this.leaseOps.endLease(lease);
  }

  private revokeExpiredLeases(): void {
    return this.leaseOps.revokeExpiredLeases();
  }

  revokeAllLeases(): void {
    return this.leaseOps.revokeAllLeases();
  }

  endClient(client: PooledClient, reason: EndReason): void {
    return this.endingOps.endClient(client, reason);
  }

  lostHandle(client: PooledClient): void {
    return this.endingOps.lostHandle(client);
  }

  expired(client: PooledClient): void {
    return this.endingOps.expired(client);
  }

  private sweepIdle(): void {
    return this.endingOps.sweepIdle();
  }

  retryDeferred(): void {
    return this.endingOps.retryDeferred();
  }

  servedListOf(client: PooledClient): ServedList {
    return this.listingOps.servedListOf(client);
  }

  refreshContext(client: PooledClient): PooledClient['definitions'] {
    return this.listingOps.refreshContext(client);
  }

  contextHolds(client: PooledClient, context: string): boolean {
    return this.listingOps.contextHolds(client, context);
  }

  ensureListed(client: PooledClient, operation: Operation): Promise<ServedList> {
    return this.listingOps.ensureListed(client, operation);
  }

  classifyFailure(client: PooledClient, work: Work, error: unknown): RequestEvidenceOutcome {
    return this.endingOps.classifyFailure(client, work, error);
  }

  permissionsChanged(scope: { readonly tenant?: string; readonly principal?: string }): void {
    return this.listingOps.permissionsChanged(scope);
  }

  toolsChanged(): void {
    return this.listingOps.toolsChanged();
  }

  terminate(
    matches: (key: PoolKey) => boolean,
    reason: EndReason,
    waitMs: number,
  ): Promise<readonly McpTerminateOutcome[]> {
    return this.drainOps.terminate(matches, reason, waitMs);
  }

  closeAll(waitMs: number): Promise<readonly McpTerminateOutcome[]> {
    return this.drainOps.closeAll(waitMs);
  }

  /** Refuse new work, revoke app leases, abort in-flight work through the pool's signal. */
  shutDown(): void {
    this.closed = true;
    this.revokeAllLeases();
    this.lifetime.abort(poolClosed());
  }

  settled(): Promise<void> {
    return this.drainOps.settled();
  }

  private notifySettled(): void {
    return this.drainOps.notifySettled();
  }

  stats(): McpPoolStats {
    const open = this.clients.openClients();
    const busy = open.filter((c) => c.busy).length;
    return {
      open: open.length,
      busy,
      idle: open.length - busy,
      opening: open.filter((c) => c.state === 'opening').length,
      ending: this.clients.endingCount,
      operations: this.budget.count,
      entries: this.shared.size,
      unsettled: this.budget.unsettled(),
      unresolvedEndings: this.unresolvedEndings,
    };
  }

  definitionsOf(served: ServedList): readonly Definition[] {
    return this.listingOps.definitionsOf(served);
  }

  ownTool(served: ServedList, name: string): Tool | undefined {
    return this.listingOps.ownTool(served, name);
  }
}

/** Re-exported for the bound tool: which end reasons name a previous client. */
export type { PreviousEnd };
export type { HeldLease, RequestEvidenceOutcome, ServedList } from './pool/contracts.js';
