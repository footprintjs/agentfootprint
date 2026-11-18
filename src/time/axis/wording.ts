import { AXIS_UNITS, durationParts } from '../duration.js';

// ── The wording ─────────────────────────────────────────────────────────────

const UNIT_WORDS: Record<string, string> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
};
const SINGLE: Record<string, string> = {
  s: 'per-second',
  m: 'per-minute',
  h: 'hourly',
  d: 'daily',
  w: 'weekly',
};

/** `'1h'` → `'hourly'`, `'5m'` → `'5-minute'`. */
export function intervalAdjective(interval: string): string {
  const parts = durationParts(interval, AXIS_UNITS);
  if (parts === undefined) return interval;
  return parts.digits === '1'
    ? (SINGLE[parts.unit] as string)
    : `${parts.digits}-${UNIT_WORDS[parts.unit] as string}`;
}

/** `'5m'` → `'5 minutes'`, `'1h'` → `'hour'`. */
export function intervalNoun(interval: string): string {
  const parts = durationParts(interval, AXIS_UNITS);
  if (parts === undefined) return interval;
  return parts.digits === '1'
    ? (UNIT_WORDS[parts.unit] as string)
    : `${parts.digits} ${UNIT_WORDS[parts.unit] as string}s`;
}

export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] as string}`;
}
