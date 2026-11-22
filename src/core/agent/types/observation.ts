import type { AttachRecorderOptions, FlowChartExecutorOptions } from 'footprintjs';

// ─── PUBLIC types (consumer-facing) ────────────────────────────────

/** Options for the events an Agent serves to live observers. */
export interface AgentObservationOptions {
  /**
   * Observer delivery tier (RFC-001 Block 10). Default `'inline'` —
   * byte-identical to every prior release: the Agent's bridge recorders
   * (and your `.watch()` attachments) run synchronously inside the
   * producing statement, so a slow `agent.on()` listener taxes every
   * stage of every iteration.
   *
   * `'deferred'` moves observation off the hot path: every observer event
   * is captured into footprintjs's bounded queue (≈ microseconds) and
   * delivered at the next microtask checkpoint — "one beat behind", with
   * listener work overlapping the LLM/tool await windows instead of
   * serializing with the loop. Same events, same payloads, same order;
   * only the timing meta (`wallClockMs` / `runOffsetMs`) reflects the
   * later delivery. Terminal boundaries (run resolve, reject, pause)
   * drain the queue synchronously BEFORE control returns, so crash
   * reports / checkpoints always carry the complete record.
   *
   * Exception kept inline for correctness: the causal-evidence harvest
   * recorder (mounted with CAUSAL memories) — the memory write stage
   * reads its accumulators MID-run, so it cannot run one beat behind.
   *
   * Per-recorder override: a consumer recorder that declares its own
   * `delivery` field keeps it — the agent-level option is the default
   * tier for recorders that don't declare one.
   *
   * For serverless / graceful shutdown, settle async listener work with
   * `await agent.drainObservers({ timeoutMs })` before the process exits.
   * Queue stats surface on `agent.getLastSnapshot()?.observerStats`.
   */
  readonly observerDelivery?: 'inline' | 'deferred';
  /**
   * Queue dials for `observerDelivery: 'deferred'` — see
   * `ObserverDeliveryOptions`. Throws at construction when set without
   * `observerDelivery: 'deferred'` (no silently-ignored combinations).
   */
  readonly observerDeliveryOptions?: ObserverDeliveryOptions;
  /**
   * Serve provider-classified summary fragments while output policy or answer
   * validation holds draft answers. Omit to hold all live thinking deltas in
   * that case. The completed thinking event keeps its existing behavior.
   * This uses the normal thinking events, run redaction and first-chunk retry
   * rule. The answer policy still owns draft answer text and final delivery.
   */
  readonly liveThinkingWithHeldDrafts?: 'provider-summary';
}

/**
 * Dials for the deferred observer queue (RFC-001) — only meaningful with
 * `observerDelivery: 'deferred'` (passing them without it throws at
 * construction). Same vocabulary as footprintjs's `AttachRecorderOptions`
 * minus `delivery` (the Agent option IS the delivery switch):
 * `capture` (default `'clone'` — hooks receive the same event shape as
 * inline), `maxQueue` (default 10 000), `overflow` (default
 * `'drop-oldest'`), `sampleEvery`, `flushBudgetMs` (default 2).
 */
export type ObserverDeliveryOptions = Omit<AttachRecorderOptions, 'delivery'>;

/**
 * Per-write read-provenance policy — `AgentOptions.writeProvenance`. Derived
 * structurally from footprintjs's executor options (the engine owns the
 * vocabulary; it does not export the alias), so the two can never drift.
 */
export type WriteProvenanceMode = NonNullable<FlowChartExecutorOptions['writeProvenance']>;
