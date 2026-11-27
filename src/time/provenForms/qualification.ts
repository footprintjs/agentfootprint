import type { ClockRow, TimeReadingRow } from '../rows.js';
import type { TimeReader } from '../reader.js';
import { readEnglishTime } from '../readers/english.js';
import type { TimeCandidate } from '../resolve.js';
import { provenLookback } from './proof.js';

const phrases: ReadonlySet<string> = new Set(provenLookback.phrases);
const appZones: ReadonlySet<string> = new Set(provenLookback.appZones);

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

/** A fresh built-in reading eligible for admission. Replay uses the saved witness instead. */
export function provenLookbackOf(
  reader: TimeReader,
  text: string,
  clock: ClockRow,
  rows: readonly TimeReadingRow[],
): TimeCandidate | undefined {
  if (
    reader.id !== provenLookback.reader.id ||
    reader.version !== provenLookback.reader.version ||
    reader.kind !== provenLookback.reader.kind ||
    reader.locale !== provenLookback.reader.locale ||
    reader.read !== readEnglishTime ||
    clock.zoneSource === 'unknown' ||
    clock.window !== undefined ||
    !appZones.has(clock.zone) ||
    !phrases.has(text) ||
    !measuredRuntime() ||
    rows.length !== 1
  ) {
    return undefined;
  }

  const row = rows[0];
  const candidate = row?.candidates?.[0];
  const choice = row?.choice;
  if (
    row?.quote !== text ||
    row.mentions !== 1 ||
    row.mention !== 0 ||
    row.parses?.length !== 1 ||
    row.refused !== undefined ||
    row.problem !== undefined ||
    row.candidates?.length !== 1 ||
    choice?.by !== 'open' ||
    choice.open.length !== 1 ||
    choice.open[0] !== 'confirm' ||
    choice.remaining.length !== 1 ||
    choice.remaining[0] !== 0 ||
    candidate?.window.kind !== 'lookback' ||
    candidate.endpoint?.end !== 'exclusive' ||
    candidate.endpoint.cutoff !== clock.now
  ) {
    return undefined;
  }
  return candidate;
}
