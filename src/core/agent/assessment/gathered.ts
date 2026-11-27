import type { AnswerAssessment, AssessmentPointer, AssessmentReason } from './types.js';

/** One check whose verdict the record holds. */
type CheckRan = AnswerAssessment['checked'][number];

/** What the steps gather as they read: the reasons with their rows, the checks that ran, the support. */
export interface Gathered {
  readonly admit: (reason: AssessmentReason, witness: AssessmentPointer) => boolean;
  readonly fired: Map<AssessmentReason, AssessmentPointer[]>;
  readonly checked: CheckRan[];
  support?: AnswerAssessment['support'];
  citations?: AnswerAssessment['citations'];
}

export function fire(g: Gathered, reason: AssessmentReason, witness: AssessmentPointer): boolean {
  if (!g.admit(reason, witness)) return false;
  const list = g.fired.get(reason) ?? [];
  list.push(witness);
  g.fired.set(reason, list);
  return true;
}
