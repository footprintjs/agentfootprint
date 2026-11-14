import type { LLMMessage } from '../../../../provider-contract/types.js';
import type { AgentRunValues } from '../../runValues.js';
import { assertContinuable, type AgentRunCheckpoint } from '../../../runCheckpoint.js';
import { requireVerificationOnResume } from '../../findings/verificationCheckpoint.js';
import { negativeCheckpointOf } from '../../negativeClaims/checkpoint.js';
import { sourceEvidenceOf } from '../../sourceEvidence/checkpoint.js';

/**
 * Restore a stored conversation onto the side channel `seed` reads.
 *
 * THE one restoration path — `run({ continueFrom })` and `resumeOnError()`
 * both come through here, so the conversation door and the error door cannot
 * disagree about what continuing means. It checks the agent fingerprint,
 * restores history + folded spans, and adopts the conversation's identity so
 * the continued turn writes its memory where the earlier turns are.
 *
 * `appendsUserTurn` is the difference between the two callers, and it is the
 * whole difference. Continuing a conversation ADDS this turn's user message
 * to the stored history; resuming after an error does NOT, because there the
 * message is already the last user turn in that history and appending it
 * would ask the same question twice.
 *
 * Only the FLAG is stashed, never the entry (9.112.2). The entry is written
 * by `runtime/conversation/seedHistory.ts · historyForTurn` from the message the `'input'` middleware
 * chain let through; an entry built here, before that chain has run, is the
 * caller's raw text — which is what a continued turn served the model
 * through 9.112.1, while the record said the rewrite had happened.
 *
 * @internal
 */
export function applyLegacyContinuation(
  values: AgentRunValues,
  cp: AgentRunCheckpoint,
  door: string,
  appendsUserTurn: boolean,
  agentId: string | undefined,
  sourceEvidenceArmed: boolean,
  negativeClaimsArmed: boolean,
): void {
  assertContinuable(cp, agentId, door);
  requireVerificationOnResume(cp, false);
  const sourceEvidence = sourceEvidenceOf(cp);
  if (!sourceEvidenceArmed && sourceEvidence !== undefined)
    throw new TypeError(
      'Continuation requires the source evidence setting used by the recording agent.',
    );
  values.pendingResumeSourceEvidence = sourceEvidence;
  if (!negativeClaimsArmed && negativeCheckpointOf(cp) !== undefined)
    throw new TypeError(
      'Continuation requires the negative-claims setting used by the recording agent.',
    );
  values.pendingResumeHistory = {
    history: cp.history as readonly LLMMessage[],
    appendsUserTurn,
    // The turn the stored history ends on (honesty layers) — seed continues
    // the turn stamp from it only while a layer is armed.
    ...(cp.turnNumber !== undefined && { turn: cp.turnNumber }),
    ...(!negativeClaimsArmed ? {} : { negatives: negativeCheckpointOf(cp) }),
  };
  // The folded spans beside it. A conversation stored before 8.2 has none,
  // and `undefined` is the right answer there — it means "this conversation
  // recorded no folds", which is exactly true.
  values.pendingResumeFolded = cp.folded;
  // The findings ledger beside it (9.101.0). Stashed whether or not THIS
  // agent is armed: seed restores it only under `.findings()` (the deps
  // gate), and an unarmed continuation consumes and ignores it — exactly
  // like a `folded` field on an agent that never folds.
  values.pendingResumeFindingsLedger = cp.findingsLedger;
  // The conversation's skill cursor (SG-C). Stashed unconditionally —
  // whether it is HONORED is seed's `restoreSkillCursor` gate, which reads
  // the mounted graph's `continuity` declaration; a checkpoint written by a
  // continuity graph and continued on a `'turn'` one is consumed and
  // ignored, exactly like a `folded` field on an agent that never folds.
  values.pendingResumeSkillCursor = cp.skillCursor;
  // Same failed request retains its single repair budget. A new user turn
  // receives neither the rejected draft nor a spent retry allowance.
  values.pendingEvidenceRecovery =
    !appendsUserTurn && cp.evidenceRecovery !== undefined
      ? structuredClone(cp.evidenceRecovery)
      : undefined;
}
