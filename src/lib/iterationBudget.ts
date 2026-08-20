/**
 * iterationBudget — how many actions a turn has left, computed in ONE place.
 *
 * Pattern: One pure function. No imports, no state, no clock.
 * Role:    Leaf. Three layers ask this question and used to answer it three
 *          times: the cache decision (`CachePolicyContext.iterationsRemaining`),
 *          the request assembly (`CacheStrategy.prepareRequest`), and — since
 *          9.57.0 — the injection engine, which puts the number in front of
 *          the MODEL.
 * Emits:   N/A.
 *
 * Three copies of `Math.max(0, max - iteration)` were three chances to be off
 * by one, and the one that matters most is the new one: a model told "5 remain"
 * that actually has 4 will plan a step it cannot take. So there is one
 * implementation and every caller uses it.
 *
 * `Math.max(0, …)` rather than a raw subtraction because `iteration` legally
 * exceeds `maxIterations` by one: the out-of-budget wrap-up call (9.56.0) runs
 * at `max + 1`. "0 remain" is the truth there. A negative count would be
 * arithmetic leaking into a sentence a person reads.
 */

/**
 * Actions left in this turn — never negative.
 *
 * @param maxIterations the turn's action cap
 * @param iteration     the action about to be taken (1-based)
 */
export function iterationsRemainingOf(maxIterations: number, iteration: number): number {
  return Math.max(0, maxIterations - iteration);
}
