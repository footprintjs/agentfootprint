import type { TypedScope } from 'footprintjs';
import type { AgentRunValues } from '../../runValues.js';
import type { AgentState } from '../../types.js';
import { readLateRecordPoints } from '../stage.js';
import type { LateNoteRunValues, NoteChartState } from '../types.js';
import type { ToolRegistrations } from '../../stages/toolResolver.js';

/** Capture the actual call’s served record; only the native component bank holds the points. */
export function lateRecordRead(runValues: LateNoteRunValues, registrations: ToolRegistrations) {
  return (scope: TypedScope<AgentState>): void => {
    const values: AgentRunValues = runValues(scope);
    const iteration = scope.iteration ?? 1;
    values.lateRecordWork = { iteration, points: readLateRecordPoints(scope, registrations) };
  };
}

export function noteGatherStage(runValues: LateNoteRunValues) {
  return (scope: TypedScope<NoteChartState>): void => {
    scope.hasPoints = (runValues(scope).lateRecordWork?.points?.length ?? 0) > 0;
  };
}
