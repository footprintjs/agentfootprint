import { flowChart } from 'footprintjs';
import type { ToolRegistrations } from '../stages/toolResolver.js';
import { noteComposeStage, noteSkipStage } from './compose/stage.js';
import { decideLateRecordNote } from './gate.js';
import { lateRecordRead, noteGatherStage } from './gather/stage.js';
import type { LateNoteRunValues, LateRecordNoteMount, NoteChartState } from './types.js';

/** The native component bank keeps text out of subflow input/output commits. */
export function buildLateRecordNoteMount(
  runValues: LateNoteRunValues,
  registrations: ToolRegistrations,
): LateRecordNoteMount {
  return {
    read: lateRecordRead(runValues, registrations),
    chart: flowChart<NoteChartState>(
      'GatherLateRecordPoints',
      noteGatherStage(runValues),
      'gather-late-record-points',
      { description: 'Gathers admitted and served record facts for the current request' },
    )
      .addDeciderFunction(
        'LateRecordNoteGate',
        decideLateRecordNote,
        'late-record-note-gate',
        'Compose a note only from admitted record facts',
      )
      .addFunctionBranch(
        'compose',
        'ComposeLateRecordNote',
        noteComposeStage(runValues),
        'Make one bounded and attributed request-only note',
      )
      .addFunctionBranch(
        'empty',
        'SkipLateRecordNote',
        noteSkipStage(runValues),
        'Leave this request without a record note',
      )
      .end()
      .build(),
  };
}
