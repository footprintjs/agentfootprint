import { decide, type TypedScope } from 'footprintjs';
import type { ContextExportState } from '../chartTypes.js';

/** The formatter's only control choice, recorded against its refusal fact. */
export const decideExport = (scope: TypedScope<ContextExportState>) =>
  decide(
    scope,
    [{ when: (s) => s.refused, then: 'refuse', label: 'the record could not be completed' }],
    'complete',
  );
