/**
 * pooledClient — one client INCARNATION: the conversation it serves, the plan it
 * was opened from, its leases, its own tool list, and where it is in its life.
 *
 * Pattern: a plain record the pool owns; no behaviour beyond its own counters.
 * Role:    § 5 of the design. A client is OPENING until its open settles, OPEN
 *          while it can serve, ENDING from the decision to end it until that
 *          ending's work has settled, then ENDED. It is BUSY while any lease is
 *          open — the library's, one per operation, or the app's — and IDLE
 *          otherwise. A busy client is never evicted, closed for idleness or
 *          ended. "Used" is the last lease taken or released.
 *
 * Its `clientId` is the pool's own random id; its `generation` counts the key's
 * incarnations (1 = the key's first client). A replacement is a new record with
 * a new id, a new list and a count of its own: nothing of an old incarnation
 * can match it.
 */

import type { McpClient, McpTerminateOutcome } from '../types.js';
import type { ClientPort } from '../clientPort.js';
import type { RequestGuard } from '../requestGuard.js';
import { DefinitionList } from './definitions.js';
import type { PoolKey } from './identityKey.js';
import type { ClientPlan } from './plan.js';
import type { Work } from './work.js';

/** Where a client is in its life. */
export type ClientState = 'opening' | 'open' | 'ending' | 'ended';

/** Why a client ended — the record's `reason`. */
export type EndReason =
  | 'idle'
  | 'evicted'
  | 'terminated'
  | 'closed'
  | 'expired'
  | 'handle-lost'
  | 'abandoned-open';

/** A random id of the pool's own — never derived from an identity. */
function newClientId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

/** One client incarnation. */
export class PooledClient {
  readonly clientId = newClientId();
  state: ClientState = 'opening';
  /** The ordinary `McpClient`, once opened. */
  client: McpClient | undefined;
  /** The port back (`clientPort.ts`), once opened. */
  port: ClientPort | undefined;
  /** Open leases: one per library operation, one per app lease. */
  leases = 0;
  /** The last lease taken or released, on the pool's clock. */
  usedAt: number;
  /** No new lease: `terminate` named it, its session expired, or its handle was lost. */
  closedToNew = false;
  /** Its open ran past `initTimeoutMs`: refused to every waiter, still counted until it settles. */
  abandoned = false;
  /** Waiting for an ending slot and an operation slot, and why. */
  deferredEnd: EndReason | undefined;
  /** This incarnation's own tool list. */
  readonly list = new DefinitionList();
  /**
   * The guard of the open, listing or ending in progress on this client — what
   * a request that is not a pooled tool call is checked against and counted by.
   */
  phase: RequestGuard | undefined;
  /** The open in flight, with the work it owns. */
  opening:
    | { readonly ready: Promise<void>; readonly work: Work; readonly startedAt: number }
    | undefined;
  /** How long the open took, once it settled within its deadline. */
  initMs: number | undefined;
  /** Why it left its key without an ordinary ending: its session expired, or its handle was lost. */
  lost: 'expired' | 'handle-lost' | undefined;
  /** The outcome of its ending, once one started. */
  endingOutcome: Promise<McpTerminateOutcome> | undefined;

  constructor(
    readonly key: PoolKey,
    readonly plan: ClientPlan,
    /** 1 = the key's first client, 2 = its first replacement, … */
    readonly generation: number,
    now: number,
  ) {
    this.usedAt = now;
  }

  /** Busy: a lease is open, or it is still opening. */
  get busy(): boolean {
    return this.leases > 0 || this.state === 'opening';
  }

  /** Can it serve a new lease right now? */
  get serving(): boolean {
    return this.state === 'open' && !this.closedToNew;
  }
}
