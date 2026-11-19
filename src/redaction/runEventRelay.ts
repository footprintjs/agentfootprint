import { buildEventMeta, type RunContext } from '../bridge/eventMeta.js';
import type { EventDispatcher } from '../events/dispatcher.js';
import type { AgentfootprintEvent } from '../events/registry.js';
import type { EventServing } from './served.js';

/** The real event relay and late served emitters of one native execution leg. */
export function createRunEventRelay(
  dispatcher: EventDispatcher,
  serving: EventServing,
  getRunContext: () => RunContext,
) {
  // Native $emit carries only name and payload. The stage id pairs the bit
  // marked at the capture with its served emit, including deferred delivery.
  let rootTurnEndStage: string | undefined;
  const rootTurnAt = (type: string, runtimeStageId: string): true | undefined =>
    type === 'agentfootprint.agent.turn_end' && runtimeStageId === rootTurnEndStage
      ? true
      : undefined;

  return {
    rootTurnAt,
    markRootTurnEnd(stageId: string): void {
      if (stageId !== '') rootTurnEndStage = stageId;
    },
    real(type: string, payload: unknown, stageId: string): void {
      if (!dispatcher.hasRealListeners()) return;
      // The stage's position, as the bridge stamps it on the served twin
      // (`buildEventMeta`); only footprintjs's `sourcePosition` is the bridge's alone.
      const origin =
        stageId !== ''
          ? { runtimeStageId: stageId, rootTurn: rootTurnAt(type, stageId) }
          : undefined;
      dispatcher.deliverReal({
        type,
        payload,
        meta: buildEventMeta(origin, getRunContext()),
      } as unknown as AgentfootprintEvent);
    },
    captureLate(stageId: string): (type: string, payload: unknown) => void {
      return lateEmitter(dispatcher, serving, Object.freeze({ ...getRunContext() }), stageId);
    },
  };
}

/** The returned closure has no shared activation with a run-context reader. */
function lateEmitter(
  dispatcher: EventDispatcher,
  serving: EventServing,
  context: RunContext,
  stageId: string,
): (type: string, payload: unknown) => void {
  return (type, payload) =>
    dispatcher.dispatchForRun(
      {
        type,
        payload,
        meta: buildEventMeta({ runtimeStageId: stageId }, context),
      } as unknown as AgentfootprintEvent,
      serving,
    );
}
