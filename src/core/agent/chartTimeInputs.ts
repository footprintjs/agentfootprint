import { readerWindowsOf } from '../../time/windows.js';
import { clockOf } from '../../time/rows.js';
import { timeLimitFactsOf, type TimeLimitFacts } from '../../semantics/coverage/timeLimitFacts.js';
import { activeTimeReadings } from './honesty/timeInputs.js';

/** The Tools mount's `timeWindows` arg — the turn's windows (the reader's, the control's), or no key at all. */
export function timeWindowsArg(
  ledger: unknown,
  parent?: Record<string, unknown>,
  allowProven = false,
): {
  timeWindows?: ReturnType<typeof readerWindowsOf>;
} {
  const active = parent === undefined ? undefined : activeTimeReadings(parent, allowProven);
  const projected = active?.some(
    (row) => row.choice?.by === 'only' && row.qualifiedLookback !== undefined,
  );
  const windows = readerWindowsOf(
    ledger as readonly unknown[] | undefined,
    projected ? active : undefined,
  );
  return windows === undefined ? {} : { timeWindows: windows };
}

/**
 * The Tools mount's `timeClock` arg — the turn's run clock for the served
 * line's first sentence (G16, `agent/arguments/serve/clock.ts` · `clockSentence`),
 * or no key when the turn has no clock. Under an unknown zone (G15) the zone
 * is the UTC spelling, marked `zoneUnknown`.
 */
export function timeClockArg(ledger: unknown): {
  timeClock?: { now: string; zone: string; zoneUnknown?: true };
} {
  const clock = clockOf(ledger as readonly unknown[] | undefined);
  if (clock === undefined) return {};
  return {
    timeClock: {
      now: clock.now,
      zone: clock.zone,
      ...(clock.zoneSource === 'unknown' && { zoneUnknown: true as const }),
    },
  };
}

/**
 * The Tools mount's `timeLimits` arg — the turn's result-check FACTS for the
 * model (unrendered: the slot's served line renders them, under the arm), or
 * no key.
 */
export function timeLimitsArg(ledger: unknown): { timeLimits?: TimeLimitFacts } {
  const rows = ledger as readonly unknown[] | undefined;
  const facts = timeLimitFactsOf(rows, clockOf(rows)?.turn, 'model');
  return facts === undefined ? {} : { timeLimits: facts };
}
