import { resolveEvidenceGate } from '../../evidence/gate.js';
import type { NamesAndNumbersOptions, ResolvedEvidenceGate } from '../../evidence/types.js';

export interface EvidencePort {
  evidenceGate?: ResolvedEvidenceGate;
}

export function configureEvidence<TReceiver extends EvidencePort>(
  self: TReceiver,
  opts: NamesAndNumbersOptions | undefined,
  original: object,
): object {
  if (self.evidenceGate) {
    throw new Error(
      'AgentBuilder.namesAndNumbersFromEvidence: already set. Each agent has at most one ' +
        'evidence gate — pass every shape and exemption in the one call.',
    );
  }
  // Resolved (and refused) HERE rather than at build: a posture typo is a
  // mistake in the line you just wrote, and the stack should say so.
  self.evidenceGate = resolveEvidenceGate(opts);
  return original;
}
