import type { TypedScope } from 'footprintjs';
import { callOccurrenceField, type CallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import { retainedStateValue } from '../../../../../redaction/runRedaction.js';
import {
  executionClaimContext,
  sealExecutionClaimTurn,
} from '../../../scripts/executionEvidence.js';
import type { RouteBranch } from '../../../stages/route.js';
import type { AgentState } from '../../../types.js';
import { MAX_EXECUTION_CLAIM_PROSE_CHARS } from './check/bounds.js';
import { assessExecutionClaims, type ExecutionClaimAssessment } from './check/check.js';

type Scope = TypedScope<AgentState>;
type RouteDecider = (scope: Scope) => RouteBranch | Promise<RouteBranch>;

type Finding = ExecutionClaimAssessment['findings'][number];

export interface RecordedExecutionClaimAssessment extends ExecutionClaimAssessment {
  readonly findings: readonly (Finding & { readonly callOccurrenceKey?: CallOccurrenceKey })[];
}

/** Run the receipt check after Route has accepted the answer for delivery. */
export function withExecutionClaimAssessment(
  decide: RouteDecider,
  options: {
    readonly structured: boolean;
    readonly hasOutstandingConsent: () => boolean;
    readonly isHumanTurn?: () => boolean;
  },
): RouteDecider {
  function observe(scope: Scope, branch: RouteBranch): RouteBranch {
    if (branch !== 'final' || options.isHumanTurn?.() === false) return branch;
    const reply = options.structured ? undefined : scope.llmLatestContent;
    const couldClaimExecution =
      typeof reply === 'string' &&
      (reply.length > MAX_EXECUTION_CLAIM_PROSE_CHARS || /\bcode\b/iu.test(reply));
    if (!couldClaimExecution && !('codeExecutionReceipt' in scope)) return branch;
    if (
      scope.messageDeniedReason !== undefined ||
      scope.unsupportedValues?.refused === true ||
      scope.answerValidationBlocked === true ||
      scope.llmLatestStopReason === 'refusal' ||
      options.hasOutstandingConsent()
    )
      return branch;

    // A later prose question can refer to a completed structured turn's receipts.
    sealExecutionClaimTurn(scope);
    if (!couldClaimExecution) return branch;
    if (typeof reply !== 'string' || retainedStateValue(scope, 'llmLatestContent', reply) !== reply)
      return branch;

    const { occurrences, ...context } = executionClaimContext(scope);
    const assessment = assessExecutionClaims({ reply, ...context });
    if (assessment !== undefined) {
      scope.answerExecutionClaims = {
        ...assessment,
        findings: assessment.findings.map((finding) => {
          const provedByExit =
            (finding.claim === 'ran-code' && finding.outcome === 'verified') ||
            (finding.claim === 'no-code' && finding.outcome === 'contradicted');
          return provedByExit
            ? { ...finding, ...callOccurrenceField(occurrences[finding.target]) }
            : finding;
        }),
      };
    }
    return branch;
  }

  return (scope) => {
    const branch = decide(scope);
    return typeof branch === 'string'
      ? observe(scope, branch)
      : branch.then((next) => observe(scope, next));
  };
}
