import type { FindingsLedger } from '../../findings/types.js';
import type { LLMMessage } from '../../../../provider-contract/types.js';
import type { NegativeCheckpoint } from '../../negativeClaims/checkpoint.js';
import type { CitationCheckpoint } from '../../citations/checkpoint.js';
import type { AgentState } from '../../types.js';
import type { TypedScope } from 'footprintjs';
import type { MemoryStore } from '../../../../memory/store/index.js';
import { resolveTurnNumber } from '../../../../memory/turn/index.js';
import type { ToolTurnEvidence } from '../../recordedCalls/toolTurnCheckpoint.js';
import type { RequestReplayValue } from '../../requestTurn/state.js';
import { writeRequestReplay } from '../../requestTurn/native.js';

/**
 * Raise `scope.turnNumber` to what the conversation's own stores know.
 *
 * The turn number is the KEY memory writes stamp on their entries, so two
 * turns of one conversation must never share it. In-process counting cannot
 * provide that: the shape seen in a production field deployment builds a
 * fresh `Agent` per turn against a stable `conversationId`, so every run
 * starts counting from scratch while the store holds the whole history.
 *
 * Runs after `seedFrom`, because it needs the identity that stage resolves.
 * A store that throws is not swallowed — a memory whose store is unreachable
 * fails at its next read anyway, and a guessed turn number is how a
 * conversation quietly overwrites itself.
 */
export async function anchorTurnNumber(
  scope: TypedScope<AgentState>,
  stores: readonly MemoryStore[],
): Promise<void> {
  scope.turnNumber = await resolveTurnNumber({
    stores,
    identity: scope.runIdentity,
    hostTurn: scope.turnNumber,
  });
}

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
  readonly toolTurnEvidence?: ToolTurnEvidence;
  readonly previousCodeExecutionReceipt?: import('../../scripts/executionEvidence.js').CompletedCodeExecutionReceipt;
  readonly requestReplay?: RequestReplayValue;
  readonly negatives?: NegativeCheckpoint;
  readonly citations?: CitationCheckpoint;
  readonly innerCallPolicyArgs?: import('../../../../redaction/innerCallPolicyCarrier.js').InnerCallPolicyCarrier;
  /** The tickets the library placed earlier in the conversation (`placedTickets.ts`). */
  readonly placedTickets?: readonly import('../../placedTickets.js').PlacedTicket[];
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
function historyForTurn(
  resume: PendingResumeHistory | undefined,
  message: string,
): readonly LLMMessage[] {
  const entry: LLMMessage = { role: 'user', content: message };
  if (resume === undefined) return [entry];
  if (resume.appendsUserTurn) return [...resume.history, entry];
  return resume.history.length > 0 ? [...resume.history] : [entry];
}

/** Restore the conversation and the private projection for the same failed request. */
export function seedHistoryForTurn(
  scope: TypedScope<AgentState>,
  resume: PendingResumeHistory | undefined,
  message: string | undefined,
): readonly LLMMessage[] {
  const history =
    message === undefined ? [...(resume?.history ?? [])] : historyForTurn(resume, message);
  scope.history = history;
  if (resume?.appendsUserTurn === false && resume.requestReplay !== undefined)
    writeRequestReplay(scope, resume.requestReplay);
  if (resume?.appendsUserTurn === false && resume.citations !== undefined) {
    scope.resultIdentities = resume.citations.claimVerification;
    scope.citationSources = resume.citations.citationSources;
  }
  return history;
}

/**
 * How many user turns the conversation already contains, this one included.
 * At least 1 — a run always IS a turn.
 */
function countUserTurns(history: readonly LLMMessage[]): number {
  let count = 0;
  for (const message of history) if (message.role === 'user') count++;
  return Math.max(1, count);
}

/** A stamp that counts as a turn: a positive whole number. */
const isTurn = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/**
 * WHICH TURN THIS IS, while an honesty layer is armed — the stamp every
 * ledger row of this turn carries (`findings/ledger.ts` · `recordFindings`)
 * and the one the answer's standing reads "this turn" by, so it must never
 * repeat in one conversation. `countUserTurns` cannot promise that on its
 * own: a window strategy or a compaction trims the stored history, and the
 * count of the user messages left repeats and goes backwards — an earlier
 * turn's verdict would then be folded as a later turn's.
 *
 * Two floors raise the count, each a lower bound of the true turn (the rule
 * `memory/turn/resolveTurnNumber.ts` applies to a store: whichever source
 * knows more wins, and none drags the conversation backwards):
 *   - the turn the stored history ENDS on (`AgentRunCheckpoint.turnNumber`):
 *     a continued conversation is the turn after it, a `resumeOnError` retry
 *     the same turn again;
 *   - the latest turn stamped on the restored ledger — for a conversation
 *     stored before the checkpoint carried its turn: a continued
 *     conversation comes after every stamped row, a retry at or after them.
 *
 * With neither — a fresh run, or no layer armed — the count, as always.
 */
export function turnNumberFor(
  history: readonly LLMMessage[],
  resume: PendingResumeHistory | undefined,
  ledger: FindingsLedger | undefined,
  stamped: boolean,
): number {
  const counted = countUserTurns(history);
  if (!stamped || resume === undefined) return counted;
  const next = resume.appendsUserTurn ? 1 : 0;
  let turn = counted;
  if (isTurn(resume.turn)) turn = Math.max(turn, resume.turn + next);
  for (const row of ledger ?? []) {
    const stamp = (row as { readonly turn?: unknown }).turn;
    if (isTurn(stamp)) turn = Math.max(turn, stamp + next);
  }
  return turn;
}

/** Start the numbered turn. */
export function seedConversationTurn(
  scope: TypedScope<AgentState>,
  history: readonly LLMMessage[],
  resume: PendingResumeHistory | undefined,
  ledger: FindingsLedger | undefined,
  stamped: boolean,
): number {
  const turn = turnNumberFor(history, resume, ledger, stamped);
  scope.turnNumber = turn;
  return turn;
}
