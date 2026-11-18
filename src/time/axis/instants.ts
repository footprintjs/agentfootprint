import type { AxisPrecision } from '../axis.js';
import { spellInstant, type Instant, type InstantText } from '../instant.js';

const NS_PER_MS = 1_000_000n;

/**
 * An epoch number read EXACTLY as written — through its decimal spelling, so
 * `1726304400.123` is 123 ms and not the double's nearest neighbour. An
 * exponent spelling (`1e21`) or a fraction finer than a nanosecond is
 * unreadable.
 */
export function epochInstant(value: unknown, unit: 'epoch-s' | 'epoch-ms'): Instant | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (m === null) return undefined;
  const fractionDigits = unit === 'epoch-s' ? 9 : 6; // down to one nanosecond
  const fraction = m[3] ?? '';
  if (fraction.length > fractionDigits) return undefined;
  const magnitude =
    BigInt(m[2] as string) * 10n ** BigInt(fractionDigits) +
    BigInt(fraction.padEnd(fractionDigits, '0') || '0');
  const ns = m[1] === '-' ? -magnitude : magnitude;
  let ms = ns / NS_PER_MS;
  if (ns < 0n && ms * NS_PER_MS !== ns) ms -= 1n; // floor, not truncate
  const whole = Number(ms);
  if (!Number.isSafeInteger(whole)) return undefined;
  return { ms: whole, nanos: Number(ns - ms * NS_PER_MS) };
}

export function spellable(instant: Instant): boolean {
  return spellInstant(instant, 0) !== undefined;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export function precisionOf(instants: readonly Instant[]): AxisPrecision {
  let precision: AxisPrecision = 'second';
  for (const { ms, nanos } of instants) {
    if (nanos !== 0) return 'nanosecond';
    if (((ms % 1000) + 1000) % 1000 !== 0) precision = 'millisecond';
  }
  return precision;
}

/** `instant` in UTC with exactly the digits `precision` names — fixed width, so text order is time order. */
export function spellAt(instant: Instant, precision: AxisPrecision): InstantText {
  const msPart = ((instant.ms % 1000) + 1000) % 1000;
  const whole = spellInstant({ ms: instant.ms - msPart, nanos: 0 }, 0) as string;
  if (precision === 'second') return whole;
  const fraction = pad(msPart * 1_000_000 + instant.nanos, 9);
  const digits = precision === 'millisecond' ? fraction.slice(0, 3) : fraction;
  return `${whole.slice(0, -1)}.${digits}Z`;
}
