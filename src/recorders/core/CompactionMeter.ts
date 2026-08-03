/**
 * compactionMeter — the instrument compaction is allowed to read.
 *
 * Pattern: CombinedRecorder (Convention 1 — single purpose: measurement),
 *          with a handle the compaction stage reads MID-run. That mid-run
 *          read is deliberate and has precedent: the causal-evidence
 *          recorder is attached inline for the same reason (the memory write
 *          stage consumes its accumulators before the run ends).
 * Role:    recorders/core layer. Attached ONLY when `.compaction()` is
 *          configured, and always INLINE — a compaction decision cannot ride
 *          one beat behind the loop it is deciding for.
 * Emits:   nothing. It only measures.
 *
 * It answers two questions a stage function cannot answer for itself:
 *
 *   1. "How big was the last window, as the PROVIDER counted it?" — from the
 *      `stream.llm_end` usage the adapter reported. Counted, not guessed.
 *   2. "Which stage put each message in the window?" — from the
 *      `runtimeStageId` on every write to `history`. A stage function has no
 *      access to its own runtimeStageId (footprintjs exposes no such scope
 *      method), so the recorder channel is the ONLY honest source for the
 *      `foldedStageIds` a fold has to name.
 */

import type { EmitEvent, WriteEvent } from 'footprintjs';

/** What the provider reported for the most recent completed LLM call. */
export interface MeteredCall {
  readonly input: number;
  readonly output: number;
  readonly runtimeStageId: string;
}

/** Per-message provenance for the CURRENT window. */
export interface MessageOrigin {
  /** runtimeStageId of the stage whose write first put this message in. */
  readonly stageId: string;
  /** Wall clock when that write happened — the message's birth. */
  readonly bornAtMs: number;
}

export interface CompactionMeterHandle {
  readonly id: string;
  /** The last completed LLM call's reported usage; undefined before call #1. */
  lastCall(): MeteredCall | undefined;
  /** Origins aligned index-for-index with the current window. */
  origins(): readonly MessageOrigin[];
  /**
   * Tell the meter a fold is about to happen so it can re-align origins to
   * the post-fold window, which is `[...head, summary, ...tail]`: `head` is
   * the leading messages the fold stepped over (turns that refused to fold),
   * `tail` is the messages kept after the folded span.
   *
   * Called by the stage that performs the fold, BEFORE it writes — the fold
   * is the one shape the meter cannot infer, because the TypedScope set trap
   * JSON-round-trips every write and destroys object identity.
   */
  rebaseForFold(headCount: number, keptTailCount: number, summaryBornAtMs: number): void;
  clear(): void;
  // CombinedRecorder hooks (routed by method-shape detection):
  onWrite(event: WriteEvent): void;
  onEmit(event: EmitEvent): void;
}

export interface CompactionMeterOptions {
  /** Recorder id (default 'compaction-meter'). */
  readonly id?: string;
  /** Scope key holding the window. Default 'history'. */
  readonly key?: string;
  /** Injectable clock, so tests can pin `survivalMs`. */
  readonly now?: () => number;
}

/**
 * Build the meter.
 *
 * Origin tracking assumes the ONE shape the agent's window actually has:
 * writes either replace the window wholesale (seed, and resume seeding) or
 * append to it (tool-calls). Growth fills the new tail with the writing
 * stage's id; a wholesale replacement re-stamps everything with the writer
 * that produced it — which is exactly true, since that writer is where those
 * messages entered THIS run. Shrink only ever comes from a fold, and a fold
 * announces itself through `rebaseForFold`.
 */
export function compactionMeter(options: CompactionMeterOptions = {}): CompactionMeterHandle {
  const id = options.id ?? 'compaction-meter';
  const key = options.key ?? 'history';
  const now = options.now ?? (() => Date.now());

  let origins: MessageOrigin[] = [];
  let last: MeteredCall | undefined;
  /** Set by `rebaseForFold`; consumed by the very next write to `key`. */
  let pendingRebase: { head: number; tail: number; bornAtMs: number } | undefined;

  return {
    id,

    lastCall: () => last,
    origins: () => origins,

    rebaseForFold(headCount: number, keptTailCount: number, summaryBornAtMs: number): void {
      pendingRebase = { head: headCount, tail: keptTailCount, bornAtMs: summaryBornAtMs };
    },

    clear(): void {
      origins = [];
      last = undefined;
      pendingRebase = undefined;
    },

    onWrite(event: WriteEvent): void {
      if (event.key !== key || !Array.isArray(event.value)) return;
      const length = event.value.length;
      const stageId = event.runtimeStageId;
      const atMs = now();

      if (pendingRebase !== undefined) {
        // The folding stage's own write. The summary is born here; the head
        // and the kept tail carry their original provenance forward, which is
        // the point — a message the fold did NOT write must never end up
        // looking like the compactor wrote it.
        const head = origins.slice(0, pendingRebase.head);
        const tail =
          pendingRebase.tail > 0 ? origins.slice(origins.length - pendingRebase.tail) : [];
        origins = [...head, { stageId, bornAtMs: pendingRebase.bornAtMs }, ...tail];
        pendingRebase = undefined;
        // Trust the write's own length over our bookkeeping if they disagree.
        if (origins.length !== length) origins = normalize(origins, length, stageId, atMs);
        return;
      }

      if (length >= origins.length) {
        for (let i = origins.length; i < length; i++) origins.push({ stageId, bornAtMs: atMs });
        return;
      }
      // An unannounced shrink (a consumer stage rewriting history). Nothing
      // is inferred: re-stamp to the writer that actually produced this array.
      origins = normalize(origins, length, stageId, atMs);
    },

    onEmit(event: EmitEvent): void {
      if (event.name !== 'agentfootprint.stream.llm_end') return;
      const payload = event.payload as { usage?: { input?: number; output?: number } } | undefined;
      const usage = payload?.usage;
      if (typeof usage?.input !== 'number' || typeof usage?.output !== 'number') return;
      last = { input: usage.input, output: usage.output, runtimeStageId: event.runtimeStageId };
    },
  };
}

function normalize(
  current: readonly MessageOrigin[],
  length: number,
  stageId: string,
  atMs: number,
): MessageOrigin[] {
  const next: MessageOrigin[] = [];
  for (let i = 0; i < length; i++) next.push(current[i] ?? { stageId, bornAtMs: atMs });
  return next;
}
