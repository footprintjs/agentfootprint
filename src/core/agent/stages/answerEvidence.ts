/**
 * answerEvidence — the evidence gate's verdict on the answer that STANDS,
 * handed within one Route stage from the gate (`route.ts` · `judgeEvidence`)
 * to answer validation (`answerValidation.ts` · `withAnswerValidation`), where
 * `agentChecks: ['names-and-numbers']` turns it into a report row.
 *
 * Keyed by the stage's own scope object — the per-invocation channel
 * `prepareFinal.ts` · `RAILS_REFUSED` uses: never committed state (the report
 * row is the record), never another stage's or another run's, and gone with the
 * scope. The gate notes every verdict; only a Route stage that answers
 * `'final'` reads it, so a draft sent back for repair (a stage that ends in
 * `'evidence-recheck'`) is never read, and a validation that finds no entry
 * knows the gate never judged the answer it is about to deliver.
 */
import type { EvidenceCheckInput } from '../../../answer-validation/index.js';

const STANDING = new WeakMap<object, EvidenceCheckInput>();

/** File the gate's verdict on the answer this Route stage is letting stand. */
export function noteAnswerEvidence(scope: object, verdict: EvidenceCheckInput): void {
  STANDING.set(scope, Object.freeze({ ...verdict }));
}

/** The verdict this Route stage's gate filed, or `undefined` when it judged nothing. */
export function answerEvidenceOf(scope: object): EvidenceCheckInput | undefined {
  return STANDING.get(scope);
}
