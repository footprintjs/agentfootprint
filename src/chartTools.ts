/** Public chart-backed tools share one bounded, re-export-only family. */
export {
  flowchartAsTool,
  type FlowchartAsToolOptions,
  type FlowchartResultMapper,
  type FlowchartToolSnapshot,
} from './core/flowchartAsTool.js';
// runbookAsTool (9.76.0) — the STANDARD bridge from a footprintjs procedure
// to an Agent tool: every answer is the mandatory honesty spine (coverage
// with inner-tool ledgers folded upward, provenance first, rule name+version,
// the recorded walk as a `recording/chart-walk` artifact ticket) plus an
// optional verdict/rowset projection selected by `resultKind: 'verdict/*'`.
// `flowchartAsTool` stays for compatibility (its `resultMapper` users stay
// put); new procedures start here.
export {
  absenceSignalOf,
  DECLINED_VERDICT,
  DEFAULT_MAX_ROWS,
  // The chart-recording ceiling (9.79.0) — `walk: { recording: true }` files
  // the inner chart's own `{ snapshot, events, structure }` beside the walk,
  // and a bundle over this many bytes is REFUSED (never truncated) with the
  // reason stated on `walk.recording_note`.
  DEFAULT_RECORDING_MAX_BYTES,
  DEFAULT_WALK_CAP,
  PANEL_RENDER_NOTE,
  probeDispatch,
  projectWalk,
  recordingDispatch,
  renderVerdictTable,
  runbookAsTool,
  RunbookAbsenceSignal,
  VERDICT_RENDER_NOTE,
  verdictRowsOf,
  type InnerCallRecord,
  type ProjectedWalk,
  type RecordedDispatch,
  type RunbookAsToolOptions,
  type RunbookEnvelope,
  type RunbookPresentation,
  type RunbookProcedure,
  type RunbookRecordingOptions,
  type RunbookRules,
  type RunbookVerdictsOptions,
  type RunbookWalkOptions,
  type VerdictRow,
  type WalkDescriptor,
  type WalkRow,
} from './core/runbook/index.js';
export type { ChartToolObservability } from './core/chartToolObservability.js';
