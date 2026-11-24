import { decide, type TypedScope } from 'footprintjs';
import type { NoteChartState } from './types.js';

export function decideLateRecordNote(scope: TypedScope<NoteChartState>) {
  return decide(
    scope,
    [
      {
        when: { hasPoints: { eq: true } },
        then: 'compose',
        label: 'The record has an admitted point',
      },
    ],
    { branch: 'empty', label: 'The record provides no admitted point for this note' },
  );
}
