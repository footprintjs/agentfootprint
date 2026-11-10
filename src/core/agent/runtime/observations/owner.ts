import { refusalVerdictOf, validationVerdictOf } from '../terminal/verdicts.js';
import { type ObserverDrainResult } from 'footprintjs';
import { isPaused } from '../../../pause.js';
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
  const view = this.native.runExecution().view();
  if (view === undefined) return Promise.resolve({ done: 0, failed: 0, pending: 0 });
  return view.drainObservers(opts);
}

export function stoppedEarly(this: Pick<AgentContext, 'native'>): AgentState['stoppedEarly'] {
  const state = this.native.liveSnapshot()?.sharedState as
    | Pick<AgentState, 'stoppedEarly'>
    | undefined;
  return state?.stoppedEarly;
}

export function outputContractUnmet(
  this: Pick<AgentContext, 'native'>,
): AgentState['outputContractUnmet'] {
  const state = this.native.liveSnapshot()?.sharedState as
    | Pick<AgentState, 'outputContractUnmet'>
    | undefined;
  return state?.outputContractUnmet;
}

export function unsupportedValues(
  this: Pick<AgentContext, 'native'>,
): AgentState['unsupportedValues'] {
  const state = this.native.liveSnapshot()?.sharedState as
    | Pick<AgentState, 'unsupportedValues'>
    | undefined;
  return state?.unsupportedValues;
}

export function findings(this: Pick<AgentContext, 'native'>): AgentState['findingsLedger'] {
  const ledger = (this.native.liveSnapshot()?.sharedState as Partial<AgentState> | undefined)
    ?.findingsLedger;
  return ledger === undefined ? undefined : structuredClone(ledger);
}

export function answerNegatives(this: Pick<AgentContext, 'native'>): AnswerNegatives | undefined {
  const value = (this.native.liveSnapshot()?.sharedState as Partial<AgentState> | undefined)
    ?.answerNegatives;
  return value === undefined ? undefined : structuredClone(value);
}

export function answerValidation(
  this: Pick<AgentContext, 'native'>,
): AnswerValidationReport | undefined {
  const report = (this.native.liveSnapshot()?.sharedState as Partial<AgentState> | undefined)
    ?.answerValidation;
  return report === undefined ? undefined : structuredClone(report);
}

export function answerCoverage(this: Pick<AgentContext, 'native'>): AnswerCoverage | undefined {
  const limits = (this.native.liveSnapshot()?.sharedState as Partial<AgentState> | undefined)
    ?.answerCoverage;
  return limits === undefined ? undefined : structuredClone(limits);
}

export async function assessment(
  this: Pick<AgentContext, 'native'>,
  declarations?: AssessmentDeclarations,
): Promise<AnswerAssessment | undefined> {
  const selected = this.native.runExecution().selected();
  const snapshot = selected?.view.snapshot();
  if (snapshot === undefined) return undefined;
  // Settled before the fold, which cannot tell a crash from its committed state: an answer
  // this run RETURNED (`lastRunAnswer`, cleared at every run's start), or a pause — the fold
  // reads that one from the committed state itself. Read BEFORE the import resolves, so a
  // run started meanwhile cannot change which run is assessed.
  const paused = selected?.view.isPaused() === true;
  if (!paused && selected?.value.answer === undefined) return undefined;
  // Loaded on first use, off the default graph (the findings/peel.ts precedent).
  // The live state, read as values — never as a served record (`assess.ts` · `assessLive`).
  const { assessLive } = await import('../../assessment/assess.js');
  return assessLive(snapshot, declarations);
}

export function outcomeOf(
  this: Pick<AgentContext, 'configuration'>,
  sfOutput: unknown,
): ChildOutcome {
  if (typeof sfOutput === 'string') return { answer: sfOutput };
  if (isValidatedDelivery(sfOutput)) return { answer: sfOutput.finalContent };
  if (typeof sfOutput === 'object' && sfOutput !== null) {
    const state = sfOutput as Readonly<Record<string, unknown>>;
    const verdict =
      refusalVerdictOf(state, {
        reliabilityConfig: this.configuration.reliabilityConfig,
        messageMiddleware: this.configuration.messageMiddleware,
        findingsOptions: this.configuration.findingsOptions,
        evidenceGate: this.configuration.evidenceGate,
      }) ?? validationVerdictOf(state, this.configuration.answerValidationConfig);
    if (verdict !== undefined) return { verdict };
  }
  return { answer: sfOutput };
}
