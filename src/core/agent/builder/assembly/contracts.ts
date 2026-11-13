import { type ResolvedAnswerValidation } from '../../../../answer-validation/index.js';
import { type OutputSchemaParser } from '../../../../answer-validation/outputSchema.js';
import { resolveJsonSchema } from '../../outputEnforcement.js';
import { negativeClaimsSchema, type ResolvedNegativeClaims } from '../../negativeClaims/config.js';
import type { ResolvedEvidenceGate } from '../../evidence/types.js';
import { type ResolvedOutputFallback } from '../../../outputFallback.js';
import { answerLayerFromOptions } from '../../assessment/answerLayerOptions.js';
import type { StandingLineWhen } from '../../assessment/compose.js';
import type { AgentOptions } from '../../types.js';
export interface ContractsPort {
  assertOutputFallbackCoherent(): void;
  negativeClaimsConfig?: ResolvedNegativeClaims;
  outputFallbackCfg?: ResolvedOutputFallback<unknown>;
  outputSchemaParser?: OutputSchemaParser<unknown>;
  limitsTravelValue: boolean;
  outputSchemaJson?: Readonly<Record<string, unknown>>;
  answerValidationConfig?: ResolvedAnswerValidation;
  claimsContract?: Readonly<Record<string, { entity: string; field: string }>>;
  evidenceGate?: ResolvedEvidenceGate;
  answerLayerValue?: { readonly standingLine?: StandingLineWhen };
  readonly opts: AgentOptions;
}

export function checkContracts(self: ContractsPort) {
  // Settings that are only coherent (or not) once the whole agent exists.
  self.assertOutputFallbackCoherent();
  const negativeClaims = self.negativeClaimsConfig;
  let negativeSchema: Readonly<Record<string, unknown>> | undefined;
  if (negativeClaims?.mode === 'prose' && self.outputFallbackCfg !== undefined) {
    throw new Error(
      'Agent.negativeClaims({ prose: true }) does not support .outputFallback(): a fallback runs after the observed answer.',
    );
  }
  if (negativeClaims?.mode === 'typed') {
    if (self.outputSchemaParser === undefined) {
      throw new Error('Agent.negativeClaims requires .outputSchema(parser, { jsonSchema }).');
    }
    if (self.outputFallbackCfg !== undefined || self.limitsTravelValue) {
      throw new Error(
        'Agent.negativeClaims does not support .outputFallback() or .limitsTravelWithTheAnswer(): the library must own the exact delivered answer.',
      );
    }
    negativeSchema = negativeClaimsSchema(
      negativeClaims,
      resolveJsonSchema(self.outputSchemaParser, self.outputSchemaJson),
    );
  }
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
  // The answer layer (honesty layer 4), resolved ONCE from both doors — the
  // builder's `.answerLayer()` wins; otherwise `AgentOptions.answerLayer`,
  // checked by the same rules — so the refusals below and the arm `Agent`
  // receives can never read two different values.
  const answerLayer =
    self.answerLayerValue ?? answerLayerFromOptions(self.opts.answerLayer as unknown);
  // The answer layer's line appends prose to the answer — refused where the
  // answer's bytes are judged or must parse. The standing itself still
  // travels as data on both (`turn_end.answerAssessment`).
  if (answerLayer?.standingLine !== undefined) {
    if (self.answerValidationConfig !== undefined) {
      throw new Error(
        'AgentBuilder.answerLayer({ standingLine: true }) cannot be combined with ' +
          '.answerValidation(): the answer checks judge the exact bytes delivered, and the line ' +
          'would change them. Keep .answerLayer() without the line — the standing still travels ' +
          'as data, on turn_end.answerAssessment and agentfootprint.answer.assessed.',
      );
    }
    if (self.outputSchemaParser !== undefined) {
      throw new Error(
        'AgentBuilder.answerLayer({ standingLine: true }) cannot be combined with ' +
          '.outputSchema(): a typed answer is JSON, and JSON followed by a line of prose is not. ' +
          'Keep .answerLayer() without the line — the standing still travels as data, on ' +
          'turn_end.answerAssessment and agentfootprint.answer.assessed.',
      );
    }
  }
  return { negativeClaims, negativeSchema, answerLayer };
}
