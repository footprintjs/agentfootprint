import type { StoredRecordLimits } from 'foottrace';
import type { CaptureReason, SnapshotCapture } from './causeCapture.js';
import type { TraceCauseArtifacts } from './causeTypes.js';

/** Host-only options for one already authorized saved root; no model storage selector. */
export interface ReadStoredCauseOptions {
  readonly runId: string;
  /**
   * Structural producer-reader allowances: finite non-negative integers only.
   * Defaults: entries 16,384; missingCommits 4,096; drillDepth 64; addressLength 2,048.
   * Entry ceiling: 65,536. The other defaults are their ceilings; lower values, including zero, are allowed.
   * Requests above a ceiling are refused, never silently clamped.
   */
  readonly readerLimits?: StoredRecordLimits;
  /** Producer-reader evidence limit. Default 1 MiB; integer 1..8 MiB. */
  readonly maxBytes?: number;
  /** Checked before and after admission; cannot preempt a synchronous host iterator. */
  readonly signal?: AbortSignal;
}

/** Fixed failure vocabulary; private receipt data and exceptions are never returned. */
export type StoredCauseUnknown =
  | 'invalid-data'
  | 'reader-limit'
  | 'stored-admission'
  | 'native-capture'
  | 'projection-incomplete'
  | 'source-ownership-unproven'
  | 'source-incomplete'
  | 'cancelled'
  | 'unsupported'
  | 'unavailable';

/** Separate native observation and adapter acknowledgement; neither authenticates a producer. */
export interface StoredCauseAdmission {
  readonly native: {
    readonly status: 'admitted' | 'incomplete';
    readonly reason: CaptureReason;
    readonly version: 1 | 2;
    readonly scope: 'root-log';
    readonly persistence: 'memory-only';
  };
  readonly storage: {
    readonly status: 'adapter-acknowledged-history';
    readonly scope: 'root-log';
  };
  readonly readSources: SnapshotCapture['readSources'];
}

/** Factory-owned cause. This display assessment is not transferable serving authority. */
export interface StoredCauseArtifacts extends TraceCauseArtifacts {
  readonly admission: StoredCauseAdmission;
}

/** Unknown has no graph to query; ready does not promise a unique root. */
export type StoredCauseResult =
  | { readonly status: 'ready'; readonly cause: StoredCauseArtifacts }
  | { readonly status: 'unknown'; readonly reason: StoredCauseUnknown; readonly cause?: never };
