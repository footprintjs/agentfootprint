import type { LateNoteRunValues } from '../types.js';
import { renderLateRecordNote } from './render.js';

export function noteComposeStage(runValues: LateNoteRunValues) {
  return (scope: object): void => {
    const values = runValues(scope);
    const work = values.lateRecordWork;
    if (work === undefined) return;
    const note = renderLateRecordNote(work.points ?? []);
    values.lateRecordWork = { iteration: work.iteration, note };
  };
}

export function noteSkipStage(runValues: LateNoteRunValues) {
  return (scope: object): void => {
    delete runValues(scope).lateRecordWork;
  };
}
