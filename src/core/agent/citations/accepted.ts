import { BINDING_LIMITS } from '../../../integrity/claim-binding/scope.js';
import { sha256Hex } from '../../../lib/sha256.js';
import type { SubmittedCitationOffer } from '../../../provider-contract/citationResponse.js';
import type { assessCitedAnswer } from '../assessment/answer/citations/assessCitedAnswer.js';
import { MAX_CITATION_PROSE_CHARS } from '../assessment/answer/citations/bounds.js';

/** Bound history inspection at both citation boundaries. */
export const MAX_CITATION_HISTORY_ROWS = 4096;

export interface AcceptedCitationOffer {
  readonly submitted: SubmittedCitationOffer;
  readonly answerDigest: string;
}

export type AnswerCitationRecord = ReturnType<typeof assessCitedAnswer>;

/** The report projected under its writing stage's native recording rule. */
export interface RetainedCitationReport {
  readonly record: unknown;
}

/** Identity of exact text, including distinct escaped surrogate code units. */
export function citationTextDigest(text: string): string {
  return sha256Hex(JSON.stringify(text));
}

export function matchesCitationBody(text: unknown, bodyDigest: string): boolean {
  return (
    typeof text === 'string' &&
    text.length <= BINDING_LIMITS.resultBytes &&
    citationTextDigest(text) === bodyDigest
  );
}

export function acceptedAnswerDigest(text: string): string | undefined {
  return text.length <= MAX_CITATION_PROSE_CHARS ? citationTextDigest(text) : undefined;
}
