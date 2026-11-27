import type { ClockRow, TimeReadingRow } from '../rows.js';
import type { TimeReader } from '../reader.js';
import { readEnglishTime } from '../readers/english.js';
import type { TimeCandidate } from '../resolve.js';
import { provenLookback } from './proof.js';
import { measuredLookbackOf } from './measuredLookback.js';

function measuredRuntime(): boolean {
  const versions = (globalThis as { process?: { versions?: Record<string, unknown> } }).process
    ?.versions;
  if (
    versions?.node !== provenLookback.runtime.node ||
    versions.tz !== provenLookback.runtime.tz ||
    versions.icu !== provenLookback.runtime.icu
  ) {
    return false;
  }
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return provenLookback.processZones.some(
    (timeZone) =>
      Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone === localZone,
  );
}

/** Fresh admission also requires the live built-in reader and a measured runtime. */
export function provenLookbackOf(
  reader: TimeReader,
  text: string,
  clock: ClockRow,
  rows: readonly TimeReadingRow[],
): TimeCandidate | undefined {
  if (reader.read !== readEnglishTime || !measuredRuntime()) return undefined;
  return measuredLookbackOf(text, clock, rows);
}
