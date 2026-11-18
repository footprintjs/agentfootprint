import {
  checkerGoverns,
  type PermissionChecker,
  type PermissionDecision,
  type PermissionCapability,
} from '../../../provider-contract/types.js';
import type { Tool } from '../../../tools/tools.js';
import type { SourceEvidencePreparationContext } from '../../../tools/sourceEvidence.js';
import type { SourceEvidenceCandidate } from '../../../artifacts/sourceEvidence/types.js';
import { untilAborted } from '../../../lib/abort.js';

export class SourceEvidencePolicyHalt extends Error {
  constructor() {
    super('Current policy halted retained source access.');
  }
}

/** One native permission judge; preparation has no invented iteration or tool call. */
export async function checkSourcePermission(
  checker: PermissionChecker | undefined,
  tool: Tool,
  candidate: SourceEvidenceCandidate,
  context: SourceEvidencePreparationContext & { readonly iteration?: number },
  observe?: (capability: PermissionCapability, decision: PermissionDecision) => void,
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
          ...(context.iteration !== undefined && { iteration: context.iteration }),
        }),
      ),
      context.signal,
    );
    observe?.(capability, decision);
    if (decision.result === 'halt') throw new SourceEvidencePolicyHalt();
    if (decision.result !== 'allow' && decision.result !== 'gate_open') return false;
  }
  return true;
}
