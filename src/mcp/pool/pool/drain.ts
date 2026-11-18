import type { McpTerminateOutcome } from '../../types.js';
import { previousOf, type ClientSet } from '../clientSet.js';
import type { PoolKey } from '../identityKey.js';
import type { PoolSettings } from '../options.js';
import type { EndReason, PooledClient } from '../pooledClient.js';
import type { OperationBudget } from '../work.js';

/** Existing pool owners and callbacks used while draining lifecycle work. */
export interface DrainHost {
  readonly clients: ClientSet;
  readonly budget: OperationBudget;
  readonly settings: Pick<PoolSettings, 'maxEnding'>;
  readonly idleWaiters: Set<() => void>;
  readonly settleWaiters: Array<() => void>;
  shutDown(): void;
  endClient(client: PooledClient, reason: EndReason): void;
  defer(client: PooledClient, reason: EndReason): void;
}

/** Drain and settlement work over the pool's authoritative state. */
export class PoolDrain {
  constructor(private readonly host: DrainHost) {}

  notifyIdle(): void {
    for (const check of [...this.host.idleWaiters]) check();
  }

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
    const named = this.host.clients.openClients().filter((c) => matches(c.key));
    for (const client of named) {
      client.closedToNew = true;
      this.host.clients.retire(client, previousOf(reason) ?? 'terminated');
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
      this.host.endClient(client, reason);
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
        this.host.idleWaiters.delete(check);
        resolve();
      };
      const check = (): void => {
        if (!clients.some((c) => c.busy)) done();
      };
      const timer = setTimeout(done, waitMs);
      (timer as { unref?: () => void }).unref?.();
      this.host.idleWaiters.add(check);
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
    this.host.shutDown();
    const all = this.host.clients.openClients();
    for (const client of all) {
      client.closedToNew = true;
      this.host.clients.retire(client, 'terminated');
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
      if (client.state === 'open' || client.state === 'opening') this.host.defer(client, 'closed');
    }
    return outcomes;
  }

  /** Wait until an ending slot and an operation slot are free, or `waitMs` passed. */
  private waitSlots(waitMs: number): Promise<void> {
    const free = (): boolean =>
      this.host.clients.endingCount < this.host.settings.maxEnding && this.host.budget.hasRoom;
    if (free()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      (timer as { unref?: () => void }).unref?.();
      const unsubscribe = this.host.budget.whenReleased(() => {
        if (free()) done();
      });
    });
  }

  /** Resolve once every charged operation and every ending has settled. */
  settled(): Promise<void> {
    if (this.quiet()) return Promise.resolve();
    return new Promise((resolve) => this.host.settleWaiters.push(resolve));
  }

  private quiet(): boolean {
    return (
      this.host.budget.count === 0 &&
      this.host.clients.endingCount === 0 &&
      !this.host.clients.openClients().some((c) => c.state === 'opening')
    );
  }

  notifySettled(): void {
    if (!this.quiet()) return;
    for (const resolve of this.host.settleWaiters.splice(0)) resolve();
  }
}
