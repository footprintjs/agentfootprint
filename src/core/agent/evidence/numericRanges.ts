/** Pure answer-side recognition: exactly two plain numeric endpoints. */
import { answerTokenSpellings } from '../../../lib/normalize.js';
import { FIGURE_UNITS } from './figureUnits.js';

export interface NumericRange {
  readonly first: string;
  readonly last: string;
  readonly unit?: string;
}

// Anchored endpoints exclude dates, clocks, dotted versions and multipart IDs.
const RANGE = /^([-+]?\d+(?:\.\d+)?)[-–]([-+]?\d+(?:\.\d+)?)([%a-z]+(?:\/s)?)?$/;
const UNITS = new Set(FIGURE_UNITS.flatMap((unit) => [unit, `${unit}/s`]));

export function splitNumericRange(token: string, following?: string): NumericRange | undefined {
  const matched = RANGE.exec(token);
  if (matched?.[1] === undefined || matched[2] === undefined) return undefined;
  const suffix = matched[3];
  if (suffix !== undefined && !UNITS.has(suffix)) return undefined;
  const unit = suffix ?? (following !== undefined && UNITS.has(following) ? following : undefined);
  return { first: matched[1], last: matched[2], ...(unit !== undefined && { unit }) };
}

/** Measurement ranges augment the existing figure vocabulary on the answer side only. */
export function numericRangesOf(answer: string): readonly NumericRange[] {
  const tokens = answerTokenSpellings(answer);
  const ranges: NumericRange[] = [];
  for (let index = 0; index < Math.min(tokens.length, 20_000); index += 1) {
    const range = splitNumericRange(tokens[index] ?? '', tokens[index + 1]);
    if (range !== undefined) ranges.push(range);
  }
  return ranges;
}
