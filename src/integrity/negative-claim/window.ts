/**
 * window — the time arithmetic of the checker: spans in milliseconds, a relative window
 * resolved on the leg's clock, the part of a read the store did not hold, and the window a
 * prose claim names.
 *
 * Pattern: pure functions over the time layer's one parser (`time/instant.ts · instantOf`, the
 *          lenient profile a declared period uses) and its one duration grammar
 *          (`time/duration.ts · durationMs`). No clock is read: `clock` is always handed in.
 * Role:    integrity/ layer (L3), read by `readings.ts`, `containment.ts` and `statement.ts`.
 *
 * A span here is INCLUSIVE at both ends, as a declared period's `queried` and `held` are.
 */

import type { DeclaredPeriod } from '../../semantics/coverage/period.js';
import { durationMs } from '../../time/duration.js';
import { instantOf } from '../../time/instant.js';
import { NEGATIVE_CLAIM_PHRASES } from './phrases.js';
import { firstHit, numberOf, type Token } from './words.js';

export interface MsSpan {
  readonly from: number;
  readonly to: number;
}

export const instantMs = (value: unknown): number | undefined => instantOf(value, 'lenient')?.ms;

/** A `{ from, to }` of instants as milliseconds, or undefined when either is not an instant. */
export function msSpan(span: { readonly from: unknown; readonly to: unknown }): MsSpan | undefined {
  const from = instantMs(span.from);
  const to = instantMs(span.to);
  return from === undefined || to === undefined || from > to ? undefined : { from, to };
}

export const inside = (inner: MsSpan, outer: MsSpan): boolean =>
  outer.from <= inner.from && inner.to <= outer.to;

export const overlaps = (a: MsSpan, b: MsSpan): boolean => a.from <= b.to && b.from <= a.to;

/** A look-back (`2h`, `120m`, `-24h`) as the span it covers, ending at the leg's clock. */
export function lookbackSpan(value: unknown, clock: string): MsSpan | undefined {
  if (typeof value !== 'string') return undefined;
  const now = instantMs(clock);
  const length = durationMs(value.startsWith('-') ? value.slice(1) : value, 'smhdw');
  return now === undefined || length === undefined ? undefined : { from: now - length, to: now };
}

/** An `a..b` range (`iso-range`) as a span. */
function rangeSpan(value: unknown): MsSpan | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split('..');
  return parts.length === 2 ? msSpan({ from: parts[0], to: parts[1] }) : undefined;
}

/** A period argument's value as the span it covers, by the tool's declared spelling. */
export function periodValueSpan(
  value: unknown,
  spelling: string | undefined,
  clock: string,
): MsSpan | undefined {
  if (spelling === 'lookback' || spelling === 'signed-lookback') return lookbackSpan(value, clock);
  if (spelling === 'iso-range') return rangeSpan(value);
  return undefined;
}

/** The span a read asked about, as the result declared it. */
export const queriedOf = (period: DeclaredPeriod | undefined): MsSpan | undefined =>
  period === undefined ? undefined : msSpan(period.queried);

/**
 * The parts of `queried` the store did not hold: all of it when `held` is unknown, the parts
 * outside `held` otherwise (none when `held` covers it).
 */
export function unheldOf(period: DeclaredPeriod): MsSpan[] {
  const queried = queriedOf(period);
  if (queried === undefined) return [];
  if (period.held === 'unknown') return [queried];
  const held = msSpan(period.held);
  if (held === undefined || !overlaps(queried, held)) return [queried];
  const out: MsSpan[] = [];
  if (queried.from < held.from) out.push({ from: queried.from, to: held.from });
  if (held.to < queried.to) out.push({ from: held.to, to: queried.to });
  return out;
}

const UNIT_MS: Readonly<Record<string, number>> = {
  minute: 60_000,
  minutes: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
  day: 86_400_000,
  days: 86_400_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

/** The window a unit names ("in the last 2 hours"), ending at the leg's clock. */
export function claimWindowOf(
  text: string,
  tokens: readonly Token[],
  clock: string,
): MsSpan | undefined {
  const hit = firstHit(text, tokens, NEGATIVE_CLAIM_PHRASES.window);
  if (hit === undefined) return undefined;
  const words = tokens.slice(hit.first, hit.last + 1).map((t) => t.text);
  const last = words[words.length - 1] ?? '';
  if (UNIT_MS[last] === undefined) return lookbackSpan(last, clock);
  const count = numberOf(words[words.length - 2] ?? '') ?? 1;
  const now = instantMs(clock);
  return now === undefined ? undefined : { from: now - count * (UNIT_MS[last] as number), to: now };
}
