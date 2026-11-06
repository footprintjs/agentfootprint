/** Closed accepted meaning, without the corrected words or parser output. */
import { durationMs, isDuration, LOOKBACK_UNITS } from '../duration.js';
import { instantOf } from '../instant.js';
import type { TimeRange } from '../range.js';

export function isCorrectedMeaning(value: unknown, range: TimeRange): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const data = Object.getOwnPropertyDescriptors(value),
    keys = Object.keys(data);
  if (keys.length === 0) return true;
  if (keys.length !== 1 || keys[0] !== 'lookback' || !('value' in data.lookback)) return false;
  const duration = data.lookback.value;
  if (!isDuration(duration, LOOKBACK_UNITS)) return false;
  const length = durationMs(duration, LOOKBACK_UNITS);
  const from = instantOf(range.from, 'strict'),
    to = instantOf(range.to, 'strict');
  return (
    length !== undefined &&
    Number.isFinite(length) &&
    from !== undefined &&
    to !== undefined &&
    from.nanos === to.nanos &&
    to.ms - from.ms === length + 1
  );
}
