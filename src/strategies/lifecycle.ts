/**
 * strategies/lifecycle — who is still using a strategy, and who may stop it.
 *
 * A strategy is a plain object a consumer builds and hands to `enable.*`. The
 * same object can legitimately be handed over more than once: to two runners
 * (an Agent and the Sequence that contains it), twice to one runner, or to the
 * same runner again after an unsubscribe — the shipped audit-export example
 * does exactly that, deliberately, to collect two runs into one hash chain.
 *
 * `stop()` is terminal in every adapter we ship: events exported afterwards
 * are dropped and there is no restart. So "stop it when someone lets go of it"
 * is wrong — it would silently un-record the second half of that example. This
 * module holds the one fact that makes stopping safe:
 *
 *   **how many live subscriptions still point at this strategy.**
 *
 * Three laws, and they are the whole module:
 *
 *   1. An `Unsubscribe` NEVER stops a strategy. It releases one subscription.
 *      That is the compatibility law: code written before this existed keeps
 *      the behaviour it was written against.
 *   2. A strategy is stopped only when the last subscription has been released
 *      AND something explicitly asked for teardown (`handle.stop()`,
 *      `agent.shutdown()`). Sharing a strategy therefore cannot produce a
 *      half-stopped pipeline where one runner's shutdown blinds another's.
 *   3. `stop()` reaches a strategy AT MOST ONCE, ever. Adapters are already
 *      idempotent; this makes the guarantee the framework's rather than the
 *      adapter author's.
 *
 * A `WeakMap` keyed on the strategy object holds the count, so nothing here
 * retains a strategy that the consumer has dropped, and cross-runner sharing
 * needs no global list.
 */

import type { BaseStrategy } from './types.js';

/**
 * `Symbol.asyncDispose` where the runtime has it (Node ≥ 20.4 — every engine
 * this package supports), and the registered fallback where it does not, so a
 * handle's disposal method is never keyed on `undefined`. ONE owner, because
 * two spellings of this key would make `await using` work on a handle and not
 * on the tracked wrapper around it.
 */
export const ASYNC_DISPOSE: symbol =
  (Symbol as { asyncDispose?: symbol }).asyncDispose ?? Symbol.for('Symbol.asyncDispose');

interface StrategyUsage {
  /** Live subscriptions pointing at this strategy. Never negative. */
  subscriptions: number;
  /** Has `stop()` already been delivered? One-way. */
  stopped: boolean;
}

const USAGE = new WeakMap<BaseStrategy, StrategyUsage>();

function usageOf(strategy: BaseStrategy): StrategyUsage {
  let usage = USAGE.get(strategy);
  if (!usage) {
    usage = { subscriptions: 0, stopped: false };
    USAGE.set(strategy, usage);
  }
  return usage;
}

/** One more live subscription. Called by every `attach*Strategy`. */
export function retainStrategy(strategy: BaseStrategy): void {
  usageOf(strategy).subscriptions += 1;
}

/**
 * One fewer live subscription. Called by every `Unsubscribe`.
 *
 * Deliberately does NOT stop the strategy at zero — see law 1. Idempotent
 * below zero: calling an unsubscribe twice releases one subscription, not two.
 */
export function releaseStrategy(strategy: BaseStrategy): void {
  const usage = usageOf(strategy);
  if (usage.subscriptions > 0) usage.subscriptions -= 1;
}

/** Live subscriptions pointing at this strategy. Diagnostic + tests. */
export function subscriptionCount(strategy: BaseStrategy): number {
  return usageOf(strategy).subscriptions;
}

/** Has this strategy already been stopped? Diagnostic + tests. */
export function isStopped(strategy: BaseStrategy): boolean {
  return usageOf(strategy).stopped;
}

/**
 * Stop the strategy IF nothing is still subscribed to it and it has not been
 * stopped before. Returns what actually happened, so a caller can say why it
 * did nothing rather than guessing.
 *
 * Errors from the strategy's own `stop()` are swallowed: teardown runs on the
 * shutdown path, and one vendor's broken `stop()` must not prevent the next
 * strategy — or the process — from finishing.
 */
export function stopStrategyIfUnused(
  strategy: BaseStrategy,
): 'stopped' | 'still-subscribed' | 'already-stopped' {
  const usage = usageOf(strategy);
  if (usage.stopped) return 'already-stopped';
  if (usage.subscriptions > 0) return 'still-subscribed';
  usage.stopped = true;
  try {
    strategy.stop?.();
  } catch {
    // Passive-recorder rule: teardown never throws at the caller.
  }
  return 'stopped';
}
