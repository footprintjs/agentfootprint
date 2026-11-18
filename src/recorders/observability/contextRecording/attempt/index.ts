import type { TypedScope } from 'footprintjs';
import { contextRefusal, type ContextValueRecording } from '../types.js';
import type { ContextExportResult, ContextExportState } from '../chartTypes.js';

/** Capture only a fixed refusal on the chart; never the adapter's thrown value. */
export const attemptExport =
  (work: () => Promise<ContextValueRecording>, result: ContextExportResult) =>
  async (scope: TypedScope<ContextExportState>): Promise<void> => {
    try {
      result.record = await work();
      scope.refused = false;
    } catch (error) {
      result.failure = contextRefusal(error);
      scope.reason = result.failure.reason;
      scope.refused = true;
    }
  };
