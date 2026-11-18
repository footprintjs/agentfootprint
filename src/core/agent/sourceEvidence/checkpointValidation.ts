import type { AgentRunCheckpoint } from '../../runCheckpoint.js';
import type { ClaimVerificationState } from '../findings/verificationState.js';
import type { SourceEvidenceIndex } from '../../../artifacts/sourceEvidence/types.js';
import { readClaimVerificationRow } from '../findings/verificationRow.js';

/** Detach validated private carriers while preserving the legacy checkpoint identity. */
export function checkpointWithCarriers(
  c: Partial<AgentRunCheckpoint>,
  claimVerification: ClaimVerificationState | undefined,
  sourceEvidence: SourceEvidenceIndex | undefined,
): AgentRunCheckpoint {
  const hasVerificationRows = c.findingsLedger?.some((row) => row.kind === 'claim-verification');
  return claimVerification === undefined && !hasVerificationRows && sourceEvidence === undefined
    ? (c as AgentRunCheckpoint)
    : ({
        ...c,
        ...(claimVerification !== undefined && { claimVerification }),
        ...(sourceEvidence === undefined ? {} : { sourceEvidence }),
        ...(hasVerificationRows && {
          findingsLedger: c.findingsLedger?.map((row) =>
            row.kind === 'claim-verification' ? readClaimVerificationRow(row) : row,
          ),
        }),
      } as AgentRunCheckpoint);
}
