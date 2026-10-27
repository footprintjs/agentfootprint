import type { StoredCaptureHistory } from 'footprintjs/trace';
import type { RecordScope } from 'foottrace/cause';
import type { SourceCaptureStatus } from './causeCapture.js';

/** Policy over one public-reader-admitted history, not a second stored protocol validator. */
export function storedCauseSources(history: StoredCaptureHistory):
  | {
      readonly status: SourceCaptureStatus;
      readonly scope: NonNullable<RecordScope['readSources']>;
    }
  | 'source-ownership-unproven'
  | 'source-incomplete' {
  const sources = history.readSources;
  if (
    sources?.version !== 2 ||
    sources.ownership.version !== 1 ||
    sources.ownership.status !== 'captured' ||
    sources.ownership.limitations.length !== 0
  )
    return 'source-ownership-unproven';
  if (
    !sources.record ||
    sources.record.version !== 1 ||
    sources.record.segment !== 1 ||
    !['captured', 'partial', 'failed', 'unknown'].includes(sources.status)
  )
    return 'source-incomplete';
  return {
    status: sources.status as SourceCaptureStatus,
    scope: {
      record: sources.record,
      // Only independently collected native ownership authorizes bindings. No source row,
      // filename, receipt, guessed root namespace or fabricated attempt may supply them.
      executions: sources.ownership.executions.map(
        ({ runtimeStageId, stateAddress, attemptIds }) => ({
          runtimeStageId,
          stateAddress,
          attemptIds,
        }),
      ),
    },
  };
}
