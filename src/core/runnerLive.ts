/**
 * runnerLive — a runner's LIVE taps, for the library's own mechanisms only.
 *
 * Pattern: a module-private registry (runner → taps), filled by `RunnerBase`
 *          as each runner is constructed.
 * Role:    the one way code OUTSIDE a runner's class reads the run as it
 *          really is, never as its records are served.
 *
 * Under a redaction policy (an agent's `redact`, `src/redaction/`) every record
 * of a run is served: the placeholder where the policy selected a value. Two
 * mechanisms outside the runner's class are not records — they hand the run's
 * result back to the person it is for, or keep what the next turn resumes from:
 *
 *   - `onRealEvent` — every event as its producer made it
 *     (`EventDispatcher · onRealEvent`): a hosted agent's streamed reply and
 *     spend ledger (`hosting/standingAgent.ts`), `toSSE({ format: 'text' })`
 *     (`stream.ts`);
 *   - `liveState` — the run's committed root state, live: the conversation a
 *     host's session store resumes from (`hosting/durability.ts`);
 *   - `liveSnapshot` — the run's whole snapshot, live: what the context ledger
 *     counts usage from, whose gates decide what later runs are offered
 *     (`lib/context-ledger/contextLedger.ts`).
 *
 * NO BARREL EXPORTS THIS FILE, and the runner classes carry no method for it:
 * a consumer cannot reach the real values through a runner, so nothing a
 * consumer wires up — an exporter, a recorder, a sink — can turn them into a
 * record. The registry is weak: a runner that is collected takes its taps along.
 */

import type { RuntimeSnapshot } from 'footprintjs';

import type { AgentfootprintEvent } from '../events/registry.js';
import type { Unsubscribe } from '../events/dispatcher.js';

/** What the library reads live from a runner. */
export interface RunnerLive {
  /** Subscribe to every event as its producer made it — never served. */
  onRealEvent(listener: (event: AgentfootprintEvent) => void): Unsubscribe;
  /** The current (or last) run's committed root state, live and unserved; O(1). */
  liveState(): Readonly<Record<string, unknown>> | undefined;
  /** The current (or last) run's snapshot, live and unserved. */
  liveSnapshot(): RuntimeSnapshot | undefined;
}

const taps = new WeakMap<object, RunnerLive>();

/** Register `runner`'s live taps — `RunnerBase` does, once per runner. Returns them. */
export function registerRunnerLive(runner: object, live: RunnerLive): RunnerLive {
  taps.set(runner, live);
  return live;
}

/** The live taps of `runner`, or `undefined` for a runner that is not a `RunnerBase`. */
export function runnerLive(runner: object): RunnerLive | undefined {
  return taps.get(runner);
}
