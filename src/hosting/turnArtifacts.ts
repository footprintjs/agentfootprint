/**
 * hosting/turnArtifacts — the artifact hand-over a turn gives its host, and
 * how long it lives.
 *
 *   turnArtifacts: async (turn) => {
 *     if (turn.bound) story = await turn.artifacts.put({ kind: 'story/turn', mediaType, data });
 *   },
 *
 * `standingAgent` opens one per turn (`openTurnArtifacts`), awaits the host's
 * `HostReply.turnArtifacts` hook with it and then `drain()` — both BOUNDED by
 * the composer (`turnArtifactsTimeoutMs`, the request's signal) — and finally
 * `revoke()`s it before the reply's terminal. This module owns that lifetime
 * and the failures it can see; the scope, the bound and the record are the
 * composer's.
 *
 * ── Why the hand-over has a lifetime at all ──────────────────────────────────
 * The scope never widens — the binding closes over one tuple — so a late write
 * can only ever land in the same person's scope. What a late write breaks is
 * the RECORD: the binding's facts are delivered on the serving agent's
 * dispatcher, and by then the agent may be running somebody else's turn (the
 * shared shape), a stopped instance (the pool evicted the lane), or the next
 * turn of the same conversation. So the binding is live only while its turn
 * is — the footprintjs `ScopeFacade · assertLive` law, "a handle held past its
 * stage is refused", applied to the turn.
 *
 * ── Drain, then revoke — and nothing here can crash the process ──────────────
 * `drain()` waits for every operation started through the binding — a `put`
 * the hook never awaited included, and one an earlier operation's
 * continuation starts while it waits. `revoke()` then refuses every later call
 * by name (`TurnArtifactsExpiredError`). Every promise this module hands out
 * is handled the moment it is created — an operation's, and a revoked call's
 * refusal alike — so none of them can become an unhandled rejection that ends
 * the process; a host that awaits one still receives its error. (A promise the
 * HOST derives from one — `put(...).then(f)` — is the host's own.)
 *
 * ── Failures are reported, never swallowed silently ──────────────────────────
 * Every failed operation (`'operation'`, with its verb and error class) and
 * every refused late call (`'expired'`) goes to `onFailure`, which the
 * composer puts on the serving agent's stream. `reported(err)` lets the
 * composer tell a hook that merely re-threw an operation's own failure from a
 * hook that failed for a reason of its own — one failure, counted once.
 *
 * Pattern: Proxy (a lifetime-bounded view over the `ctx.artifacts` capability).
 */

import {
  bindArtifacts,
  type ArtifactEventSink,
  type ToolArtifacts,
} from '../artifacts/capability.js';
import type { ArtifactScope, ArtifactStore } from '../artifacts/types.js';
import { TurnArtifactsExpiredError } from './errors.js';
import type { TurnArtifacts } from './types.js';

/** The five verbs of the capability, by name — what a refusal names. */
type TurnVerb = TurnArtifactsExpiredError['op'];

/** One failure of the hand-over this module can see. */
export type TurnArtifactsFailure =
  | { readonly cause: 'operation'; readonly op: TurnVerb; readonly error: unknown }
  | { readonly cause: 'expired'; readonly op: TurnVerb };

/** What one turn's hand-over is built from. */
export interface TurnArtifactsSource {
  /** The serving agent's store. Absent ⇒ `{ bound: false, reason: 'no-store' }`. */
  readonly store: ArtifactStore | undefined;
  /** This request's redemption scope. Absent ⇒ `{ bound: false, reason: 'no-session' }`. */
  readonly scope: ArtifactScope | undefined;
  /** The run this turn executed, captured when the binding is built — its `origin`. */
  readonly runId: string | undefined;
  /** Where the binding's facts go (the hosting door's adapter onto the record). */
  readonly onEvent: ArtifactEventSink;
  /** Where a failed operation or a refused late call is reported. */
  readonly onFailure: (failure: TurnArtifactsFailure) => void;
}

/** One turn's hand-over: the value the host is given, and the ways to end it. */
export interface OpenTurnArtifacts {
  readonly turn: TurnArtifacts;
  /** Wait for every operation started through the binding — including one
   *  started while this waits. Never rejects; resolves at once when nothing
   *  was bound. The composer races it against its bound. */
  drain(): Promise<void>;
  /** Refuse every later call by name. Idempotent. */
  revoke(): void;
  /** Was this error already reported as a failed operation? */
  reported(err: unknown): boolean;
}

const noop = (): void => undefined;

/**
 * Open this turn's hand-over — bound to `scope`, or the stated reason there is
 * nothing to bind. `'no-session'` is checked first: with no session there is no
 * scope to name at all, whatever the store.
 *
 * @internal — the composer's; hosts receive the `TurnArtifacts` value only.
 */
export function openTurnArtifacts(source: TurnArtifactsSource): OpenTurnArtifacts {
  if (source.scope === undefined) return nothingBound('no-session');
  if (source.store === undefined) return nothingBound('no-store');
  const live = liveForOneTurn(
    bindArtifacts(source.store, source.scope, {
      ...(source.runId !== undefined && { origin: { runId: source.runId } }),
      onEvent: source.onEvent,
    }),
    source.onFailure,
  );
  return { turn: Object.freeze({ bound: true, artifacts: live.artifacts }), ...live.lifetime };
}

function nothingBound(reason: 'no-session' | 'no-store'): OpenTurnArtifacts {
  return {
    turn: Object.freeze({ bound: false, reason }),
    drain: () => Promise.resolve(),
    revoke: noop,
    reported: () => false,
  };
}

/** The capability's five verbs, working until `revoke()`. */
function liveForOneTurn(
  bound: ToolArtifacts,
  onFailure: (failure: TurnArtifactsFailure) => void,
): {
  readonly artifacts: ToolArtifacts;
  readonly lifetime: Omit<OpenTurnArtifacts, 'turn'>;
} {
  let live = true;
  const inFlight = new Set<Promise<void>>();
  const failed = new WeakSet<object>();

  function track<T>(verb: TurnVerb, start: () => Promise<T>): Promise<T> {
    if (!live) {
      // Refused by name, ALREADY handled: a floating late call must never be
      // the unhandled rejection that ends the process. Reported, because a
      // host still filing after its turn is a bug somebody needs to see.
      const refusal = Promise.reject(new TurnArtifactsExpiredError(verb));
      refusal.then(noop, noop);
      onFailure({ cause: 'expired', op: verb });
      return refusal;
    }
    let running: Promise<T>;
    try {
      running = start();
    } catch (err) {
      running = Promise.reject(err);
    }
    // Handled here, at creation — see the file header.
    const settled = running.then(noop, (err: unknown) => {
      if (typeof err === 'object' && err !== null) failed.add(err);
      onFailure({ cause: 'operation', op: verb, error: err });
    });
    inFlight.add(settled);
    void settled.then(() => inFlight.delete(settled));
    return running;
  }

  return {
    artifacts: Object.freeze({
      put: (input) => track('put', () => bound.put(input)),
      head: (ref) => track('head', () => bound.head(ref)),
      get: (ref) => track('get', () => bound.get(ref)),
      delete: (ref) => track('delete', () => bound.delete(ref)),
      list: (options) => track('list', () => bound.list(options)),
    } satisfies ToolArtifacts),
    lifetime: {
      async drain(): Promise<void> {
        while (inFlight.size > 0) await Promise.all([...inFlight]);
      },
      revoke(): void {
        live = false;
      },
      reported: (err: unknown): boolean =>
        typeof err === 'object' && err !== null && failed.has(err),
    },
  };
}
