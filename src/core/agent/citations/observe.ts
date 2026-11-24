import type { TypedScope } from 'footprintjs';
import { assessCitedAnswer } from '../assessment/answer/citations/assessCitedAnswer.js';
import type { RouteBranch } from '../stages/route.js';
import type { AgentState } from '../types.js';
import { acceptedAnswerDigest } from './accepted.js';
import type { ResolvedProseCitations } from './config.js';

function requestedColumn(scope: TypedScope<AgentState>, options: ResolvedProseCitations) {
  if (scope.userMessageFrom !== undefined || options.requestedColumn === undefined)
    return undefined;
  try {
    return options.requestedColumn(scope.userMessage);
  } catch {
    return undefined;
  }
}

/** Observe only the terminal prose after delivery gates have settled the Route decision. */
export function withCitationAssessment(
  decide: (scope: TypedScope<AgentState>) => RouteBranch | Promise<RouteBranch>,
  options: ResolvedProseCitations,
  hasOutstandingConsent: () => boolean,
) {
  return async (scope: TypedScope<AgentState>): Promise<RouteBranch> => {
    const branch = await decide(scope);
    if (
      branch !== 'final' ||
      scope.messageDeniedReason !== undefined ||
      scope.unsupportedValues?.refused === true ||
      scope.answerValidationBlocked === true ||
      hasOutstandingConsent()
    )
      return branch;
    const answer = scope.llmLatestContent;
    const recorded = scope.acceptedCitationOffer?.[0];
    const offer =
      recorded !== undefined && recorded.answerDigest === acceptedAnswerDigest(answer)
        ? recorded.submitted
        : undefined;
    const sources = scope.citationSources ?? [];
    scope.answerCitations = assessCitedAnswer({
      answer,
      offer,
      evidence: scope.resultIdentities?.evidence,
      rules: options.verification.rules,
      comparisonGroups: options.comparisonGroups,
      extractClaim: options.extractClaim,
      requestedColumn: requestedColumn(scope, options),
      visibleColumnsFor: (id) => sources.find((source) => source.resultId === id)?.completeColumns,
    });
    return branch;
  };
}
