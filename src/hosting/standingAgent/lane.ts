import { type Agent } from '../../core/Agent.js';
import { type DurableWriter } from '../durability.js';
import { type HostReply } from '../types.js';
import { type HostedInvocation } from '../../core/runnerLive.js';

/**
 * One agent, and everything this composer keeps beside it.
 *
 * A lane is the unit of serialization: one queue, one active run, one reply to
 * emit tokens into. `{ agent }` builds exactly one lane and every session maps
 * to it — which is what makes that shape's global serialization fall out of the
 * same code rather than being a second implementation of it. `{ agentFactory }`
 * builds one per active session plus one for anonymous traffic.
 *
 * Lane wiring survives turns; delivery and progress bind the admitted native
 * invocation. Direct or mounted uses of the same runner belong to no hosted
 * turn, even while this lane is still awaiting persistence or reply delivery.
 */
export interface Lane {
  /** How the pool holds it — {@link laneKeyOf}. */
  readonly poolKey: string;
  /** The session this pooled lane serves; undefined for the anonymous lane and the shared one. */
  readonly sessionId?: string;
  readonly agent: Agent;
  /** The FIFO every request on this lane waits behind. Never rejects. */
  chain: Promise<void>;
  /** Session keys admitted and not yet started — the `'reject'` collision set. */
  readonly queued: string[];
  /** The session key of the run in flight, when there is one. */
  activeSession?: string;
  activeRunId?: string;
  /** The REAL session id of the active run — never the anonymous placeholder. */
  activeSessionId?: string;
  /**
   * WHO the active turn was proven to be, at a verifying door — the one fact
   * the artifact door needs for a session whose FIRST turn is still in flight
   * (nothing persisted yet, so no stored owner to ask). `undefined` for an
   * anonymous turn, or with no verifier.
   */
  activeOwner?: string;
  turn?: {
    readonly invocation: HostedInvocation;
    readonly reply: HostReply;
    readonly spendKey?: string;
  };
  /** Requests admitted and not yet finished. A lane with work is never evicted. */
  admitted: number;
  /** When this lane last took a request — the LRU key. */
  lastUsedMs: number;
  writer?: DurableWriter;
  /** Undo everything this composer attached to the agent. */
  detach: () => void;
}
