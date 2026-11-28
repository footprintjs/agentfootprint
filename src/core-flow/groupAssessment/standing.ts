import type { AnswerAssessmentPayload } from '../../events/payloads/answer.js';

type Standing = AnswerAssessmentPayload['standing'];
type Coverage = 'complete' | 'incomplete';

export interface MemberStanding {
  readonly standing?: Standing;
  readonly coverage: Coverage;
}

export interface GroupStanding {
  readonly standing: Standing;
  readonly coverage: Coverage;
}

const order: Readonly<Record<Standing, number>> = {
  known: 0,
  consistent: 1,
  'not-assessed': 2,
  'not-sure': 3,
  ask: 4,
};

/** Fold only admitted settlements. Witness selection and disclosure can omit examples independently. */
export function reduceGroupStanding(
  members: readonly MemberStanding[],
  hasScopeGap = false,
): GroupStanding {
  let standing: Standing = 'known';
  let incomplete = hasScopeGap || members.length === 0;
  for (const member of members) {
    const candidate = member.standing ?? 'not-assessed';
    incomplete ||= member.coverage === 'incomplete' || candidate === 'not-assessed';
    if (order[candidate] > order[standing]) standing = candidate;
  }
  if (incomplete && order[standing] < order['not-assessed']) standing = 'not-assessed';
  return { standing, coverage: incomplete ? 'incomplete' : 'complete' };
}
