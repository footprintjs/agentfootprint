import type { CommitValuesMode } from 'foottrace';
import type {
  AttachRecorderOptions,
  FlowChartExecutorOptions,
  WriteTrackingMode,
} from 'footprintjs';
import type { ProseCitationOptions } from '../citations/config.js';

// ─── PUBLIC types (consumer-facing) ────────────────────────────────

/** Options for the events an Agent serves to live observers. */
export interface AgentObservationOptions {
  /** Offer citations in prose on adapters that can prove which tool bodies were submitted. */
  readonly citations?: ProseCitationOptions;
  /**
   * Commit-log value encoding (#13c-B) — forwarded to the internal
   * executor as `{ commitValues }`. Agent default is **`'delta'`**: a
   * stage whose net change to a tracked array is "the old array plus a
   * tail" (the agent's `history` every iteration) records ONLY the tail
   * (`append` verb); key removals record a `delete` verb. LOSSLESS — any
   * step's full value reconstructs by replay (`commitValueAt` from
   * `foottrace`), which is why this is safe for audit trails.
   * Retained commit-log memory becomes linear instead of quadratic.
   * Set `'full'` for footprintjs's default encoding (every changed key
   * stores its full final value) if a downstream consumer reads
   * `bundle.overwrite[key]` as the complete value.
   */
  readonly commitValues?: CommitValuesMode;
  /**
   * Write-tracking policy for the snapshot's per-stage write view
   * (footprintjs `StageSnapshot.stageWrites`), the sibling of
   * `readTracking`. Forwarded to the internal executor as `{ writeTracking }`.
   *
   * - `'summary'` (Agent default) — each written key records a cheap
   *   `WriteSummaryMarker` (`{ __writeSummary, type, size, preview? }`)
   *   instead of the full written value. The execution tree nests one stage
   *   inside the next, and a ReAct pass rewrites growing arrays (`history`,
   *   decision lists), so full values grew the recorded tree with the SQUARE
   *   of the run length: measured at 19 model calls, 3.6 of a 3.85 MB tree.
   * - `'full'` — footprintjs's own default: every written value is kept in
   *   `stageWrites`. Set it explicitly if you read written VALUES off
   *   `agent.getSnapshot()` (not just keys), or for a native stored-cause
   *   capture, which needs every capture dial at `'full'`.
   * - `'off'` — writes are not recorded; `stageWrites` is absent.
   *
   * The commit log, the narrative and `onWrite` events are IDENTICAL in every
   * mode. `onCommit` is not: its `mutations` are this same write view, so each
   * `mutations[].value` is a `WriteSummaryMarker` under `'summary'` (keys and
   * operations unchanged) and `mutations` is empty under `'off'`. A recorder
   * that needs committed values reads them from `onWrite` or from the commit
   * log (`commitValueAt`), which every mode keeps. A redaction policy applies
   * first: a marker describes what the policy retains, never the raw value.
   * Note the Agent default (`'summary'`) is deliberately cheaper than
   * footprintjs's (`'full'`), as `readTracking`'s is.
   *
   * Forwarded to the agent's OWN executor (its runs and resumes). An agent
   * mounted inside a composition (`Sequence`, `Parallel`, `Loop`, …) runs
   * under that composition's executor, which keeps the engine's defaults
   * (`'full'`), as `readTracking` and `commitValues` do.
   */
  readonly writeTracking?: WriteTrackingMode;
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
