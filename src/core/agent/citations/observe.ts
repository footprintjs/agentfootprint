import type { TypedScope } from 'footprintjs';
import { retainedStateValue } from '../../../redaction/runRedaction.js';
import { assessCitedAnswer } from '../assessment/answer/citations/assessCitedAnswer.js';
import type { RouteBranch } from '../stages/route.js';
import type { AgentState } from '../types.js';
import { citationRecordForWarning } from '../assessment/answer/citations/record.js';
import { acceptedAnswerDigest, type RetainedCitationReport } from './accepted.js';
import { visibleColumnsForCitedResult } from './columns.js';
import type { ResolvedProseCitations } from './config.js';

function requestedColumn(scope: TypedScope<AgentState>, options: ResolvedProseCitations) {
  if (scope.userMessageFrom !== undefined || options.requestedColumn === undefined)
    return undefined;
  try {
    const message = scope.userMessage;
    return retainedStateValue(scope, 'userMessage', message) === message
      ? options.requestedColumn(message)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Observe only the terminal prose after delivery gates have settled the Route decision. */
export function withCitationAssessment(
  decide: (scope: TypedScope<AgentState>) => RouteBranch | Promise<RouteBranch>,
  options: ResolvedProseCitations,
  hasOutstandingConsent: () => boolean,
  retainForFinal?: (report: RetainedCitationReport) => void,
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
    const evidence = scope.resultIdentities?.evidence;
    const report = assessCitedAnswer({
      answer,
      offer,
      evidence,
      rules: options.verification.rules,
      comparisonGroups: options.comparisonGroups,
      extractClaim: options.extractClaim,
      requestedColumn: requestedColumn(scope, options),
      visibleColumnsFor: (id) => visibleColumnsForCitedResult(scope, sources, offer, evidence, id),
    });
    scope.answerCitations = report;
    if (retainForFinal !== undefined) {
      retainForFinal({
        record: citationRecordForWarning(
          report,
          retainedStateValue(scope, 'answerCitations', report),
        ),
      });
    }
    return branch;
  };
}
