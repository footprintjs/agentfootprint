/**
 * runbook — the standard bridge from a footprintjs procedure to an Agent
 * tool with the mandatory honesty spine. See README.md in this folder.
 */

export { runbookAsTool } from './runbookAsTool.js';
export {
  absenceSignalOf,
  probeDispatch,
  recordingDispatch,
  RunbookAbsenceSignal,
  type InnerCallRecord,
  type RecordedDispatch,
} from './dispatch.js';
export {
  DECLINED_VERDICT,
  DEFAULT_MAX_ROWS,
  renderVerdictTable,
  VERDICT_RENDER_NOTE,
  verdictRowsOf,
} from './verdicts.js';
export { DEFAULT_WALK_CAP, projectWalk, type ProjectedWalk, type WalkRow } from './walk.js';
export type {
  RunbookAsToolOptions,
  RunbookEnvelope,
  RunbookProcedure,
  RunbookRules,
  RunbookVerdictsOptions,
  RunbookWalkOptions,
  VerdictRow,
  WalkDescriptor,
} from './types.js';
