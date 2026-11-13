import type { ContextExportResult } from '../chartTypes.js';

/** Raise only the fresh, fixed refusal prepared by the attempt stage. */
export const refuseExport = (result: ContextExportResult) => (): never => {
  throw result.failure!;
};
