import type { FlowchartCheckpoint, RedactionPolicy } from 'footprintjs';
import {
  CarriedPolicyError,
  carriedVocabularyOf,
  policyFromCarried,
  policyOfMarks,
  unionRedactionPolicies,
} from '../../../redaction/policy.js';
import {
  callerOfCheckpoint,
  nonPrivateMarksOf,
  privateFieldsOfCheckpoint,
  resumePoliciesOf,
} from '../../../redaction/privateCheckpoint.js';
import { ResumeRedactionError } from '../../conversation.js';
import { withCurrentVocabulary } from '../../../redaction/conversation.js';

/** Admit the saved caller policy or the explicit closed private-only declaration. */
export function resumeRedactionOf(
  checkpoint: FlowchartCheckpoint,
  trusted: readonly (RedactionPolicy | undefined)[],
): RedactionPolicy | undefined {
  let carried: RedactionPolicy | undefined;
  let callerNone = false;
  let marked = false;
  try {
    const declaration = callerOfCheckpoint(checkpoint);
    callerNone = declaration.state === 'none';
    const value = declaration.state === 'policy' ? declaration.value : undefined;
    carried = policyFromCarried(value, 'Agent.resume', trusted);
    carried = withCurrentVocabulary(carried, carriedVocabularyOf(value));
    marked =
      privateFieldsOfCheckpoint(checkpoint) !== undefined ||
      policyOfMarks(nonPrivateMarksOf(checkpoint)) !== undefined;
  } catch (refusal) {
    throw new ResumeRedactionError(
      refusal instanceof CarriedPolicyError && refusal.refusal === 'unknown-pattern'
        ? 'unknown-pattern'
        : 'unreadable',
    );
  }
  // Carrier presence describes private selectors. It never proves caller:none.
  // A policy supplied now cannot stand in for the policy the earlier leg carried.
  if (carried === undefined && !callerNone && marked) throw new ResumeRedactionError('missing');
  return carried;
}

/** Every runner admits the saved caller declaration before serving or executing a resumed leg. */
export function resumePoliciesForRunner(
  checkpoint: FlowchartCheckpoint,
  handedDown: RedactionPolicy | undefined,
  declared: RedactionPolicy | undefined,
): ReturnType<typeof resumePoliciesOf> {
  const carried = resumeRedactionOf(checkpoint, [declared, handedDown]);
  return resumePoliciesOf(checkpoint, unionRedactionPolicies(carried, handedDown), declared);
}
