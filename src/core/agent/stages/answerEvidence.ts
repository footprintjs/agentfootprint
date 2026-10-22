/**
 * answerEvidence — the evidence gate, bound to the evidence this run read,
 * handed within one Route stage from the gate (`route.ts` · `judgeEvidence`) to
 * answer validation (`answerValidation.ts` · `withAnswerValidation`), where
 * `agentChecks: ['names-and-numbers']` asks it of the EXACT candidate the
 * validation delivers.
 *
 * A JUDGE, never a verdict: the gate judged the model's draft, and an output
 * schema may transform that draft before delivery (1200 read, 9750 delivered).
 * A verdict computed on one form is never reused for another, so the row is
 * always the gate's answer about the bytes the person would receive.
 *
 * Keyed by the stage's own scope object — the per-invocation channel
 * `prepareFinal.ts` · `RAILS_REFUSED` uses: never committed state (the report
 * row is the record), never another stage's or another run's, and gone with the
 * scope. Read only when that Route stage answers `'final'`, so a draft sent back
 * for repair is never judged here, and a validation that finds no judge knows
 * the gate never ran on the answer it is about to deliver.
 */
import type { EvidenceJudge } from '../../../answer-validation/index.js';

const STANDING = new WeakMap<object, EvidenceJudge>();

/** File the gate, bound to this Route stage's evidence, for the validation to ask. */
export function noteAnswerEvidence(scope: object, judge: EvidenceJudge): void {
  STANDING.set(scope, judge);
}

/** The judge this Route stage's gate filed, or `undefined` when it judged nothing. */
export function answerEvidenceOf(scope: object): EvidenceJudge | undefined {
  return STANDING.get(scope);
}
