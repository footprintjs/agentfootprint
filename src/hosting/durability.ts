/**
 * hosting/durability — how often a run's progress becomes crash-survivable.
 *
 * A standing agent that only writes at the end of a turn is one restart away
 * from losing everything the turn had done: the tool calls it made, the results
 * it read, the iterations it spent. This is the dial that decides how much of
 * that survives, and what it costs.
 *
 * ── Where a mid-run write can honestly come from ─────────────────────────────
 * From the COMMIT boundary, and nowhere else. footprintjs commits a stage's
 * writes after the stage function returns, and committed state is
 * immutable-after-swap — so `ScopeRecorder.onCommit` is the one moment where
 * "what the run has agreed on so far" is a real, complete, consistent thing.
 * Reading the agent's live state at any other moment would be reading a stage's
 * work in progress.
 *
 * There is no mid-run engine checkpoint to store: footprintjs builds a
 * `FlowchartCheckpoint` only at a pause (`getCheckpoint()` is documented as "the
 * most recent PAUSED execution"). So what a mid-run write can carry is a
 * CONVERSATION — the same `AgentRunCheckpoint` every finished turn stores — and
 * that is exactly enough, because that is what the next turn resumes from.
 *
 * ── Why it writes on SOME commits and not all of them ────────────────────────
 * A two-iteration turn commits about forty times. Exactly two of those commits
 * change the conversation: `Initialize` (the user's message lands) and
 * `ToolCalls` (an iteration's assistant turn and its tool results land). Every
 * other commit would store bytes identical to the last write. So the trigger is
 * "this commit wrote `history`", which is not an optimisation but the honest
 * reading of the question: the conversation moved iff `history` moved.
 *
 * ── What a commit boundary actually guarantees, and what it does not ─────────
 * It guarantees the whole stage. The agent dispatches ALL of one iteration's
 * tool calls inside one stage body, so a crash part-way through that body stores
 * nothing from it and a replay re-runs that iteration's tools. That is the
 * shipped idempotency requirement, unchanged — mutating tools must be
 * idempotent, keyed on stable call content rather than `ctx.toolCallId`. What
 * `'sync'` adds is a BOUND on it: iteration N's tools do not start until
 * iteration N-1's write has landed, so the replay is the current iteration and
 * never an earlier one.
 *
 * Pattern: an observer (`CombinedRecorder`) for the snapshot, a serialiser for
 * the writes, and — for `'sync'` only — a barrier the tool dispatch waits on.
 * Role: internal to `standingAgent`. Deliberately not exported: it is how the
 * composer keeps its promise, not a second way to write to a store.
 */

import type { CombinedRecorder, CommitEvent } from 'footprintjs';

import { installDurabilityBarrier } from '../core/durabilityBarrier.js';
import type { LLMMessage } from '../adapters/types.js';
import type { AgentRunCheckpoint } from '../core/runCheckpoint.js';
import type { DurabilityMode } from './types.js';

/** What the writer needs from the composer around it. */
export interface DurableWriterOptions {
  /** `'async'` or `'sync'`. `'exit'` never builds a writer at all. */
  readonly mode: Exclude<DurabilityMode, 'exit'>;
  /**
   * The session this run belongs to, asked at every commit. `undefined` means
   * "nothing to write to" — an anonymous request, or no run of ours in flight —
   * and the commit is ignored.
   */
  readonly session: () => string | undefined;
  /** The run id to stamp on the conversation, for correlating back to the run. */
  readonly runId: () => string | undefined;
  /** Where the conversation goes. */
  readonly write: (sessionId: string, conversation: AgentRunCheckpoint) => Promise<void>;
}

/** The composer's handle on its own durability. */
export interface DurableWriter {
  /** Attach this to the agent to start observing commits. */
  readonly recorder: CombinedRecorder;
  /** Install the tool-dispatch barrier. Returns the uninstall function. */
  install(agent: object): () => void;
  /**
   * Everything outstanding has landed.
   *
   * The composer awaits this before writing a run's FINAL envelope, and that
   * ordering is load-bearing rather than tidy: an `'async'` conversation write
   * still in flight would otherwise land AFTER the terminal envelope and
   * overwrite it — turning a stored pause back into a plain conversation and
   * losing the question a person was asked.
   *
   * **Rejects when the newest write did not land.** Fail-closed on purpose: a
   * store that refused the run's progress has not made it durable, and both
   * things waiting on this — the next tool call under `'sync'`, and the reply —
   * would otherwise proceed on a promise nobody kept.
   */
  settle(): Promise<void>;
}

/**
 * Build the writer.
 *
 * Under `'sync'` it also answers the tool-dispatch barrier, which is what turns
 * "we write often" into a bound on how much can re-run.
 */
export function durableWriter(options: DurableWriterOptions): DurableWriter {
  const { mode, session, runId, write } = options;

  /** The write currently on the wire, or `undefined` when nothing is. */
  let inFlight: Promise<void> | undefined;
  /**
   * The newest snapshot that has not been started yet. At most ONE, and a newer
   * one replaces it: the conversation only grows, so a superseded snapshot is a
   * prefix of the one replacing it and writing it first would buy nothing.
   */
  let queued: { sessionId: string; conversation: AgentRunCheckpoint } | undefined;
  /**
   * Why the NEWEST write did not land, or `undefined` when it did. Cleared by a
   * write that succeeds — a store that failed once and then took the newer
   * state has made that state durable, and reporting the older failure would be
   * describing a problem that no longer exists.
   */
  let failure: Error | undefined;

  /** Per-run accumulation, rebuilt from the commits themselves. */
  let history: readonly LLMMessage[] = [];
  let userMessage = '';
  let iteration = 0;

  function pump(): void {
    if (inFlight !== undefined || queued === undefined) return;
    const next = queued;
    queued = undefined;
    inFlight = write(next.sessionId, next.conversation)
      .then(
        () => {
          failure = undefined;
        },
        (err: unknown) => {
          failure = new Error(
            `[hosting] the session store did not accept this run's progress, so nothing ` +
              `after this point may proceed as if it had` +
              (mode === 'sync' ? ` — the next tool call was not allowed to run` : '') +
              `. Underlying error: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          );
        },
      )
      .then(() => {
        inFlight = undefined;
        pump();
      });
  }

  function enqueue(sessionId: string): void {
    queued = {
      sessionId,
      conversation: {
        version: 1,
        runId: runId() ?? 'unknown',
        // The commit event hands over the stage's retained write view. Clone on
        // the way to a store so nothing a persistence layer does can reach back
        // into the run's own snapshot.
        history: structuredClone(history) as LLMMessage[],
        lastCompletedIteration: iteration,
        originalInput: { message: userMessage },
        checkpointedAt: Date.now(),
      },
    };
    pump();
  }

  const recorder: CombinedRecorder = {
    id: 'af-hosting-durability',
    // INLINE, always. A write delivered one beat behind is a write that can be
    // lost by the very crash it exists to survive — and under `'sync'` the
    // barrier would be waiting on a snapshot the queue had not handed over yet.
    // The causal-evidence bridge and the compaction meter are inline for the
    // same class of reason.
    delivery: 'inline',

    onCommit(event: CommitEvent): void {
      let conversationMoved = false;
      for (const mutation of event.mutations) {
        if (mutation.key === 'history' && Array.isArray(mutation.value)) {
          history = mutation.value as readonly LLMMessage[];
          conversationMoved = true;
        } else if (mutation.key === 'userMessage' && typeof mutation.value === 'string') {
          userMessage = mutation.value;
        } else if (mutation.key === 'iteration' && typeof mutation.value === 'number') {
          iteration = mutation.value;
        }
      }
      if (!conversationMoved) return;
      const sessionId = session();
      if (sessionId === undefined) return;
      enqueue(sessionId);
    },

    // A fresh run starts from a fresh conversation. Without this a resumed run
    // whose first commit has not landed yet could stamp the previous run's
    // history onto this run's id.
    clear(): void {
      history = [];
      userMessage = '';
      iteration = 0;
    },
  };

  const settle = async (): Promise<void> => {
    // Loop rather than await once: a write that completes may release a queued
    // successor, and "settled" has to mean nothing is left.
    while (inFlight !== undefined || queued !== undefined) {
      pump();
      await inFlight;
    }
    if (failure) throw failure;
  };

  return {
    recorder,
    install(agent: object): () => void {
      // `'async'` deliberately takes NO barrier: its whole promise is that the
      // run does not wait, and a barrier would be that promise broken quietly.
      if (mode !== 'sync') return () => undefined;
      return installDurabilityBarrier(agent, () => {
        if (inFlight === undefined && queued === undefined && failure === undefined)
          return undefined;
        return settle();
      });
    },
    settle,
  };
}
