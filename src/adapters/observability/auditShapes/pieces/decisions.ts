import { ASSESSMENT_REASON_WORDS } from '../../assessmentReasonWords.js';
import type { Assertion } from '../../../../integrity/assertion/types.js';
import type { At, ItemOf, PayloadOf } from '../vocabulary.js';
import type { SkillGuardEvaluationRecord } from '../../../../events/payloads.js';
import {
  bool,
  charsMarker,
  listOf,
  num,
  oneOf,
  orList,
  shapeOf,
  str,
} from '../../auditBounding.js';
import { decisionSummary, declaredValue } from '../../auditKeptByContract.js';

/** The pause reason the library writes itself — its own words, kept. */
export const FIXED_PAUSE_REASON = 'stage requested pause';

/**
 * A skill guard's evaluation: the edge, the call, the verdict, and per
 * condition the key, operator and value the app DECLARED — and the engine's
 * summary of the value it read (`actualSummary`), the decision evidence the
 * chain keeps by contract (redaction-aware).
 */
export const boundGuard = shapeOf<SkillGuardEvaluationRecord>({
  from: str,
  to: str,
  toolName: str,
  toolCallId: str,
  verdict: bool,
  conditions: listOf(
    shapeOf<SkillGuardEvaluationRecord['conditions'][number]>({
      key: str,
      op: str,
      value: orList(declaredValue),
      // The engine's decision evidence: a summary of the value a guard read.
      actualSummary: decisionSummary,
      passed: bool,
    }),
  ),
});

/** What an integrity finding is about: a kind and an id. */
export const boundSubject = shapeOf<Assertion['subject']>({ kind: str, id: str });

/** What a message said that won a routing match: the text is the person's; the
 *  keyword is the app's declared vocabulary. */
export const boundWitness = shapeOf<{ readonly text: string; readonly keyword?: string }>({
  text: charsMarker,
  keyword: str,
});

/** Why a turn's answer stands where it does — the assessment's own words. */
export const boundAssessmentReasons = listOf(oneOf(...ASSESSMENT_REASON_WORDS));

/** Which honesty checks ran, and over how much. */
export const boundAssessmentChecks = listOf(
  shapeOf<ItemOf<PayloadOf<'agentfootprint.answer.assessed'>['checked']>>({
    layer: oneOf(1, 2, 3, 4),
    check: oneOf(
      'answer-checks',
      'argument-rules',
      'argument-sources',
      'names-and-numbers',
      'result-period',
      'result-shape',
      'script-match',
      'tool-coverage',
    ),
    ran: num,
    of: num,
  }),
);

/** A turn's answer assessment: verdict words, reason codes and check counts. */
export const boundAnswerAssessment = shapeOf<
  At<PayloadOf<'agentfootprint.agent.turn_end'>, 'answerAssessment'>
>({
  assessment: oneOf('known', 'not-applicable', 'unknown', 'unrefuted'),
  standing: oneOf('ask', 'consistent', 'known', 'not-assessed', 'not-sure'),
  reasons: boundAssessmentReasons,
  checked: boundAssessmentChecks,
});

/** One context source's share of a slot: characters and pieces. */
export const boundSourceShare = shapeOf<
  NonNullable<PayloadOf<'agentfootprint.context.slot_composed'>['sourceBreakdown']['rag']>
>({ chars: num, count: num });

/** A slot's share by context source — every source the library declares, by name. */
export const boundSourceBreakdown = shapeOf<
  PayloadOf<'agentfootprint.context.slot_composed'>['sourceBreakdown']
>({
  assistant: boundSourceShare,
  base: boundSourceShare,
  custom: boundSourceShare,
  'evidence-recovery': boundSourceShare,
  fact: boundSourceShare,
  findings: boundSourceShare,
  instructions: boundSourceShare,
  memory: boundSourceShare,
  ontology: boundSourceShare,
  rag: boundSourceShare,
  registry: boundSourceShare,
  skill: boundSourceShare,
  steering: boundSourceShare,
  'tool-result': boundSourceShare,
  user: boundSourceShare,
});
