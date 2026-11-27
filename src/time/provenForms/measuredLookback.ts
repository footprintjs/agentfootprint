import type { ClockRow, TimeReadingRow } from '../rows.js';
import { choiceForConfirmation } from '../resolveRecord.js';
import type { TimeCandidate } from '../resolve.js';
import { provenLookback } from './proof.js';

const phrases: ReadonlySet<string> = new Set(provenLookback.phrases);
const appZones: ReadonlySet<string> = new Set(provenLookback.appZones);

/** Check the measured form and its resolved interval for both admission and replay. */
export function measuredLookbackOf(
  text: unknown,
  clock: ClockRow,
  rows: readonly TimeReadingRow[],
): TimeCandidate | undefined {
  if (
    typeof text !== 'string' ||
    !phrases.has(text) ||
    clock.zoneSource === 'unknown' ||
    clock.window !== undefined ||
    !appZones.has(clock.zone) ||
    rows.length !== 1
  ) {
    return undefined;
  }
  const row = rows[0];
  const candidate = row?.candidates?.[0];
  const choice = choiceForConfirmation(row?.choice);
  if (
    row?.quote !== text ||
    row.turn !== clock.turn ||
    row.reader.id !== provenLookback.reader.id ||
    row.reader.version !== provenLookback.reader.version ||
    row.reader.kind !== provenLookback.reader.kind ||
    row.reader.locale !== provenLookback.reader.locale ||
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
