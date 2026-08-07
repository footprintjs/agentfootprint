/**
 * `settlesWithin` — assert a promise settles inside a MICROTASK budget.
 *
 * Why not a `setTimeout` watchdog: the fault this guards against (8.11.1) is a
 * drain loop that awaits already-resolved promises forever. That starves the
 * event loop — no timer ever fires, so a timer-based watchdog can never win
 * the race and the test HANGS instead of failing. Microtasks are FIFO, so a
 * chain of hops keeps advancing even while the loop spins, which makes it the
 * one watchdog that can still fire and name the fault.
 *
 * A regression therefore fails loudly with the message below (the spin does
 * keep running afterwards — nothing in-process can stop it — but the failure
 * is reported rather than silently swallowed by a timeout).
 */

const SPUN = Symbol('microtask-budget-exhausted');

export async function settlesWithin<T>(
  promise: Promise<T>,
  what = 'promise',
  hops = 20_000,
): Promise<T> {
  const budget = (async (): Promise<typeof SPUN> => {
    for (let i = 0; i < hops; i++) await Promise.resolve();
    return SPUN;
  })();
  const winner = await Promise.race([promise, budget]);
  if (winner === SPUN) {
    throw new Error(
      `${what} did not settle within ${hops} microtask hops — the drain loop is ` +
        `spinning instead of finishing. This is the 8.11.1 fault: flush() after ` +
        `stop() must still drain what was already accepted.`,
    );
  }
  return winner as T;
}
