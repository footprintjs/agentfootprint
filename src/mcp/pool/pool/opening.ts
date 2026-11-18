import { untilAborted } from '../../../lib/abort.js';
import { halfOpenOf, type HalfOpen, type PooledClientSeam } from '../../clientPort.js';
import { openPooledClient } from '../../mcpClient.js';
import type { McpClientOptions } from '../../types.js';
import type { ClientSet } from '../clientSet.js';
import type { McpPoolRefusedError } from '../errors.js';
import type { PoolKey } from '../identityKey.js';
import type { PoolSettings } from '../options.js';
import { resolvePlan, type ClientPlan, type OpenedClient } from '../plan.js';
import { PooledClient, type EndReason } from '../pooledClient.js';
import type { UseFacts } from '../record.js';
import { Work, type Operation } from '../work.js';
import { endingOnly } from './endings.js';
import { initTimeout } from './refusals.js';

/** The opening delegate's access to the pool's existing owners and live lifecycle. */
export interface OpeningHost {
  readonly clients: ClientSet;
  readonly settings: PoolSettings;
  readonly signal: AbortSignal;
  /** A live getter on the authoritative pool, never a construction-time snapshot. */
  readonly closed: boolean;
  now(): number;
  refused(reason: McpPoolRefusedError['reason'], cause?: unknown): McpPoolRefusedError;
  makeRoom(key: PoolKey): void;
  seamFor(client: PooledClient, connectSignal: AbortSignal): PooledClientSeam;
  endClient(client: PooledClient, reason: EndReason): void;
  notifyIdle(): void;
  retryDeferred(): void;
  notifySettled(): void;
}

/** Opening work over the pool's owners, with no independent pool state. */
export class PoolOpening {
  constructor(private readonly host: OpeningHost) {}

  // ─── The open ──────────────────────────────────────────────────────

  /**
   * Open a client for `key`: make room, resolve its plan, admit it to the open
   * set, and start the one open. The operation that started it tracks the open's
   * settlement, so its charge stays until the open's work has settled.
   */
  openFor(
    key: PoolKey,
    operation: Operation,
    facts: UseFacts,
    resolved: ClientPlan | undefined,
  ): PooledClient {
    this.host.makeRoom(key);
    let plan: ClientPlan;
    try {
      plan = resolved ?? resolvePlan(this.host.settings, key);
    } catch (cause) {
      throw this.host.refused('init-failed', cause);
    }
    const { generation, previous } = this.host.clients.nextIncarnation(key.key);
    const client = new PooledClient(key, plan, generation, this.host.now());
    this.host.clients.admit(client);
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
    const work = new Work('open', [this.host.signal]);
    const startedAt = this.host.now();
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
      rejectReady(this.host.refused('init-timeout'));
    }, this.host.settings.initTimeoutMs);
    const seam = this.host.seamFor(client, work.signal);
    let pending: Promise<OpenedClient>;
    try {
      pending = (this.host.settings.open ?? openPooledClient)(this.clientOptions(client), seam);
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
        if (!timedOut && !this.host.closed) {
          client.state = 'open';
          client.initMs = Math.max(0, this.host.now() - startedAt);
          client.opening = undefined;
          if (client.phase === work) client.phase = undefined;
          resolveReady();
          this.host.notifyIdle();
        } else if (!timedOut) {
          // The pool closed while it opened: nobody gets it; it is ended below.
          timedOut = true;
          rejectReady(this.host.refused('closed'));
        }
        work.finish();
      },
      (error: unknown) => {
        clearTimeout(timer);
        halfOpen = halfOpenOf(error);
        if (!timedOut) {
          rejectReady(
            this.host.closed
              ? this.host.refused('closed')
              : this.host.refused('init-failed', error),
          );
        }
        work.finish();
      },
    );
    // Once the open's own work has settled: an abandoned open that opened a
    // session is ended under the ending rule; a failed one frees its slot.
    // Either way the client has stopped opening — a wait for idle clients
    // (`terminate`, `close`) is told once its new state is in place.
    work.onSettled(() => {
      if (!timedOut && opened !== undefined) {
        this.host.notifyIdle();
        return;
      }
      client.opening = undefined;
      if (client.phase === work) client.phase = undefined;
      // A failed open whose server opened a session all the same has a session
      // to end: so does an abandoned open that succeeded.
      const session = opened?.port ?? (halfOpen?.hasSession() === true ? halfOpen : undefined);
      if (session === undefined) {
        this.dropFailedOpen(client);
      } else {
        if (opened === undefined) client.port = endingOnly(session);
        client.state = 'open';
        client.closedToNew = true;
        this.host.clients.retire(client, 'terminated');
        this.host.endClient(client, 'abandoned-open');
      }
      this.host.notifyIdle();
    });
    return work;
  }

  private dropFailedOpen(client: PooledClient): void {
    client.opening = undefined;
    client.state = 'ended';
    client.phase = undefined;
    this.host.clients.drop(client);
    this.host.retryDeferred();
    this.host.notifySettled();
  }

  /** Wait for `client`'s open inside `operation`: the caller's signal detaches the caller only. */
  async waitOpen(client: PooledClient, operation: Operation): Promise<void> {
    const opening = client.opening;
    if (opening === undefined) {
      if (client.state === 'open') return;
      throw this.host.refused(client.abandoned ? 'init-timeout' : 'init-failed');
    }
    await untilAborted(opening.ready, operation.signal);
  }

  /** What `mcpClient` is opened with: the connection-shaping options, the pool's signal. */
  private clientOptions(client: PooledClient): McpClientOptions {
    return {
      name: this.host.settings.name,
      transport: client.plan.transport,
      signal: this.host.signal,
      ...this.host.settings.client,
    };
  }
}
