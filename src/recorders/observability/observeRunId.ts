/**
 * observeRunId — shared run-boundary detection helper for recorders.
 *
 * Why this exists: 5 places in observability/* duplicated the same
 * 10-line pattern (lastRunId field + 3-line check + reset). Extract
 * once so the contract stays consistent under maintenance.
 *
 * The pattern: hold a `lastRunId | undefined`. On every observed event:
 *   - If runId is missing/undefined → no-op (defensive, allows callers
 *     to pass `event.meta?.runId` without checking).
 *   - First observation (lastRunId === undefined) → record, no reset.
 *   - Same runId → no-op (steady state).
 *   - Different runId → call onNewRun() then record the new id.
 *
 * Returned helper is mutable closure state — callers store it as a
 * private field and call `.observe(runId)` from event hooks.
 *
 * @example
 * ```typescript
 * class MyRecorder implements ScopeRecorder {
 *   private readonly runIdGuard = createRunIdObserver(() => this.reset());
 *   onWrite(e) {
 *     this.runIdGuard.observe(e.traversalContext?.runId);
 *     // ... handle event
 *   }
 *   private reset() { this.store.clear(); }
 * }
 * ```
 */
export interface RunIdObserver {
  /** Process an event's runId; fires onNewRun callback when it changes. */
  observe(runId: string | undefined): void;
  /** Clear state so the next observation initializes fresh. */
  reset(): void;
}

export function createRunIdObserver(onNewRun: () => void): RunIdObserver {
  let lastRunId: string | undefined;
  return {
    observe(runId) {
      if (!runId) return;
      if (lastRunId === undefined) {
        lastRunId = runId;
        return;
      }
      if (runId !== lastRunId) {
        onNewRun();
        lastRunId = runId;
      }
    },
    reset() {
      lastRunId = undefined;
    },
  };
}
