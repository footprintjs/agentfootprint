import type { AgentfootprintEvent } from '../../../events/registry.js';
import type { Unsubscribe } from '../../../events/dispatcher.js';

/**
 * Anything that can hand out every typed event as it fires — the one
 * capability `BoundaryRecorder.subscribe()` needs.
 *
 * A `Runner` satisfies this (`runner.on('*', …)`) and so does the
 * internal `EventDispatcher`, which is the point: wiring the recorder's
 * typed half never requires reaching past the public runner for a
 * dispatcher it doesn't hand out.
 */
export interface TypedEventSource {
  on(type: '*', listener: (event: AgentfootprintEvent) => void): Unsubscribe;
}

export interface BoundaryRecorderOptions {
  readonly id?: string;
  /**
   * Live commit-count accessor — `() => runner.getCommitCount()` on an
   * agentfootprint runner, or `() => executor.getCommitCount()` on a raw
   * footprintjs executor (5.1+). When provided:
   *   - Every DomainEvent gains `commitIdxBefore` / `commitIdxAfter`.
   *   - `recorder.boundaryIndex` is populated with open/close ranges
   *     keyed on each subflow's entry event.
   *
   * **Omitting it produces a recording whose step strip cannot be
   * rebuilt.** Every event is stamped `commitIdxBefore: 0`, so every
   * boundary claims to have opened at the same instant; `boundaryIndex`
   * is deliberately left EMPTY rather than filled with zero-width
   * `[0, 0]` ranges that would read as real. Offline, a consumer
   * replaying this bundle sees no positions to place, so the strip stays
   * quiet — the honest outcome, and an unrecoverable one: the commit log
   * records what each stage WROTE, never when a boundary was crossed
   * relative to it, so nothing downstream can derive the axis after the
   * fact. There is no error and the events otherwise look complete,
   * which is exactly why this is called out here.
   *
   * Sample it live — a closure over the runner, not a captured number.
   * The count is meaningless before the run starts and must be read at
   * the moment each boundary fires. Phase 5 Layer 2.
   */
  readonly getCommitCount?: () => number;
  /**
   * How much of each event `toSnapshot()` carries into
   * `runtimeSnapshot.recorders`.
   *
   *   - `'full'` (default) — every field, content included. Required by
   *     `buildStepGraphFromEvents()`: an offline `<Replay>` restores its
   *     entry/exit payloads, assistant text, tool args and tool results
   *     from this bundle and nowhere else.
   *   - `'lean'` — boundary STRUCTURE only. Drops the five content
   *     fields (`payload`, `args`, `result`, `content`,
   *     `contentSummary`); keeps every field that says WHERE, WHEN and
   *     OF WHAT KIND each boundary was, so the commit-range index
   *     rebuilds range for range offline. Sized on one demo turn (4
   *     ReAct iterations, 4 LLM calls, 3 tool calls, run end to end on
   *     a mock provider): the bundle this method returned was 69.7 KB
   *     raw / 4.6 KB gzipped, its lean projection 21.7 KB / 1.9 KB —
   *     content was 69% of the raw bytes, and a consumer rebuilding
   *     only the index reads none of it. Same run measured twice; that
   *     turn's content was the entry/exit payloads, since only the
   *     boundary side of this recorder was attached — a run that also
   *     `subscribe()`s the typed-event side carries tool args, tool
   *     results and assistant text in there too. (The replay fixture
   *     the suite measures reports a much larger full bundle — it
   *     stands in for each subflow's missing entry seed with that
   *     subflow's final state, so it serializes the state twice per
   *     boundary. Don't quote it.)
   *
   * Same reasoning as `BoundaryRangeLabel`: a stored artifact shouldn't
   * become a second, redaction-bypassing copy of everything the agent
   * read and wrote. Consumers that DO want content join back on
   * `runtimeStageId` against the run's own snapshot.
   *
   * `'full'` stays the default because this bundle has carried content
   * since it shipped (v2.x, 2026-04-27) and offline consumers depend on
   * that silently — a lean default would quietly empty their replays.
   */
  readonly snapshot?: 'full' | 'lean';
  /**
   * Keep raw embedding vectors in captured payloads (8.20.0). Default
   * `false`: every `embedding` / `embeddings` field in a boundary payload is
   * replaced with its `{ dims, norm }` summary at capture time.
   *
   * The default exists because of a field measurement: the memory-read
   * subflow's boundary output carries each retrieved entry's full vector,
   * and one retrieval turn's recording weighed 2.76 MB — ~1.1 MB of it
   * embedding floats no consumer of a recording reads. The retrieval
   * evidence a debugger needs (score, passage, document, rejected
   * candidates) does not live in those floats and is untouched.
   *
   * Set `true` only when a consumer genuinely replays vectors (say, to
   * re-rank offline) — the recording grows by the full vector bytes again.
   */
  readonly recordEmbeddings?: boolean;
}
