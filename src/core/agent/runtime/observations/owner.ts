import * as nativeOperations from '../native/operations.js';
import { refusalVerdictOf, validationVerdictOf } from '../terminal/verdicts.js';
import { type ObserverDrainResult } from 'footprintjs';
import type { AnswerAssessment, AssessmentDeclarations } from '../../assessment/types.js';
import { type ChildOutcome } from '../../../terminalVerdict.js';
import { isValidatedDelivery } from '../../stages/breakFinal.js';
import type { AgentState } from '../../types.js';
import type { AnswerNegatives } from '../../negativeClaims/delivery.js';
import type { AnswerCoverage } from '../../../../semantics/coverage/answer.js';
import { type AnswerValidationReport } from '../../../../answer-validation/index.js';
import type { AgentContext } from '../contracts.js';

export function drainObservers(
  this: Pick<AgentContext, 'native'>,
  opts?: { timeoutMs?: number },
): Promise<ObserverDrainResult> {
  return nativeOperations.drainObservers(this.native.runExecution(), opts);
}

export function stoppedEarly(this: Pick<AgentContext, 'native'>): AgentState['stoppedEarly'] {
  return nativeOperations.stoppedEarly(this.native.liveSnapshot());
}

export function outputContractUnmet(
  this: Pick<AgentContext, 'native'>,
): AgentState['outputContractUnmet'] {
  return nativeOperations.outputContractUnmet(this.native.liveSnapshot());
}

export function unsupportedValues(
  this: Pick<AgentContext, 'native'>,
): AgentState['unsupportedValues'] {
  return nativeOperations.unsupportedValues(this.native.liveSnapshot());
}

export function findings(this: Pick<AgentContext, 'native'>): AgentState['findingsLedger'] {
  return nativeOperations.findings(this.native.liveSnapshot());
}

export function answerNegatives(this: Pick<AgentContext, 'native'>): AnswerNegatives | undefined {
  return nativeOperations.answerNegatives(this.native.liveSnapshot());
}

export function answerValidation(
  this: Pick<AgentContext, 'native'>,
): AnswerValidationReport | undefined {
  return nativeOperations.answerValidation(this.native.liveSnapshot());
}

export function answerCoverage(this: Pick<AgentContext, 'native'>): AnswerCoverage | undefined {
  return nativeOperations.answerCoverage(this.native.liveSnapshot());
}

export function assessment(
  this: Pick<AgentContext, 'native'>,
  declarations?: AssessmentDeclarations,
): Promise<AnswerAssessment | undefined> {
  return nativeOperations.assessment(() => this.native.runExecution(), declarations);
}

export function outcomeOf(
  this: Pick<AgentContext, 'configuration'>,
  sfOutput: unknown,
): ChildOutcome {
  return classifyOutcome(sfOutput, () => this.configuration);
}

export function classifyOutcome(
  sfOutput: unknown,
  configurationOf: () => AgentContext['configuration'],
): ChildOutcome {
  if (typeof sfOutput === 'string') return { answer: sfOutput };
  if (isValidatedDelivery(sfOutput)) return { answer: sfOutput.finalContent };
  if (typeof sfOutput === 'object' && sfOutput !== null) {
    const state = sfOutput as Readonly<Record<string, unknown>>;
    const configuration = configurationOf();
    const verdict =
      refusalVerdictOf(state, {
        reliabilityConfig: configuration.reliabilityConfig,
        messageMiddleware: configuration.messageMiddleware,
        findingsOptions: configuration.findingsOptions,
        evidenceGate: configuration.evidenceGate,
      }) ?? validationVerdictOf(state, configuration.answerValidationConfig);
    if (verdict !== undefined) return { verdict };
  }
  return { answer: sfOutput };
}
