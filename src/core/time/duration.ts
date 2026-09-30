/**
 * core/time/duration — the ONE duration grammar, with a unit set per use.
 *
 * Pattern: one grammar, units narrowed per use (never a second regex). A
 *          duration is a MACHINE spelling an author declared — a tool's
 *          `-40m` argument, a `retention: '30d'`, a dataset's `interval:
 *          '5m'` — never a person's words ("the last 40 minutes" is read only
 *          by an armed reader). This is the T-spellings law of the time
 *          design (`docs/design/time/README.md`, § 5.4).
 * Role:    core/ leaf (the time layer's one owner). Imports nothing. Asked by
 *          `arguments/declare.ts` · `parsesUnderSpelling` for a look-back.
 * Emits:   N/A.
 *
 * ## The grammar
 *
 * `^[1-9][0-9]*[smhdw]$` — a positive integer with no leading zero, then one
 * unit. NO digit cap: `1000000m` is a look-back today and stays one. The UNIT
 * SET is named by every caller, because widening it is a behaviour change:
 *
 * | Use | Units | Why |
 * |-----|-------|-----|
 * | a look-back argument ({@link LOOKBACK_UNITS}) | `mhdw` | today's spelling; a backend that never took seconds is never sent `30s` unless its tool declares `units: 'smhdw'` |
 * | a dataset's interval ({@link AXIS_UNITS}) | `smhdw` | a series can be bucketed by the second |
 *
 * `d` is 24 hours and `w` is 7 days: a machine duration, not a calendar day
 * (a calendar day in a zone with DST is `zone.ts`'s question).
 *
 * @example
 * ```ts
 * isDuration('30m', LOOKBACK_UNITS);        // true
 * isDuration('30s', LOOKBACK_UNITS);        // false — seconds are opt-in
 * isDuration('30s', AXIS_UNITS);            // true
 * durationMs('2h', LOOKBACK_UNITS);         // 7200000
 * spellDuration(7_200_000, LOOKBACK_UNITS); // '2h' — the smallest exact spelling
 * ```
 */

/** The one duration grammar's text: `^[1-9][0-9]*[smhdw]$`, units narrowed per use. */
export type DurationText = string;

/** One unit: second, minute, hour, day (24 h), week (7 d). */
export type DurationUnit = 's' | 'm' | 'h' | 'd' | 'w';

/** Every unit, smallest first. */
export const DURATION_UNITS: readonly DurationUnit[] = Object.freeze(['s', 'm', 'h', 'd', 'w']);

/** A look-back's units — today's `mhdw`; `s` only by the tool's own opt-in. */
export const LOOKBACK_UNITS = 'mhdw';

/** A dataset interval's units. */
export const AXIS_UNITS = 'smhdw';

const UNIT_MS: Readonly<Record<DurationUnit, number>> = Object.freeze({
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
});

const DURATION = /^([1-9][0-9]*)([smhdw])$/;

/**
 * Whether `units` is a unit set: a non-empty string of distinct letters from
 * `smhdw`, in any order.
 */
export function isUnitSet(units: unknown): units is string {
  if (typeof units !== 'string' || units.length === 0 || units.length > DURATION_UNITS.length) {
    return false;
  }
  const seen = new Set<string>();
  for (const letter of units) {
    if (!(DURATION_UNITS as readonly string[]).includes(letter) || seen.has(letter)) return false;
    seen.add(letter);
  }
  return true;
}

function assertUnits(units: string, caller: string): void {
  if (!isUnitSet(units)) {
    throw new TypeError(
      `${caller}: '${String(units)}' is not a unit set — distinct letters from 'smhdw'.`,
    );
  }
}

/** The count (as written, digits) and unit of a duration, or `undefined` when it is not one under `units`. */
export function durationParts(
  value: unknown,
  units: string,
): { readonly digits: string; readonly unit: DurationUnit } | undefined {
  assertUnits(units, 'durationParts');
  if (typeof value !== 'string') return undefined;
  const m = DURATION.exec(value);
  if (m === null || !units.includes(m[2] as string)) return undefined;
  return { digits: m[1] as string, unit: m[2] as DurationUnit };
}

/** Whether `value` is a duration under `units`. A format check: any number of digits. */
export function isDuration(value: unknown, units: string): value is DurationText {
  return durationParts(value, units) !== undefined;
}

/**
 * The milliseconds a duration names, or `undefined` when it is not a duration
 * under `units` — or names more milliseconds than a double holds exactly (the
 * spelling is still a duration; it just cannot be measured).
 */
export function durationMs(value: unknown, units: string): number | undefined {
  const parts = durationParts(value, units);
  if (parts === undefined) return undefined;
  const ms = Number(parts.digits) * UNIT_MS[parts.unit];
  return Number.isSafeInteger(ms) ? ms : undefined;
}

/**
 * The smallest exact spelling of `ms` in `units` — the largest unit that
 * divides it — or `undefined` when no unit in the set divides it (or `ms` is
 * not a positive whole number of milliseconds). `durationMs(spellDuration(x))`
 * is `x` whenever it is defined.
 */
export function spellDuration(ms: number, units: string): DurationText | undefined {
  assertUnits(units, 'spellDuration');
  if (!Number.isSafeInteger(ms) || ms <= 0) return undefined;
  for (let i = DURATION_UNITS.length - 1; i >= 0; i--) {
    const unit = DURATION_UNITS[i] as DurationUnit;
    if (!units.includes(unit)) continue;
    if (ms % UNIT_MS[unit] === 0) return `${ms / UNIT_MS[unit]}${unit}`;
  }
  return undefined;
}
