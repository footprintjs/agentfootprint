import type { TypedScope } from 'footprintjs';
import { checkerGoverns, type PermissionChecker } from '../../../provider-contract/types.js';
import type { Tool, ToolExecutionContext } from '../../../tools/tools.js';
import type { SourceEvidenceCandidate } from '../../../artifacts/sourceEvidence/types.js';
import { untilAborted } from '../../../lib/abort.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentState } from '../types.js';

export class SourceEvidencePolicyHalt extends Error {
  constructor() {
    super('Current policy halted retained source access.');
  }
}

/** Metadata admission is not a replay of the original source's argument-dependent execution policy. */
export async function permitSourceEvidence(
  scope: TypedScope<AgentState>,
  checker: PermissionChecker | undefined,
  tool: Tool,
  candidate: SourceEvidenceCandidate,
  context: ToolExecutionContext,
  requester: string,
): Promise<boolean> {
  if (!checker) return true;
  const capabilities = [
    'tool_call' as const,
    ...(tool.capabilities ?? []).filter((capability) => checkerGoverns(checker, capability)),
  ];
  for (const capability of capabilities) {
    const decision = await untilAborted(
      Promise.resolve(
        checker.check({
          capability,
          actor: 'agent',
          target: candidate.producer.name,
          context: {
            retainedSourceEvidence: {
              ref: candidate.ref,
              subject: candidate.subject,
              operation: candidate.operation,
              scope: candidate.scope,
            },
          },
          ...(context.identity !== undefined && { identity: context.identity }),
          ...(context.signal !== undefined && { signal: context.signal }),
          iteration: context.iteration,
        }),
      ),
      context.signal,
    );
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
      scope.policyHaltCheckerId = checker.name;
      throw new SourceEvidencePolicyHalt();
    }
    if (decision.result !== 'allow' && decision.result !== 'gate_open') return false;
  }
  return true;
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
