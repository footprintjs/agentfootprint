import { buildEventMeta, type RunContext, type TurnEventMeta } from '../bridge/eventMeta.js';
import type { EventDispatcher } from '../events/dispatcher.js';
import type { AgentfootprintEvent } from '../events/registry.js';
import type { EventServing } from './served.js';

const mountedTurnEvents = new Set([
  'agentfootprint.agent.turn_start',
  'agentfootprint.agent.turn_end',
  'agentfootprint.stream.llm_start',
  'agentfootprint.stream.llm_end',
  'agentfootprint.stream.token',
]);
const rootTurnMeta = { rootTurn: true } as const;
const mountedTurnMeta = { mountedTurn: true } as const;

/** The real event relay and late served emitters of one native execution leg. */
export function createRunEventRelay(
  dispatcher: EventDispatcher,
  serving: EventServing,
  getRunContext: () => RunContext,
) {
  // Native $emit carries only name and payload. The stage id pairs the mark
  // captured at emission with its served twin, including deferred delivery.
  let rootTurnEndStage: string | undefined;
  let mountedTurnStages: Set<string> | undefined;
  const turnMetaAt = (type: string, runtimeStageId: string): TurnEventMeta | undefined => {
    if (type === 'agentfootprint.agent.turn_end' && runtimeStageId === rootTurnEndStage) {
      return rootTurnMeta;
    }
    if (mountedTurnStages?.has(runtimeStageId) && mountedTurnEvents.has(type)) {
      return mountedTurnMeta;
    }
    return undefined;
  };

  return {
    turnMetaAt,
    trackMountedTurns(): void {
      mountedTurnStages ??= new Set();
    },
    markRootTurnEnd(stageId: string): void {
      if (stageId !== '') rootTurnEndStage = stageId;
    },
    markMountedTurn(type: string, stageId: string): void {
      if (mountedTurnStages !== undefined && stageId !== '' && mountedTurnEvents.has(type)) {
        mountedTurnStages.add(stageId);
      }
    },
    real(type: string, payload: unknown, stageId: string): void {
      if (!dispatcher.hasRealListeners()) return;
      // The stage's position, as the bridge stamps it on the served twin
      // (`buildEventMeta`); only footprintjs's `sourcePosition` is the bridge's alone.
      const origin =
        stageId !== '' ? { runtimeStageId: stageId, ...turnMetaAt(type, stageId) } : undefined;
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
