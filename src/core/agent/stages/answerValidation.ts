import type { TypedScope } from 'footprintjs';
import {
  executeAnswerValidation,
  type ResolvedAnswerValidation,
  type AnswerValidationReport,
} from '../../../answer-validation/index.js';
import type { ArtifactStore } from '../../../artifacts/types.js';
import type { OutputSchemaParser } from '../../outputSchema.js';
import type { AgentState } from '../types.js';
import type { RouteBranch } from './route.js';

/** Wrap only the configured agent's terminal decision, in the outer scope.
 * The final branch can consume the verdict, while snapshots retain its owner.
 * A refusal stops before conversation capture and memory writes. */
export function withAnswerValidation(
  decide: (scope: TypedScope<AgentState>) => RouteBranch | Promise<RouteBranch>,
  config: ResolvedAnswerValidation,
  parser: OutputSchemaParser<unknown> | undefined,
  store: ArtifactStore | undefined,
  hasOutstandingConsent: () => boolean,
): (scope: TypedScope<AgentState>) => Promise<RouteBranch> {
  if (parser === undefined) {
    throw new Error('Agent.answerValidation requires .outputSchema(parser).');
  }
  return async (scope) => {
    const branch = await decide(scope);
    if (branch !== 'final') return branch;
    const priorRefusal =
      scope.messageDeniedReason !== undefined ||
      scope.unsupportedValues?.refused === true ||
      hasOutstandingConsent();
    if (priorRefusal) {
      const report: AnswerValidationReport = {
        validatorId: config.id,
        validatorVersion: config.version,
        mode: config.mode,
        status: 'unverified',
        checked: 0,
        failed: 0,
        unreachable: 0,
        notApplicable: 0,
        checks: [],
        resolvedRefs: [],
        schemaAccepted: false,
        reason: 'prior-refusal',
      };
      scope.answerValidation = report;
      scope.answerValidationBlocked = true;
      scope.$break();
      return 'final';
    }
    const identity = scope.runIdentity;
    const result = await executeAnswerValidation(
      scope.llmLatestContent,
      parser,
      config,
      store,
      {
        conversationId: identity.conversationId,
        ...(identity.tenant !== undefined && { tenant: identity.tenant }),
        ...(identity.principal !== undefined && { principal: identity.principal }),
      },
      scope.$getEnv().signal,
    );
    scope.answerValidation = result.report;
    if (config.mode === 'enforce' && result.report.status !== 'passed') {
      scope.answerValidationBlocked = true;
      scope.$break();
    } else {
      scope.llmLatestContent = result.content ?? scope.llmLatestContent;
    }
    return 'final';
  };
}
