import type {
  OutputSchemaOptions,
  OutputSchemaParser,
  OutputSchemaStrategy,
} from '../../../../answer-validation/outputSchema.js';
import {
  resolveAnswerValidation,
  type AnswerValidationOptions,
  type ResolvedAnswerValidation,
} from '../../../../answer-validation/index.js';
import {
  resolveNegativeClaims,
  type NegativeClaimsOptions,
  type ResolvedNegativeClaims,
} from '../../negativeClaims/config.js';
import {
  resolveSourceEvidenceOptions,
  type SourceEvidenceOptions,
} from '../../../../tools/sourceEvidence.js';
import type { AgentOptions } from '../../types.js';

export type {
  AnswerValidationOptions,
  NegativeClaimsOptions,
  SourceEvidenceOptions,
  OutputSchemaOptions,
  OutputSchemaParser,
  OutputSchemaStrategy,
};

/** Single native policy mounts retain the facade's field reads and exact refusal order. */
export function setAnswerPolicy<T>(
  current: ResolvedAnswerValidation | undefined,
  options: AnswerValidationOptions<T>,
): ResolvedAnswerValidation {
  if (current !== undefined) throw new Error('AgentBuilder.answerValidation: already configured.');
  return resolveAnswerValidation(options);
}

export function setNegativePolicy(
  current: ResolvedNegativeClaims | undefined,
  options: NegativeClaimsOptions,
): ResolvedNegativeClaims {
  if (current !== undefined) throw new Error('Agent.negativeClaims: already configured.');
  return resolveNegativeClaims(options);
}

export function setSourceEvidence(
  current: SourceEvidenceOptions | undefined,
  options: SourceEvidenceOptions,
): SourceEvidenceOptions {
  if (current !== undefined) throw new Error('Agent.sourceEvidence: already configured.');
  return resolveSourceEvidenceOptions(options);
}

/** Unmounted construction passes the original options without enumerating them. */
export function sourceOptions(
  options: AgentOptions,
  sourceEvidence: SourceEvidenceOptions | undefined,
): AgentOptions {
  return sourceEvidence === undefined ? options : { ...options, sourceEvidence };
}

/** Read only the original receiver's policy fields at the existing build boundary. */
export interface AnswerContractPort {
  readonly answerValidationConfig?: ResolvedAnswerValidation;
  readonly outputSchemaParser?: OutputSchemaParser<unknown>;
  readonly outputFallbackCfg?: unknown;
  readonly limitsTravelValue: boolean;
  readonly claimsContract?: unknown;
  readonly evidenceGate?: unknown;
}

export function checkAnswerContract(
  self: AnswerContractPort,
  negativeClaims: ResolvedNegativeClaims | undefined,
): void {
  if (self.answerValidationConfig !== undefined) {
    if (self.outputSchemaParser === undefined) {
      throw new Error('AgentBuilder.answerValidation requires .outputSchema(parser).');
    }
    if (self.outputFallbackCfg !== undefined || self.limitsTravelValue) {
      throw new Error(
        'AgentBuilder.answerValidation does not support .outputFallback() or .limitsTravelWithTheAnswer(): a fallback can replace the checked answer after validation, and the validated delivery has no place for the declared limits.',
      );
    }
    // A listed check with nothing to judge is refused, never left to pass.
    const listed = self.answerValidationConfig.agentChecks;
    if (listed.includes('negative-claims') && negativeClaims?.mode !== 'typed') {
      throw new Error(
        "AgentBuilder.answerValidation({ agentChecks: ['negative-claims'] }) requires typed .negativeClaims({ field, tools }).",
      );
    }
    if (listed.includes('claims') && self.claimsContract === undefined) {
      throw new Error(
        "AgentBuilder.answerValidation({ agentChecks: ['claims'] }) needs a .claims() contract: " +
          'it names which answer field claims which fact, and without one the claim check has ' +
          "nothing to judge. Declare the contract, or drop 'claims' from agentChecks.",
      );
    }
    if (listed.includes('names-and-numbers') && self.evidenceGate === undefined) {
      throw new Error(
        "AgentBuilder.answerValidation({ agentChecks: ['names-and-numbers'] }) needs " +
          '.namesAndNumbersFromEvidence(): its verdict is what the row reads. Add the gate, or ' +
          "drop 'names-and-numbers' from agentChecks.",
      );
    }
  }
}
