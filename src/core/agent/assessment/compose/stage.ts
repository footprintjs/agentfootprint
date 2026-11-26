import type { IntegrityReading } from '../integrityReasons.js';
import {
  assessmentValueOf,
  readReasonDetails,
  type RetainedReasonState,
} from '../reasonDetails.js';
import { reasonEntry } from '../reasons.js';
import type { AnswerAssessment, AssessmentReason } from '../types.js';
import type { WarningContext } from '../warningContext.js';

/** Finish the standing only after the fold knows whether it read withheld state. */
export function composeWarning(
  gathered: WarningContext,
  integrity: IntegrityReading,
  declarationAddresses: ReadonlyMap<number, number> | undefined,
  retain: RetainedReasonState,
  unusedTools: readonly string[],
): AnswerAssessment {
  const { asked, from, g, current, coverage, state, admission, results, historyCalls, begins } =
    gathered;
  if (asked.size > 0) {
    return {
      assessment: 'not-applicable',
      standing: 'not-assessed',
      reasons: [],
      checked: [],
      turnFrom: from,
      keptOut: [...asked].sort(),
    };
  }
  const detail = readReasonDetails(
    g,
    current,
    coverage,
    state,
    admission.settlements?.byKey,
    retain,
  );
  const { assessment, reasons } = assessmentValueOf(
    g,
    {
      state,
      turnResults: results,
      historyCalls,
      turnBegins: begins,
      declarationAddresses,
      failureCategories: detail.failureByHistory,
      declaredFailures: detail.declaredByHistory,
    },
    detail,
    unusedTools,
  );
  return {
    assessment,
    standing: standingOf(assessment, reasons),
    reasons,
    ...(assessment === 'known' && g.support !== undefined && { support: g.support }),
    checked: g.checked,
    turnFrom: from,
    ...(g.citations !== undefined && { citations: g.citations }),
    ...(integrity.notes.length > 0 && { notes: integrity.notes }),
  };
}

/** The owner's words for a value: ask > not sure > known > consistent > not assessed. */
function standingOf(
  assessment: AnswerAssessment['assessment'],
  reasons: readonly { readonly reason: AssessmentReason }[],
): AnswerAssessment['standing'] {
  switch (assessment) {
    case 'unknown':
      return reasons.some((r) => reasonEntry(r.reason).class === 'ask') ? 'ask' : 'not-sure';
    case 'known':
      return 'known';
    case 'unrefuted':
      return 'consistent';
    case 'not-applicable':
      return 'not-assessed';
  }
}
