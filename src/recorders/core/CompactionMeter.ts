/**
 * compactionMeter — the instrument a window strategy is allowed to read.
 *
 * Pattern: CombinedRecorder (Convention 1 — single purpose: measurement),
 *          with a handle the window stage reads MID-run. That mid-run read is
 *          deliberate and has precedent: the causal-evidence recorder is
 *          attached inline for the same reason (the memory write stage
 *          consumes its accumulators before the run ends).
 * Role:    recorders/core layer. Attached ONLY when a window strategy is
 *          configured (`.window()` / `.compaction()`), and always INLINE — a
 *          window decision cannot ride one beat behind the loop it is
 *          deciding for.
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
 *      `removedStageIds` a strategy has to name.
 */

import type { EmitEvent, WriteEvent } from 'footprintjs';

/** What the provider reported for the most recent completed LLM call. */
export interface MeteredCall {
  readonly input: number;
  readonly output: number;
  readonly runtimeStageId: string;
  /**
   * The ReAct iteration whose call produced this reading, from the
   * `stream.llm_end` payload. It is what makes the reading EXPIRE (8.14.0):
   * before it existed, a provider that reported usage once and then stopped
   * left this number standing forever, and every later window decision was
   * made on it. Messages were evicted on a count nobody had taken.
   */
  readonly meteredAtIteration: number;
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
  /**
   * The last completed LLM call's reported usage — **only if it is still
   * current**. `undefined` before call #1, and `undefined` again once the
   * reading has expired.
   *
   * A reading is current for the iteration that follows the call that
   * produced it, and no longer. The window stage runs at the loop head: at
   * iteration N the last completed call was made during iteration N−1, so a
   * reading stamped older than N−1 means the most recent call reported
   * nothing usable. That is not a smaller number or an older number — it is
   * an ABSENT number, and this returns `undefined` for it. Every strategy
   * already treats `undefined` as "do not act", which is the honest response
   * to a provider that stopped counting.
   *
   * @param currentIteration the iteration the caller is deciding for
   */
  lastCall(currentIteration: number): MeteredCall | undefined;
  /**
   * How many `stream.llm_end` events carried no usable usage since the last
   * good reading. Non-zero means the provider is answering without counting;
   * the window stage turns it into one warning per run.
   */
  unmeteredSinceLastGood(): number;
  /** Origins aligned index-for-index with the current window. */
  origins(): readonly MessageOrigin[];
  /**
   * Tell the meter a window strategy is about to change the window, so it can
   * re-align origins to the new one — `[...head, (inserted)?, ...tail]`:
   * `head` is the leading messages the strategy stepped over (turns that
   * refused to leave), `tail` is the messages kept after the removed span.
   *
   * `insertedAtMs` is the birth of the ONE message the strategy put in the
   * span's place (compaction's summary, a drop's authored notice). Omit it
   * when the strategy removed messages and inserted nothing.
   *
   * Called by the stage that performs the change, BEFORE it writes — the
   * shape change is the one thing the meter cannot infer, because the
   * TypedScope set trap JSON-round-trips every write and destroys object
   * identity.
   */
  rebaseForWindowChange(headCount: number, keptTailCount: number, insertedAtMs?: number): void;
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
 * messages entered THIS run. Shrink only ever comes from a window strategy,
 * and the stage announces it through `rebaseForWindowChange`.
 */
export function compactionMeter(options: CompactionMeterOptions = {}): CompactionMeterHandle {
  const id = options.id ?? 'compaction-meter';
  const key = options.key ?? 'history';
  const now = options.now ?? (() => Date.now());

  let origins: MessageOrigin[] = [];
  let last: MeteredCall | undefined;
  let unmetered = 0;
  /** Set by `rebaseForWindowChange`; consumed by the very next write to `key`. */
  let pendingRebase: { head: number; tail: number; bornAtMs?: number } | undefined;

  return {
    id,

    // A reading survives exactly one iteration boundary — the one it was taken
    // for. Anything older means the newest call did not report, and a number
    // that is no longer being refreshed is not a measurement any more.
    lastCall: (currentIteration: number) =>
      last !== undefined && last.meteredAtIteration >= currentIteration - 1 ? last : undefined,
    unmeteredSinceLastGood: () => unmetered,
    origins: () => origins,

    rebaseForWindowChange(headCount: number, keptTailCount: number, insertedAtMs?: number): void {
      pendingRebase = {
        head: headCount,
        tail: keptTailCount,
        ...(insertedAtMs !== undefined && { bornAtMs: insertedAtMs }),
      };
    },

    clear(): void {
      origins = [];
      last = undefined;
      unmetered = 0;
      pendingRebase = undefined;
    },

    onWrite(event: WriteEvent): void {
      if (event.key !== key || !Array.isArray(event.value)) return;
      const length = event.value.length;
      const stageId = event.runtimeStageId;
      const atMs = now();

      if (pendingRebase !== undefined) {
        // The window stage's own write. Anything it INSERTED is born here;
        // the head and the kept tail carry their original provenance forward,
        // which is the point — a message the strategy did NOT write must
        // never end up looking like the strategy wrote it.
        const head = origins.slice(0, pendingRebase.head);
        const tail =
          pendingRebase.tail > 0 ? origins.slice(origins.length - pendingRebase.tail) : [];
        const inserted =
          pendingRebase.bornAtMs === undefined
            ? []
            : [{ stageId, bornAtMs: pendingRebase.bornAtMs }];
        origins = [...head, ...inserted, ...tail];
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
      const payload = event.payload as
        | { usage?: { input?: number; output?: number }; iteration?: number }
        | undefined;
      const usage = payload?.usage;
      if (typeof usage?.input !== 'number' || typeof usage?.output !== 'number') {
        // A call happened and reported nothing usable. The PREVIOUS reading is
        // deliberately left in place rather than deleted — `lastCall` decides
        // whether it is still current, and it will not be for long. What we do
        // record is that the provider answered without counting, so the stage
        // can say so once instead of the run going quiet.
        unmetered += 1;
        return;
      }
      // No iteration on the payload is a shape this build does not produce
      // (`LLMEndPayload.iteration` is required), but a reading that cannot say
      // WHEN it was taken can never be checked for staleness — so it is not
      // taken. Counting it as unmetered is the honest answer.
      if (typeof payload?.iteration !== 'number') {
        unmetered += 1;
        return;
      }
      unmetered = 0;
      last = {
        input: usage.input,
        output: usage.output,
        runtimeStageId: event.runtimeStageId,
        meteredAtIteration: payload.iteration,
      };
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
