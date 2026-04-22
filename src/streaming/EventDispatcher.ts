/**
 * EventDispatcher — persistent observer list for a runner.
 *
 * Every runner (Agent, LLMCall, RAG, Swarm, FlowChart, Parallel,
 * Conditional) holds one of these. Consumers subscribe via
 * `runner.observe(handler)` and the dispatcher calls each observer
 * for every AgentStreamEvent that flows through the run.
 *
 * The dispatcher itself is cheap to hold (empty Set + 2 methods).
 * Dispatching to observers error-isolates each callback: a broken
 * consumer callback can NEVER crash the agent run.
 *
 * Bridges to footprintjs's emit channel via `createStreamEventRecorder`:
 * the runner attaches the recorder to its executor once, and the
 * recorder calls `dispatcher.dispatch(event)` for every in-chart
 * stream event. Turn-level events (`turn_start` / `turn_end`) fire
 * directly via `dispatcher.dispatch(...)` from the runner before and
 * after `executor.run()`.
 */
import type { AgentStreamEvent, AgentStreamEventHandler } from './StreamEmitter';

export class EventDispatcher {
  private readonly listeners = new Set<AgentStreamEventHandler>();

  /**
   * Subscribe a handler for the lifetime of the returned unsubscribe
   * function. Idempotent — adding the same handler twice still only
   * fires once per event. Safe to call during a run (the dispatcher
   * uses a snapshot of listeners when dispatching).
   */
  observe(handler: AgentStreamEventHandler): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /**
   * Deliver an event to every subscribed handler. Each callback is
   * wrapped in try/catch so a throwing observer doesn't propagate
   * into the agent run — matches the existing error-isolation
   * contract used by `createStreamEventRecorder`.
   */
  dispatch(event: AgentStreamEvent): void {
    if (this.listeners.size === 0) return;
    // Snapshot to allow observers to subscribe / unsubscribe during
    // dispatch without mutating the live set we're iterating over.
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        /* swallow — a broken consumer callback must never crash a run */
      }
    }
  }

  /** Drop every observer. Used by runner dispose / test teardown. */
  clear(): void {
    this.listeners.clear();
  }

  /** Current observer count. Useful for tests + "no-op fast path". */
  get size(): number {
    return this.listeners.size;
  }
}
