import type { TypedScope } from 'footprintjs';
import type { ContextExportResult, ContextExportState } from '../chartTypes.js';

/** The record stays in its private result cell; the chart keeps only counts. */
export const completeExport =
  (result: ContextExportResult) =>
  (scope: TypedScope<ContextExportState>): void => {
    scope.calls = result.record!.record.calls.length;
    scope.references = result.record!.record.referencePaths.length;
  };
