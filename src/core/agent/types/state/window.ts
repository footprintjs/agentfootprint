import type { FoldedSpan, WindowRecord } from '../../window/types.js';

export interface WindowState {
  // ── The window ledger (`.window()` / `.compaction()`) ──────────
  /** One record per visit to the window stage that ENGAGED — including the
   *  visits that removed nothing, which are the interesting ones. Written
   *  only by an agent built with `.window()` or `.compaction()`; absent
   *  otherwise, so an agent without one commits exactly the keys it always
   *  did.
   *
   *  This array is the strategy's half of the law: the window shrank, and the
   *  ledger says which stages' messages left it, how many, and what the last
   *  call actually measured. The messages themselves are untouched in the
   *  commit bundles that wrote them.
   *
   *  The key is `compactions` because that is what it shipped as in 7.16,
   *  when compaction was the family's only member. It is committed state —
   *  public surface for anyone reading a run — so it keeps its name rather
   *  than break every reader for a better word. Narrow a record by its
   *  `strategy` field, not by the key it lives under. */
  compactions?: readonly WindowRecord[];
  /** The DURABLE half of the same law: one span per fold, carrying what the
   *  summary stands for and — under `retain: 'conversation'`, the default —
   *  the folded messages themselves.
   *
   *  `compactions` is a record of what a RUN did and dies with the run's
   *  commit log. This is what a CONVERSATION carries: `agent.checkpoint()`
   *  copies it onto `AgentRunCheckpoint.folded`, `resumeOnError` restores it,
   *  and so a standing agent's spans accumulate across every turn, every
   *  restart and every deploy.
   *
   *  Written only when a strategy actually replaced messages with something
   *  that stands for them (today: `summarizeOldest`). Absent otherwise, so an
   *  agent that never folds commits exactly the keys it always did. */
  foldedSpans?: readonly FoldedSpan[];
}
