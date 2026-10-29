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
 *   - MAKING ROOM: the principal's, then the pool's, least recently used IDLE
 *     client moves to the ending set — or `PoolFullError` at once.
 *   - ENDING reserves an ending slot and an operation slot FIRST; when either is
 *     full the client stays in the open set, counted, reported deferred, and is
 *     ended when slots free. Every end goes through `terminate()`.
 *   - SETTLEMENT, never an abort, returns a slot (`work.ts`).
 */

import { eitherSignal, untilAborted } from '../../lib/abort.js';
import type { Tool } from '../../tools/tools.js';
import { isLocalSessionHandleLost } from '../../tools/toolSessions.js';
import {
  halfOpenOf,
  type ClientPort,
  type HalfOpen,
  type PooledClientSeam,
} from '../clientPort.js';
import { openPooledClient } from '../mcpClient.js';
import { withGuard, type RequestGuard } from '../requestGuard.js';
import type { ThrottleFetch } from '../throttleRetry.js';
import type { McpClientOptions, McpTerminateOutcome } from '../types.js';
import { ClientSet, previousOf, type PreviousEnd } from './clientSet.js';
import {
  definitionOf,
  SharedDefinitions,
  type Definition,
  type DefinitionList,
} from './definitions.js';
import { McpPoolRefusedError, PoolFullError, type McpPoolLimit } from './errors.js';
import { encodeIdentityField } from '../../memory/identity/encode.js';
import { scopeMatcher, type PoolKey } from './identityKey.js';
import { MAX_SHARED_TOOLS, type PoolSettings } from './options.js';
import { resolvePlan, type ClientPlan, type OpenedClient } from './plan.js';
import { PooledClient, type EndReason } from './pooledClient.js';
import { Reporter, type UseFacts } from './record.js';
import {
  OperationBudget,
  Work,
  type Operation,
  type OperationKind,
  type WorkKind,
} from './work.js';

/** An app lease, as the pool tracks it for `maxLeaseMs`. */
export interface HeldLease {
  readonly client: PooledClient;
  readonly takenAt: number;
  /** Revoked: its next use throws `lease-expired`. */
  revoked: boolean;
  /** Released: idempotent. */
  released: boolean;
}

/** Where a list's definitions live: a client's own, or a shared entry. */
export interface ServedList {
  readonly list: DefinitionList;
  readonly shared: boolean;
  /** The definitions context: `pc:` or `sh:`. */
  readonly context: string;
}

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

  constructor(readonly settings: PoolSettings) {
    this.budget = new OperationBudget(settings.maxOperations);
    this.reporter = new Reporter(settings.name, settings.onEvent);
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

  // ─── Admission ─────────────────────────────────────────────────────

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

  // ─── Clients and leases ────────────────────────────────────────────

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
      const current = this.clients.currentFor(key.key);
      if (current === undefined) {
        const opened = this.openFor(key, operation, facts, plan);
        await this.waitOpen(opened, operation);
        return this.takeLease(opened, operation, facts);
      }
      if (current.abandoned) throw this.refused('init-timeout');
      if (current.state === 'open') {
        if (facts.client === 'refused') facts.client = 'reused';
        return this.takeLease(current, operation, facts);
      }
      // Opening: join it, inside this operation's own slot.
      facts.client = 'joined';
      facts.clientId = current.clientId;
      facts.generation = current.generation;
      await this.waitOpen(current, operation);
      if (current.serving) return this.takeLease(current, operation, facts);
    }
    throw this.refused('init-failed');
  }

  private takeLease(client: PooledClient, operation: Operation, facts: UseFacts): PooledClient {
    // The caller detached while it waited: nothing more is done for it.
    operation.check();
    client.leases += 1;
    client.usedAt = this.now();
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
    client.usedAt = this.now();
    if (client.leases === 0) {
      // A lost handle has left the pool already: closed locally once idle.
      if (client.lost === 'handle-lost') void client.client?.close().catch(() => undefined);
      else if (client.deferredEnd !== undefined) this.endClient(client, client.deferredEnd);
    }
    this.notifyIdle();
  }

  private notifyIdle(): void {
    for (const check of [...this.idleWaiters]) check();
  }

  /** An app lease: a hold on a client for as long as the app keeps it, at most `maxLeaseMs`. */
  holdLease(client: PooledClient): HeldLease {
    client.leases += 1;
    client.usedAt = this.now();
    if (client.deferredEnd === 'idle' || client.deferredEnd === 'evicted') {
      client.deferredEnd = undefined;
    }
    const lease: HeldLease = { client, takenAt: this.now(), revoked: false, released: false };
    this.leases.add(lease);
    return lease;
  }

  /** End an app lease — at most once, whether released or revoked. */
  endLease(lease: HeldLease): void {
    if (!this.leases.delete(lease)) return;
    this.releaseLease(lease.client);
  }

  private revokeExpiredLeases(): void {
    const now = this.now();
    for (const lease of [...this.leases]) {
      if (now - lease.takenAt < this.settings.maxLeaseMs) continue;
      lease.revoked = true;
      this.endLease(lease);
      this.reporter.report({
        kind: 'lease-revoked',
        clientId: lease.client.clientId,
        keyHash: lease.client.key.keyHash,
        durationMs: Math.max(0, now - lease.takenAt),
      });
    }
  }

  /** Every app lease is revoked: the pool is closing. */
  revokeAllLeases(): void {
    for (const lease of [...this.leases]) {
      lease.revoked = true;
      this.endLease(lease);
    }
  }

  // ─── The open ──────────────────────────────────────────────────────

  /**
   * Open a client for `key`: make room, resolve its plan, admit it to the open
   * set, and start the one open. The operation that started it tracks the open's
   * settlement, so its charge stays until the open's work has settled.
   */
  private openFor(
    key: PoolKey,
    operation: Operation,
    facts: UseFacts,
    resolved: ClientPlan | undefined,
  ): PooledClient {
    this.makeRoom(key);
    let plan: ClientPlan;
    try {
      plan = resolved ?? resolvePlan(this.settings, key);
    } catch (cause) {
      throw this.refused('init-failed', cause);
    }
    const { generation, previous } = this.clients.nextIncarnation(key.key);
    const client = new PooledClient(key, plan, generation, this.now());
    this.clients.admit(client);
    facts.client = 'opened';
    facts.clientId = client.clientId;
    facts.generation = generation;
    if (previous !== undefined) facts.previous = previous;
    const work = this.startOpen(client);
    operation.phase = 'open';
    operation.track(work.whenSettled());
    return client;
  }

  /** The one open of `client`, under the pool's own signal and `initTimeoutMs`. */
  private startOpen(client: PooledClient): Work {
    const work = new Work('open', [this.lifetime.signal]);
    const startedAt = this.now();
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    ready.catch(() => undefined);
    client.opening = { ready, work, startedAt };
    client.phase = work;
    let timedOut = false;
    let opened: OpenedClient | undefined;
    let halfOpen: HalfOpen | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      client.abandoned = true;
      work.abort(initTimeout());
      rejectReady(this.refused('init-timeout'));
    }, this.settings.initTimeoutMs);
    const seam = this.seamFor(client, work.signal);
    let pending: Promise<OpenedClient>;
    try {
      pending = (this.settings.open ?? openPooledClient)(this.clientOptions(client), seam);
    } catch (error) {
      pending = Promise.reject(error);
    }
    work.track(pending);
    pending.then(
      (result) => {
        clearTimeout(timer);
        opened = result;
        client.client = result.client;
        client.port = result.port;
        if (!timedOut && !this.closed) {
          client.state = 'open';
          client.initMs = Math.max(0, this.now() - startedAt);
          client.opening = undefined;
          if (client.phase === work) client.phase = undefined;
          resolveReady();
          this.notifyIdle();
        } else if (!timedOut) {
          // The pool closed while it opened: nobody gets it; it is ended below.
          timedOut = true;
          rejectReady(this.refused('closed'));
        }
        work.finish();
      },
      (error: unknown) => {
        clearTimeout(timer);
        halfOpen = halfOpenOf(error);
        if (!timedOut) {
          rejectReady(this.closed ? this.refused('closed') : this.refused('init-failed', error));
        }
        work.finish();
      },
    );
    // Once the open's own work has settled: an abandoned open that opened a
    // session is ended under the ending rule; a failed one frees its slot.
    work.onSettled(() => {
      this.notifyIdle();
      if (!timedOut && opened !== undefined) return;
      client.opening = undefined;
      if (client.phase === work) client.phase = undefined;
      // A failed open whose server opened a session all the same has a session
      // to end: so does an abandoned open that succeeded.
      const session = opened?.port ?? (halfOpen?.hasSession() === true ? halfOpen : undefined);
      if (session === undefined) {
        this.dropFailedOpen(client);
        return;
      }
      if (opened === undefined) client.port = endingOnly(session);
      client.state = 'open';
      client.closedToNew = true;
      this.clients.retire(client, 'terminated');
      this.endClient(client, 'abandoned-open');
    });
    return work;
  }

  private dropFailedOpen(client: PooledClient): void {
    client.opening = undefined;
    client.state = 'ended';
    client.phase = undefined;
    this.clients.drop(client);
    this.retryDeferred();
    this.notifySettled();
  }

  /** Wait for `client`'s open inside `operation`: the caller's signal detaches the caller only. */
  private async waitOpen(client: PooledClient, operation: Operation): Promise<void> {
    const opening = client.opening;
    if (opening === undefined) {
      if (client.state === 'open') return;
      throw this.refused(client.abandoned ? 'init-timeout' : 'init-failed');
    }
    await untilAborted(opening.ready, operation.signal);
  }

  /** What `mcpClient` is opened with: the connection-shaping options, the pool's signal. */
  private clientOptions(client: PooledClient): McpClientOptions {
    return {
      name: this.settings.name,
      transport: client.plan.transport,
      signal: this.lifetime.signal,
      ...this.settings.client,
    };
  }

  /** What only a pool asks of the client it opens (`clientPort.ts`). */
  private seamFor(client: PooledClient, connectSignal: AbortSignal): PooledClientSeam {
    return {
      connectSignal,
      wrapFetch: (inner, claim) => this.pooledFetch(client, inner, claim),
      guardFor: () => client.phase,
      onToolsChanged: () => this.toolsChangedOn(client),
    };
  }

  /**
   * The pool's own fetch, outermost on every pooled transport: a request is
   * checked against its guard (the pooled call's, else the client's phase) and
   * counted under it; the guard's signal is linked in; and the answer is read
   * for the two pieces of evidence the pool classifies on — a 404 the MCP server
   * itself sent to a request that carried its session id, and a handle this
   * process lost. The client's own standalone stream (a GET) is the client's,
   * not an operation's: it passes untouched.
   */
  private pooledFetch(
    client: PooledClient,
    inner: ThrottleFetch,
    claim: (body: unknown) => RequestGuard | undefined,
  ): ThrottleFetch {
    return async (input, init) => {
      // The client's own stream, and a notification — never refused, never cut
      // by an operation; a cancellation is counted under its call at `send`.
      if ((init?.method ?? 'GET').toUpperCase() === 'GET' || isNotification(init?.body)) {
        return inner(input, init);
      }
      const guard = claim(init?.body) ?? client.phase;
      if (guard === undefined) return inner(input, init);
      guard.check();
      const carriesSession = new Headers(init?.headers).has('mcp-session-id');
      const signal = eitherSignal(init?.signal ?? undefined, guard.signal);
      const sent = inner(input, {
        ...withGuard(init, guard),
        ...(signal !== undefined && { signal }),
      });
      guard.track(sent);
      try {
        const response = await sent;
        if (response.status === 404 && carriesSession && guard instanceof Work) {
          if (await isServerAnswer(response)) guard.note('server-404');
        }
        return response;
      } catch (error) {
        if (isLocalSessionHandleLost(error) && guard instanceof Work) guard.note('handle-lost');
        throw error;
      }
    };
  }

  // ─── Making room, and ending ───────────────────────────────────────

  /**
   * Make room for a new client of `key`: the principal's least recently used
   * idle client, then the pool's, moves to the ending set — or `PoolFullError`
   * at once, naming the budget. There is no queue.
   */
  private makeRoom(key: PoolKey): void {
    if (this.clients.principalCount(key.principal) >= this.settings.maxClientsPerPrincipal) {
      const victim = this.clients.leastRecentlyUsedIdle((c) => c.key.principal === key.principal);
      if (victim === undefined) throw this.full('principal');
      this.evict(victim);
    }
    if (this.clients.openCount >= this.settings.maxClients) {
      const victim = this.clients.leastRecentlyUsedIdle(() => true);
      if (victim === undefined) throw this.full('pool');
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
      throw this.full(reserved);
    }
    this.startEnding(victim, 'evicted', reserved);
  }

  /** An ending slot and an operation slot, both, or which one is full. */
  private reserveEnding(): Operation | 'ending' | 'operations' {
    if (this.clients.endingCount >= this.settings.maxEnding) return 'ending';
    return this.budget.admit('ending', 'ending', [], this.now()) ?? 'operations';
  }

  /**
   * End `client` for `reason` — when it is idle and both slots can be reserved.
   * Otherwise it stays in the open set, still counted, and is reported deferred
   * (once); it is ended when its last lease ends or slots free.
   */
  endClient(client: PooledClient, reason: EndReason): void {
    if (client.state !== 'open' || client.leases > 0 || client.port === undefined) {
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

  private defer(client: PooledClient, reason: EndReason): void {
    const first = client.deferredEnd === undefined;
    // A stronger reason replaces a weaker one: terminated, closed or expired
    // outrank an idle end or an eviction.
    if (first || client.deferredEnd === 'idle' || client.deferredEnd === 'evicted') {
      client.deferredEnd = reason;
    }
    if (!first || client.state === 'ending' || client.state === 'ended') return;
    this.reporter.report({
      kind: 'deferred',
      clientId: client.clientId,
      keyHash: client.key.keyHash,
      reason,
      durationMs: 0,
    });
  }

  /** Move `client` into the ending set under `operation`, and end it through `terminate()`. */
  private startEnding(client: PooledClient, reason: EndReason, operation: Operation): void {
    client.deferredEnd = undefined;
    client.state = 'ending';
    this.clients.moveToEnding(client, previousOf(reason));
    client.phase = operation;
    const ending = (client.port as NonNullable<PooledClient['port']>).end();
    client.endingOutcome = ending.outcome;
    operation.track(ending.settled);
    void ending.outcome.then((outcome) => {
      this.noteEnded(client, reason, outcome);
      operation.finish();
    });
    operation.onSettled(() => {
      this.clients.ended(client);
      client.state = 'ended';
      client.phase = undefined;
      // The ending slot is free only now: deferred endings may run, and a
      // `settled()` waiting on the ending set may resolve.
      this.retryDeferred();
      this.notifySettled();
    });
  }

  private noteEnded(client: PooledClient, reason: EndReason, outcome: McpTerminateOutcome): void {
    if (!outcome.resolved) this.unresolvedEndings += 1;
    this.reporter.report({
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
   * A client whose handle this process lost: nothing can be sent, so it leaves
   * the open set at once, its ending recorded unresolved. It is closed locally
   * once its last lease ends.
   */
  lostHandle(client: PooledClient): void {
    if (client.lost !== undefined || client.state !== 'open') return;
    client.lost = 'handle-lost';
    client.closedToNew = true;
    client.deferredEnd = undefined;
    client.state = 'ended';
    this.clients.drop(client, 'handle-lost');
    this.noteEnded(client, 'handle-lost', {
      remote: 'handle-lost',
      resolved: false,
      durationMs: 0,
    });
    if (client.leases === 0) void client.client?.close().catch(() => undefined);
    this.retryDeferred();
  }

  /** A client whose session the server ended: no new lease; ended (through `terminate()`) when idle. */
  expired(client: PooledClient): void {
    if (client.lost !== undefined) return;
    client.lost = 'expired';
    client.closedToNew = true;
    this.clients.retire(client, 'expired');
    this.endClient(client, 'expired');
  }

  private sweepIdle(): void {
    const cutoff = this.now() - this.settings.idleMs;
    for (const client of this.clients.openClients()) {
      if (client.state !== 'open' || client.busy || client.deferredEnd !== undefined) continue;
      // Retired only once its ending starts (`startEnding`): while it waits
      // for slots, its own conversation may still use it.
      if (client.usedAt <= cutoff) this.endClient(client, 'idle');
    }
  }

  /** Retry every deferred ending whose client is now idle. */
  retryDeferred(): void {
    for (const client of this.clients.openClients()) {
      if (client.deferredEnd === undefined || client.busy || client.state !== 'open') continue;
      this.endClient(client, client.deferredEnd);
    }
  }

  // ─── Lists ─────────────────────────────────────────────────────────

  /** Where `client`'s definitions are served from: its shared entry, or its own list. */
  servedListOf(client: PooledClient): ServedList {
    if (client.plan.shared) {
      return {
        list: this.shared.entryFor(client.plan.context, client.key.tenant).list,
        shared: true,
        context: client.plan.context,
      };
    }
    return { list: client.list, shared: false, context: client.plan.context };
  }

  /**
   * `served`'s list, listed again on `client` when it cannot be served as it
   * stands — one listing at a time per list; a second caller joins it inside its
   * own slot. A listing raced by an invalidation is discarded and listed once
   * more; refused (`stale-tools`) if that is discarded too.
   */
  async ensureListed(
    client: PooledClient,
    served: ServedList,
    operation: Operation,
  ): Promise<ServedList> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (served.list.servable(this.now(), this.settings.definitionTtlMs)) return served;
      if (served.list.listing === undefined) this.startListing(client, served, operation);
      operation.phase = 'listing';
      await untilAborted(served.list.listing as Promise<void>, operation.signal);
      operation.check();
      // Too long to share: this conversation's own client keeps it.
      if (served.shared && !served.list.servable(this.now(), this.settings.definitionTtlMs)) {
        if (client.list.servable(this.now(), this.settings.definitionTtlMs)) {
          return { list: client.list, shared: false, context: served.context };
        }
      }
    }
    if (served.list.servable(this.now(), this.settings.definitionTtlMs)) return served;
    throw this.refused('stale-tools');
  }

  /** One listing on `client`, written into `served`'s list if its generation held. */
  private startListing(client: PooledClient, served: ServedList, operation: Operation): void {
    const { list } = served;
    const began = list.generation;
    const beganOwn = client.list.generation;
    const work = new Work('listing', [this.lifetime.signal]);
    operation.track(work.whenSettled());
    const port = client.port;
    if (port === undefined) throw this.refused('init-failed');
    client.phase = work;
    const pending = port.listing(work.signal);
    work.track(pending);
    list.listing = pending
      .then((listing) => {
        const definitions = listing.listed
          .map((listed) => definitionOf(listed))
          .filter((d): d is Definition => d !== undefined);
        if (served.shared && definitions.length > MAX_SHARED_TOOLS) {
          // Used by its own client, never shared.
          client.list.write(beganOwn, definitions, listing.tools, this.now());
          return;
        }
        list.write(began, definitions, served.shared ? undefined : listing.tools, this.now());
      })
      .catch((error: unknown) => {
        this.classifyFailure(client, work, error);
        throw error;
      })
      .finally(() => {
        list.listing = undefined;
        if (client.phase === work) client.phase = undefined;
        work.finish();
      });
    list.listing.catch(() => undefined);
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

  // ─── Invalidation ──────────────────────────────────────────────────

  /** The server said a client's tool list changed: that client's list and its shared entry. */
  private toolsChangedOn(client: PooledClient): void {
    client.list.invalidate();
    if (client.plan.shared) this.shared.peek(client.plan.context)?.list.invalidate();
  }

  /** The app's permission signal: every list in the scope. */
  permissionsChanged(scope: { readonly tenant?: string; readonly principal?: string }): void {
    const matches = scopeMatcher({
      ...(scope.tenant !== undefined && { tenant: scope.tenant }),
      ...(scope.principal !== undefined && { principal: scope.principal }),
    });
    for (const client of this.clients.openClients()) {
      if (matches(client.key)) client.list.invalidate();
    }
    // A shared entry is used across the tenant's principals: any of them changing invalidates it.
    const tenant = encodeIdentityField(scope.tenant);
    this.shared.invalidate((entry) => entry.tenant === tenant);
  }

  /** The server changed: every list. */
  toolsChanged(): void {
    for (const client of this.clients.openClients()) client.list.invalidate();
    this.shared.invalidate(() => true);
  }

  // ─── Terminate, close, settle ──────────────────────────────────────

  /**
   * Stop new leases on every client `scope` names, at once; wait for their
   * in-flight work up to `waitMs`; then end each one whose slots can be
   * reserved. The rest are reported deferred and ended when they can be.
   */
  async terminate(
    matches: (key: PoolKey) => boolean,
    reason: EndReason,
    waitMs: number,
  ): Promise<readonly McpTerminateOutcome[]> {
    const named = this.clients.openClients().filter((c) => matches(c.key));
    for (const client of named) {
      client.closedToNew = true;
      this.clients.retire(client, previousOf(reason) ?? 'terminated');
    }
    await this.waitIdle(named, waitMs);
    return this.endNow(named, reason);
  }

  /** End each of `clients` whose slots can be reserved; the outcomes of those that started. */
  private endNow(
    clients: readonly PooledClient[],
    reason: EndReason,
  ): Promise<McpTerminateOutcome[]> {
    const outcomes: Promise<McpTerminateOutcome>[] = [];
    for (const client of clients) {
      if (client.state !== 'open') continue;
      this.endClient(client, reason);
      if ((client.state as string) === 'ending' && client.endingOutcome !== undefined) {
        outcomes.push(client.endingOutcome);
      }
    }
    return Promise.all(outcomes);
  }

  /** Wait until every client in `clients` is idle, or `waitMs` passed. */
  private waitIdle(clients: readonly PooledClient[], waitMs: number): Promise<void> {
    if (!clients.some((c) => c.busy)) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.idleWaiters.delete(check);
        resolve();
      };
      const check = (): void => {
        if (!clients.some((c) => c.busy)) done();
      };
      const timer = setTimeout(done, waitMs);
      (timer as { unref?: () => void }).unref?.();
      this.idleWaiters.add(check);
    });
  }

  /**
   * Close: refuse new work, revoke app leases, abort in-flight work through the
   * pool's own signal, then end every client as slots can be reserved — at most
   * `maxEnding` at a time — in rounds, each bounded by `waitMs` (and each
   * ending's answer by its own deadline). What could not be ended yet is
   * reported deferred and ended when slots free; work still unsettled stays
   * charged until it settles.
   */
  async closeAll(waitMs: number): Promise<readonly McpTerminateOutcome[]> {
    this.shutDown();
    const all = this.clients.openClients();
    for (const client of all) {
      client.closedToNew = true;
      this.clients.retire(client, 'terminated');
    }
    await this.waitIdle(all, waitMs);
    const outcomes: McpTerminateOutcome[] = [];
    for (;;) {
      const started = await this.endNow(all, 'closed');
      if (started.length === 0) break;
      outcomes.push(...started);
      if (!all.some((c) => c.state === 'open')) break;
      await this.waitSlots(waitMs);
    }
    for (const client of all) {
      if (client.state === 'open' || client.state === 'opening') this.defer(client, 'closed');
    }
    return outcomes;
  }

  /** Wait until an ending slot and an operation slot are free, or `waitMs` passed. */
  private waitSlots(waitMs: number): Promise<void> {
    const free = (): boolean =>
      this.clients.endingCount < this.settings.maxEnding && this.budget.hasRoom;
    if (free()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      (timer as { unref?: () => void }).unref?.();
      const unsubscribe = this.budget.whenReleased(() => {
        if (free()) done();
      });
    });
  }

  /** Refuse new work, revoke app leases, abort in-flight work through the pool's signal. */
  shutDown(): void {
    this.closed = true;
    this.revokeAllLeases();
    this.lifetime.abort(poolClosed());
  }

  /** Resolve once every charged operation and every ending has settled. */
  settled(): Promise<void> {
    if (this.quiet()) return Promise.resolve();
    return new Promise((resolve) => this.settleWaiters.push(resolve));
  }

  private quiet(): boolean {
    return (
      this.budget.count === 0 &&
      this.clients.endingCount === 0 &&
      !this.clients.openClients().some((c) => c.state === 'opening')
    );
  }

  private notifySettled(): void {
    if (!this.quiet()) return;
    for (const resolve of this.settleWaiters.splice(0)) resolve();
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

  /** The bound shape of every definition in `served`, for a client of `key`. */
  definitionsOf(served: ServedList): readonly Definition[] {
    return served.list.all();
  }

  /** The tools a list's client-own entries carry, by name (per-client lists only). */
  ownTool(served: ServedList, name: string): Tool | undefined {
    return served.shared ? undefined : served.list.tool(name);
  }
}

/** A port that can only end: what a half-opened session leaves the pool. */
function endingOnly(halfOpen: { end(): ReturnType<ClientPort['end']> }): ClientPort {
  return {
    listing: () => Promise.reject(new Error('This client never opened.')),
    bind: () => {
      throw new Error('This client never opened.');
    },
    end: () => halfOpen.end(),
  };
}

/** What a failed request proved about its client, if anything. */
export type RequestEvidenceOutcome = 'expired' | 'handle-lost' | undefined;

/** The reason an open is aborted at its deadline — a fixed sentence. */
function initTimeout(): Error {
  return Object.assign(new Error('The pooled client did not open within its deadline.'), {
    name: 'TimeoutError',
  });
}

/** The reason in-flight work is aborted when the pool closes — a fixed sentence. */
function poolClosed(): Error {
  return Object.assign(new Error('The MCP client pool was closed.'), { name: 'AbortError' });
}

/** A JSON-RPC notification: a method and no id. Never refused, never counted here. */
function isNotification(body: RequestInit['body'] | undefined): boolean {
  if (typeof body !== 'string') return false;
  try {
    const message = JSON.parse(body) as { readonly method?: unknown; readonly id?: unknown };
    return typeof message?.method === 'string' && message.id === undefined;
  } catch {
    return false;
  }
}

/**
 * Is a 404 the MCP server's own answer — a JSON-RPC error response — rather than
 * an intermediary's (a platform's "not found" for a missing endpoint, a proxy's
 * page)? Read from a copy of the body, which the SDK reads too.
 */
async function isServerAnswer(response: Response): Promise<boolean> {
  try {
    const text = await response.clone().text();
    const parsed = JSON.parse(text) as { readonly jsonrpc?: unknown; readonly error?: unknown };
    const error = parsed?.error as { readonly code?: unknown } | undefined;
    return parsed?.jsonrpc === '2.0' && typeof error?.code === 'number';
  } catch {
    return false;
  }
}

/** Re-exported for the bound tool: which end reasons name a previous client. */
export type { PreviousEnd };
