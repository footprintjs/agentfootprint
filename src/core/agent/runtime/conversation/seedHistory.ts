import type { LLMMessage } from '../../../../provider-contract/types.js';
import type { NegativeCheckpoint } from '../../negativeClaims/checkpoint.js';

/**
 * A stored conversation handed to the next run — what
 * `runtime/conversation/owner.ts · applyContinuation` stashes and `seedFrom` consumes.
 *
 * It carries the history EXACTLY as stored and a flag, never a pre-built
 * user entry: the entry this turn adds is written in ONE place,
 * `historyForTurn`, from the message the `'input'` chain let through. A
 * continuation that appended the caller's raw message before the chain ran
 * would put the unrewritten text in front of the model while the record
 * (`userMessage`, `middlewareDecisions`) said the rewrite happened — the
 * bug fixed in 9.112.2.
 */
export interface PendingResumeHistory {
  /** The conversation as stored — no entry for this turn in it. */
  readonly history: readonly LLMMessage[];
  /**
   * `true` for `run({ continueFrom })` (and so `followUp()` and every stored
   * session behind `standingAgent`): continuing a conversation ADDS this
   * turn's user message. `false` for `resumeOnError`, whose failing turn's
   * message is already the last user entry in `history`.
   */
  readonly appendsUserTurn: boolean;
  /**
   * The turn the stored history ends on — `AgentRunCheckpoint.turnNumber`,
   * which a checkpoint carries only while an honesty layer is armed. Seed
   * continues the turn stamp from it (`turnNumberFor`); absent → the stored
   * history's count, and the restored ledger's stamps, are all it has.
   */
  readonly turn?: number;
  readonly negatives?: NegativeCheckpoint;
}

/**
 * The conversation this run starts from, ending in this turn's user entry —
 * the ONE place that entry is written (9.112.2).
 *
 * `message` is what the `'input'` chain let through (the caller's message
 * when there is no chain). A refusal never calls this writer. A rewrite —
 * a scrub, a stated quote — is the entry the model
 * reads on a continued turn exactly as on a first one.
 *
 *   • fresh run → `[{ user: message }]`
 *   • `run({ continueFrom })` → the stored conversation + `{ user: message }`
 *   • `resumeOnError` → the stored conversation as-is: its last user entry
 *     IS the failing turn's message, and adding it again would ask twice.
 *     An empty stored history falls back to the fresh-run entry, as it
 *     always did.
 *
 * With no chain, every arm yields the bytes the earlier releases committed.
 */
export function historyForTurn(
  resume: PendingResumeHistory | undefined,
  message: string,
): readonly LLMMessage[] {
  const entry: LLMMessage = { role: 'user', content: message };
  if (resume === undefined) return [entry];
  if (resume.appendsUserTurn) return [...resume.history, entry];
  return resume.history.length > 0 ? [...resume.history] : [entry];
}
