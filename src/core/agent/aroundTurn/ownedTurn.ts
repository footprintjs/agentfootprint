import type { AgentContext } from '../runtime/contracts.js';
import type { AgentRunValues } from '../runValues.js';
import type { AgentInput } from '../types.js';
import type { AgentRunOptions } from '../../Agent.js';
import { finishLeg, type RunnerInvocation } from '../../runnerExecution.js';
import { runInputWith, throughAroundTurn } from './funnel.js';
import { sourcePreparation } from '../sourceEvidence/preparation.js';

/** The funnel, for a new turn. Every top-level run enters here, inside its lease. */
export function runTurn<R>(
  this: Pick<AgentContext, 'configuration' | 'noteAroundTurnFailed' | 'runner'>,
  invocation: RunnerInvocation<AgentRunValues>,
  input: AgentInput | string,
  options: AgentRunOptions | undefined,
  leg: (turnInput: AgentInput | string) => Promise<R>,
): Promise<R> {
  const preparation =
    this.configuration.aroundTurnPort === undefined
      ? undefined
      : sourcePreparation(
          this.configuration,
          this.runner,
          input,
          options,
          invocation.value.pendingResumeSourceEvidence,
        );
  const operation = throughAroundTurn(
    this.configuration.aroundTurnPort,
    { kind: 'run', input, options, ...(preparation && { sourceEvidence: preparation.capability }) },
    (changes) => {
      preparation?.beforeProceed();
      return leg(runInputWith(input, options, changes));
    },
    (legFailed) => finishLeg(invocation.run, legFailed),
    (failure) => this.noteAroundTurnFailed(invocation, failure),
  );
  return preparation === undefined ? operation : operation.finally(preparation.close);
}
