import type { ContextRecordingError, ContextValueRecording } from './types.js';

/** Only refusal/counters enter the formatter's log; prompt data stays outside scope. */
export interface ContextExportState {
  refused: boolean;
  reason?: ContextRecordingError['reason'];
  calls?: number;
  references?: number;
}

export interface ContextExportResult {
  record?: ContextValueRecording;
  failure?: ContextRecordingError;
}
