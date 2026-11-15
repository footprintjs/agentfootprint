import type { TypedScope } from 'footprintjs';
import { type PermissionChecker } from '../../../provider-contract/types.js';
import type { Tool, ToolExecutionContext } from '../../../tools/tools.js';
import type { SourceEvidenceCandidate } from '../../../artifacts/sourceEvidence/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentState } from '../types.js';

import { checkSourcePermission } from './permissionChecks.js';
export { SourceEvidencePolicyHalt } from './permissionChecks.js';

/** Metadata admission is not a replay of the original source's argument-dependent execution policy. */
export async function permitSourceEvidence(
  scope: TypedScope<AgentState>,
  checker: PermissionChecker | undefined,
  tool: Tool,
  candidate: SourceEvidenceCandidate,
  context: ToolExecutionContext,
  requester: string,
): Promise<boolean> {
  return checkSourcePermission(checker, tool, candidate, context, (capability, decision) => {
    typedEmit(scope, 'agentfootprint.permission.check', {
      capability,
      actor: 'agent',
      target: candidate.producer.name,
      result: decision.result,
    });
    if (decision.result === 'halt') {
      scope.policyHaltReason = decision.reason ?? decision.rationale ?? 'source-evidence-policy';
      scope.policyHaltTellLLM = decision.tellLLM ?? 'Current policy halted retained source access.';
      scope.policyHaltTarget = requester;
      scope.policyHaltArgs = { ref: candidate.ref };
      scope.policyHaltIteration = context.iteration;
      scope.policyHaltCheckerId = checker?.name;
    }
  });
}

/** The normal landing owner commits and terminates a halt, including remaining siblings. */
export function sourceEvidenceHaltOf(scope: TypedScope<AgentState>) {
  return scope.policyHaltReason === undefined
    ? undefined
    : {
        reason: scope.policyHaltReason,
        tellLLM: scope.policyHaltTellLLM ?? 'Current policy halted retained source access.',
        ...(scope.policyHaltCheckerId !== undefined && { checkerId: scope.policyHaltCheckerId }),
      };
}
