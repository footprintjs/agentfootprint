import type { FlowchartCheckpoint, RedactionPolicy } from 'footprintjs';
import {
  CarriedPolicyError,
  carriedVocabularyOf,
  policyFromCarried,
  policyOfMarks,
} from '../../../redaction/policy.js';
import { ResumeRedactionError } from '../../conversation.js';
import { withCurrentVocabulary } from '../../../redaction/conversation.js';

/**
 * The policy a paused agent run was covered by, read off its own checkpoint
 * (`AgentState.runRedaction`, committed by seed and by every resumed leg) —
 * FAIL CLOSED: a value this library did not write, or a checkpoint whose run
 * kept names out of its records (`redactionMarks`) but carries no policy,
 * refuses the resume (`ResumeRedactionError`) before anything moves. A leg its
 * policy could not keep covered must never start.
 */
export function resumeRedactionOf(
  checkpoint: FlowchartCheckpoint,
  trusted: readonly (RedactionPolicy | undefined)[],
): RedactionPolicy | undefined {
  const state = checkpoint.sharedState as { runRedaction?: unknown } | undefined;
  let carried: RedactionPolicy | undefined;
  try {
    // A carried pattern is a reference to one the resuming side holds — never
    // compiled from the checkpoint (`redaction/policy.ts` · `policyFromCarried`).
    carried = policyFromCarried(state?.runRedaction, 'Agent.resume', trusted);
    // A policy built under ANOTHER vocabulary version is joined with the
    // current list — the leg is never covered by an older list alone.
    carried = withCurrentVocabulary(carried, carriedVocabularyOf(state?.runRedaction));
  } catch (refusal) {
    throw new ResumeRedactionError(
      refusal instanceof CarriedPolicyError && refusal.refusal === 'unknown-pattern'
        ? 'unknown-pattern'
        : 'unreadable',
    );
  }
  // Every leg of a covered run writes its policy into its checkpoint's state
  // (seed, and `resume` for a resumed leg), so a checkpoint whose run kept
  // names out but carries none was altered — refused even when the resume
  // names a policy, which cannot stand in for the one the run was covered by.
  if (carried === undefined && policyOfMarks(checkpoint.redactionMarks) !== undefined) {
    throw new ResumeRedactionError('missing');
  }
  return carried;
}
