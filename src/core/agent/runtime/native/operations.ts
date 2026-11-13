import type { CombinedNarrativeEntry, ObserverDrainResult, RuntimeSnapshot } from 'footprintjs';
import type { RunnerExecution } from '../../../runnerExecution.js';
import type { AgentRunValues } from '../../runValues.js';
import type { AgentState } from '../../types.js';
import { eventBelongsToRun } from '../../../../bridge/eventMeta.js';
import type { AgentfootprintEvent } from '../../../../events/registry.js';
import type { AnswerAssessment, AssessmentDeclarations } from '../../assessment/types.js';
import type { AnswerNegatives } from '../../negativeClaims/delivery.js';
import type { AnswerCoverage } from '../../../../semantics/coverage/answer.js';
import type { AnswerValidationReport } from '../../../../answer-validation/index.js';
import { abandonPendingQuestion } from '../../pauseOwnership.js';

type ReadExecution = () => RunnerExecution<AgentRunValues>;

export function ownsEvent(
  execution: RunnerExecution<AgentRunValues>,
  event: AgentfootprintEvent,
): boolean {
  const selected = execution.selected();
  return selected !== undefined && eventBelongsToRun(event.meta, selected.context);
}

export function narrativeEntries(
  execution: RunnerExecution<AgentRunValues>,
): readonly CombinedNarrativeEntry[] {
  const selected = execution.selected();
  const coverage = selected?.value.redaction?.coverage;
  if (selected === undefined || coverage === undefined || coverage.state === 'unknown') return [];
  return selected.view.getNarrativeEntries();
}

export function drainObservers(
  execution: RunnerExecution<AgentRunValues>,
  opts?: { timeoutMs?: number },
): Promise<ObserverDrainResult> {
  const view = execution.view();
  if (view === undefined) return Promise.resolve({ done: 0, failed: 0, pending: 0 });
  return view.drainObservers(opts);
}

export function stoppedEarly(snapshot: RuntimeSnapshot | undefined): AgentState['stoppedEarly'] {
  const state = snapshot?.sharedState as Pick<AgentState, 'stoppedEarly'> | undefined;
  return state?.stoppedEarly;
}

export function outputContractUnmet(
  snapshot: RuntimeSnapshot | undefined,
): AgentState['outputContractUnmet'] {
  const state = snapshot?.sharedState as Pick<AgentState, 'outputContractUnmet'> | undefined;
  return state?.outputContractUnmet;
}

export function unsupportedValues(
  snapshot: RuntimeSnapshot | undefined,
): AgentState['unsupportedValues'] {
  const state = snapshot?.sharedState as Pick<AgentState, 'unsupportedValues'> | undefined;
  return state?.unsupportedValues;
}

export function findings(snapshot: RuntimeSnapshot | undefined): AgentState['findingsLedger'] {
  const ledger = (snapshot?.sharedState as Partial<AgentState> | undefined)?.findingsLedger;
  return ledger === undefined ? undefined : structuredClone(ledger);
}

export function answerNegatives(
  snapshot: RuntimeSnapshot | undefined,
): AnswerNegatives | undefined {
  const value = (snapshot?.sharedState as Partial<AgentState> | undefined)?.answerNegatives;
  return value === undefined ? undefined : structuredClone(value);
}

export function answerValidation(
  snapshot: RuntimeSnapshot | undefined,
): AnswerValidationReport | undefined {
  const report = (snapshot?.sharedState as Partial<AgentState> | undefined)?.answerValidation;
  return report === undefined ? undefined : structuredClone(report);
}

export function answerCoverage(snapshot: RuntimeSnapshot | undefined): AnswerCoverage | undefined {
  const limits = (snapshot?.sharedState as Partial<AgentState> | undefined)?.answerCoverage;
  return limits === undefined ? undefined : structuredClone(limits);
}

export async function assessment(
  readExecution: ReadExecution,
  declarations?: AssessmentDeclarations,
): Promise<AnswerAssessment | undefined> {
  const selected = readExecution().selected();
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

export async function abandonPause(
  readExecution: ReadExecution,
): Promise<
  | { readonly toolName?: string; readonly toolCallId?: string; readonly question?: string }
  | undefined
> {
  return readExecution().withRun((invocation) =>
    abandonPendingQuestion(invocation.previous?.value),
  );
}
