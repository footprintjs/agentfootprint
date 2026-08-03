/**
 * core/durabilityBarrier — the one seam a durable session composer may hold
 * inside a run, and nothing else may.
 *
 * ── What it is ───────────────────────────────────────────────────────────────
 * A run's tool dispatch asks, once per ReAct iteration, "is there a durable
 * write still in flight from the LAST iteration?" and — only if there is —
 * waits for it before executing this iteration's tools. That is the entire
 * mechanism. It exists because the alternative is a bound nobody can state:
 * without it, iteration N's tools can run while iteration N-1's write is still
 * on the wire, so a crash replays MORE than one iteration of side effects and
 * "how much can re-execute?" has no answer.
 *
 * ── Why it is a WeakMap and not an option ────────────────────────────────────
 * This is deliberately **not** a public extension point. footprintjs's stage
 * seams and phase chain are closed here, and a general "run something between
 * my stages" hook would be a new one — it would let any consumer inject
 * latency, ordering and failures into a traversal, and every later feature
 * would have to reason about it. So the barrier is keyed off the runner
 * instance in a module-private WeakMap that appears on no barrel and no
 * subpath: `agentfootprint/hosting`'s session writer installs it, the tool
 * dispatch reads it, and there is no third party. Nothing in the public API
 * surface mentions it, which is the point.
 *
 * ── Why it costs nothing when nobody installed one ───────────────────────────
 * {@link pendingDurableWrite} returns `undefined` — not a resolved promise —
 * when no barrier is installed, so the dispatch loop does not `await`, does not
 * schedule a microtask, and produces byte-identical timing to an agent that
 * never heard of durability.
 *
 * Pattern: Instance-keyed private capability (a WeakMap "friend" channel).
 * Role: core/ layer, internal. No events, no state, no scope.
 *
 * @internal
 */

/**
 * What a barrier answers: the write still in flight, or `undefined` when there
 * is nothing to wait for. Returning `undefined` is the fast path and the
 * common case — a mode that persists at run end only never installs one at all.
 *
 * @internal
 */
export type DurabilityBarrier = () => Promise<void> | undefined;

const barriers = new WeakMap<object, DurabilityBarrier>();

/**
 * Install the barrier for one runner. Returns the uninstall function; the
 * caller owns it, exactly as `attach()` and `on()` hand back their own.
 *
 * Last install wins. One runner has at most one barrier because one composer
 * owns its durability — two would be two answers to "has the last write
 * landed?", and a run cannot honour both.
 *
 * @internal
 */
export function installDurabilityBarrier(owner: object, barrier: DurabilityBarrier): () => void {
  barriers.set(owner, barrier);
  return () => {
    if (barriers.get(owner) === barrier) barriers.delete(owner);
  };
}

/**
 * The durable write still in flight for this runner, or `undefined` when there
 * is no barrier installed or nothing outstanding.
 *
 * @internal
 */
export function pendingDurableWrite(owner: object): Promise<void> | undefined {
  return barriers.get(owner)?.();
}
