/**
 * evictedTurns — the window stage's outbound seam to the receipt: what left
 * the window at THIS iteration's head, handed to the call-llm mint in the same
 * iteration without a scope read.
 *
 * Role:  Value object + one in-memory handle. Holds the last visit's evictions
 *        keyed by iteration; reads nothing, emits nothing, commits nothing.
 * Reads: what `stages/window.ts` files.
 * Emits: N/A.
 *
 * WHY A HANDLE AND NOT A SCOPE READ. The window already commits every
 * eviction to `scope.compactions` (the ledger — `window/types.ts` states the
 * law), so the fact IS on the record. What the receipt needs is that fact at
 * mint time, and the mint runs in `call-llm`, a different stage. A tracked
 * read of `compactions` from `call-llm` would put that key on every call-llm
 * stage's read set — on the runs that have no window and never write it too —
 * which is exactly the phantom context source per loop that reading the
 * always-absent `slotCompositions` produced for one release
 * (`recorded-not-built.md`, entry 9). So the window hands the turns across in
 * memory, on the same seam the compaction meter already crosses
 * (`CompactionMeterHandle`, attached inline by `Agent.createExecutor`).
 *
 * WHY KEYED BY ITERATION. The window is the loop target: it runs at the head
 * of every iteration from the second on, BEFORE that iteration's call, so the
 * entry the mint reads is always the visit that just ran. Iteration 1 has no
 * visit and reads nothing. A run that aborted between the two stages leaves an
 * entry the next run's visit overwrites before its mint reads — and `clear()`
 * is called where the meter is cleared, so a fresh run starts with none.
 *
 * WHY `read` AND NOT `take`. A stage that retries re-runs its function from
 * the top; a one-shot take would leave the retry's receipt without the drops
 * the first attempt saw. The entry stands until the next visit replaces it.
 *
 * @example the window files, the mint reads, both by iteration
 * ```ts
 * const handle = createEvictedTurnsHandle();
 * handle.file(3, [assistantTurn, toolResult]); // the window stage, iteration 3's head
 * handle.read(3);                              // [assistantTurn, toolResult] — call-llm, same iteration
 * handle.read(4);                              // [] — nothing filed for 4 yet
 * ```
 */

import type { LLMMessage } from '../../../adapters/types.js';

export interface EvictedTurnsHandle {
  /** The window stage files what left at iteration `k`'s head — possibly
   *  nothing, which still replaces a stale entry. */
  file(iteration: number, evicted: readonly LLMMessage[]): void;
  /** What was filed for iteration `k`; `[]` when nothing was. */
  read(iteration: number): readonly LLMMessage[];
  /** Forget everything — called at the start of a run. */
  clear(): void;
}

export function createEvictedTurnsHandle(): EvictedTurnsHandle {
  let filed: { readonly iteration: number; readonly evicted: readonly LLMMessage[] } | undefined;
  return {
    file(iteration, evicted) {
      filed = { iteration, evicted: [...evicted] };
    },
    read(iteration) {
      return filed !== undefined && filed.iteration === iteration ? filed.evicted : [];
    },
    clear() {
      filed = undefined;
    },
  };
}
