/** The compatible Agent's admitted run funnel and optional preparation lease. */
import type { AgentRunOptions } from '../../Agent.js';
import type { AgentRunValues } from '../runValues.js';
import type { AgentInput } from '../types.js';
import type { AgentAroundTurnFailedPayload } from '../../../events/payloads/agent.js';
import { finishLeg, type RunnerInvocation } from '../../runnerExecution.js';
import type { SourcePreparationConfiguration } from '../sourceEvidence/preparationConfiguration.js';
import { sourcePreparation } from '../sourceEvidence/preparation.js';
import { runInputWith, throughAroundTurn } from './funnel.js';
import type { AroundTurn, ResumeTurn } from './types.js';
import { buildEventMeta } from '../../../bridge/eventMeta.js';
import { AROUND_TURN_STAGE_ID } from '../run/eventStageIds.js';

interface PreparedRunOwner extends SourcePreparationConfiguration {
  readonly aroundTurnPort?: AroundTurn;
  readonly runner: object;
  readonly report: (failure: AgentAroundTurnFailedPayload) => void;
}

export function runTurn<R>(
  { runner, report, ...configuration }: PreparedRunOwner,
  invocation: RunnerInvocation<AgentRunValues>,
  input: AgentInput | string,
  options: AgentRunOptions | undefined,
  leg: (turnInput: AgentInput | string) => Promise<R>,
): Promise<R> {
  const preparation =
    configuration.aroundTurnPort === undefined ||
    configuration.sourceEvidenceConfig?.preparation === undefined
      ? undefined
      : sourcePreparation(
          configuration,
          runner,
          input,
          options,
          invocation.value.pendingResumeSourceEvidence,
        );
  const operation = throughAroundTurn(
    configuration.aroundTurnPort,
    { kind: 'run', input, options, ...(preparation && { sourceEvidence: preparation.capability }) },
    (changes) => {
      preparation?.beforeProceed();
      return leg(runInputWith(input, options, changes));
    },
    (legFailed) => finishLeg(invocation.run, legFailed),
    report,
  );
  return preparation === undefined ? operation : operation.finally(preparation.close);
}

/** A wrapper failed after its run: the outcome stands, and the record says so. */
export function failureEvent(
  invocation: RunnerInvocation<AgentRunValues>,
  payload: AgentAroundTurnFailedPayload,
  minimalMeta: () => import('../../../events/types.js').EventMeta,
): import('../../../events/registry.js').AgentfootprintEventMap['agentfootprint.agent.around_turn_failed'] {
  const meta = { runtimeStageId: AROUND_TURN_STAGE_ID };
  return {
    type: 'agentfootprint.agent.around_turn_failed',
    payload,
    meta:
      invocation.run.origin === undefined
        ? { ...minimalMeta(), ...meta }
        : buildEventMeta(meta, invocation.context()),
  };
}

/** The existing answered-pause funnel shares the same captured finalizer. */
export function resumeTurn<R>(
  port: AroundTurn | undefined,
  turn: ResumeTurn,
  invocation: RunnerInvocation<AgentRunValues>,
  leg: () => Promise<R>,
  report: (failure: AgentAroundTurnFailedPayload) => void,
): Promise<R> {
  return throughAroundTurn(port, turn, leg, (failed) => finishLeg(invocation.run, failed), report);
}
