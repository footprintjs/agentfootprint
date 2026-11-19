import { checkAnswerContract } from '../answer/policies.js';
import { type ResolvedAnswerValidation } from '../../../../answer-validation/index.js';
import { type OutputSchemaParser } from '../../../../answer-validation/outputSchema.js';
import { resolveJsonSchema } from '../../outputEnforcement.js';
import { negativeClaimsSchema, type ResolvedNegativeClaims } from '../../negativeClaims/config.js';
import type { ResolvedEvidenceGate } from '../../evidence/types.js';
import { type ResolvedOutputFallback } from '../../../outputFallback.js';
import {
  answerLayerFromOptions,
  type AnswerLayerArm,
} from '../../assessment/answerLayerOptions.js';
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
  answerLayerValue?: AnswerLayerArm | false;
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
  checkAnswerContract(self, negativeClaims);
  // The answer layer (honesty layer 4), resolved ONCE from both doors — the
  // builder's `.answerLayer()` wins; otherwise `AgentOptions.answerLayer`,
  // checked by the same rules — so the refusals below and the arm `Agent`
  // receives can never read two different values.
  const specified = self.answerLayerValue ?? answerLayerFromOptions(self.opts.answerLayer);
  // The answer layer's line appends prose to the answer — refused where the
  // answer's bytes are judged or must parse. The standing itself still
  // travels as data on both (`turn_end.answerAssessment`).
  if (specified && specified.standingLine !== undefined) {
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
  // Omission uses the existing selective mode. The default respects the
  // answer contract's exact bytes by serving only data on checked/typed answers.
  const defaultArm: AnswerLayerArm =
    self.answerValidationConfig !== undefined || self.outputSchemaParser !== undefined
      ? {}
      : { standingLine: 'not-sure-or-ask' };
  const answerLayer = specified ?? defaultArm;
  return { negativeClaims, negativeSchema, answerLayer };
}
