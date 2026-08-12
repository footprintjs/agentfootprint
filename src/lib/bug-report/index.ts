/**
 * bug-report — package a run as the evidence for a bug report.
 *
 * `describeBugReport` measures and offers; `exportBugReport` bundles what the
 * reporter consented to, as named files and a real (stored) zip.
 * `githubBugReporter` — in `agentfootprint/observe` too — files that bundle.
 *
 * The zip writer is deliberately NOT exported: it exists for this bundle, it
 * stores rather than compresses, and a general-purpose zip writer is not a
 * promise this library wants to keep.
 */

export { describeBugReport, exportBugReport } from './build.js';
export type {
  BugReport,
  BugReportEnvironment,
  BugReportExcluded,
  BugReportFields,
  BugReportFile,
  BugReportFileSummary,
  BugReportInput,
  BugReportManifest,
  BugReportOversize,
  BugReportSource,
  BugReportUnit,
  DescribeBugReportOptions,
  ExportBugReportOptions,
} from './types.js';
export type { Transcript, TranscriptStep, TranscriptTurn } from './transcript.js';
