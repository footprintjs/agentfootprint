import type { LedgerReceipt, LedgerSupplied } from '../types.js';
import { instantMs } from '../window.js';

type AnchoredTime =
  | { readonly kind: 'instant'; readonly ms: number; readonly minute: number }
  | { readonly kind: 'minute'; readonly minute: number };

type PartialTime =
  | { readonly kind: 'floating-date'; readonly minute: number; readonly part?: number }
  | { readonly kind: 'clock'; readonly minuteOfDay?: number; readonly part?: number };

type TimeValue = AnchoredTime | PartialTime | { readonly kind: 'unreadable' };

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2}t\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?(z|[+-]\d{2}:\d{2})?$/i;
const CLOCK = /^((?:[01]\d|2[0-3]):[0-5]\d)(:\d{2}(?:\.\d+)?)?(z|[+-]\d{2}:\d{2})?$/i;

function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** A UTC coordinate for partial data is for comparison only; it is never proof of an instant. */
function timeValue(token: string): TimeValue | undefined {
  const date = DATE_TIME.exec(token);
  const match = date ?? CLOCK.exec(token);
  if (match === null) return undefined;
  const [, wallMinute, seconds, offset] = match;
  const hasOffset = offset !== undefined && offset !== '-00:00';
  const datePrefix = date === null ? '1970-01-01T' : '';
  const ms = instantMs(
    `${datePrefix}${wallMinute}${seconds ?? ':00'}${hasOffset ? offset : 'Z'}`.toUpperCase(),
  );
  if (ms === undefined) return { kind: 'unreadable' };
  const minute = Math.floor(ms / MINUTE_MS);
  const part = seconds === undefined ? undefined : mod(ms, MINUTE_MS);
  if (date === null)
    return { kind: 'clock', minuteOfDay: hasOffset ? mod(minute, DAY_MINUTES) : undefined, part };
  if (!hasOffset) return { kind: 'floating-date', minute, part };
  return seconds === undefined ? { kind: 'minute', minute } : { kind: 'instant', ms, minute };
}

const ANY_PART = 'any';
type PartKey = number | typeof ANY_PART | undefined;

function clockKey(minuteOfDay: number | undefined, part: PartKey): string {
  return `${minuteOfDay ?? '*'}:${part ?? 'minute'}`;
}

/** The validator admits whole-minute offsets up to ±23:59. Search only that range. */
function hasPossibleOffset(wallMinutes: readonly number[], minute: number): boolean {
  let start = 0;
  let end = wallMinutes.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if ((wallMinutes[middle] ?? Infinity) <= minute - DAY_MINUTES) start = middle + 1;
    else end = middle;
  }
  const candidate = wallMinutes[start];
  return candidate !== undefined && candidate < minute + DAY_MINUTES;
}

type MatchKey = `literal:${string}` | `instant:${number}` | `minute:${number}`;

function lookupKeys(token: string, value: TimeValue | undefined): MatchKey[] {
  const keys: MatchKey[] = [`literal:${token}`];
  if (value?.kind === 'instant') keys.push(`instant:${value.ms}`);
  if (value?.kind === 'minute') keys.push(`minute:${value.minute}`);
  return keys;
}

function evidenceKeys(token: string, value: TimeValue | undefined): MatchKey[] {
  const keys = lookupKeys(token, value);
  if (value?.kind === 'instant') keys.push(`minute:${value.minute}`);
  return keys;
}

interface Holder {
  readonly receipt: LedgerReceipt;
  readonly position: number;
}

/** First observed match, otherwise first reported match, across spellings. */
function preferred(current: Holder | undefined, next: Holder | undefined): Holder | undefined {
  if (current === undefined) return next;
  if (next === undefined) return current;
  if (current.receipt.how !== next.receipt.how)
    return next.receipt.how === 'observed' ? next : current;
  return next.position < current.position ? next : current;
}

type Match =
  | { readonly kind: 'supplied' | 'missing' | 'ambiguous' }
  | { readonly kind: 'receipt'; readonly seq: number };

/** Scan admitted tokens once. Only keys that the subject can match enter the evidence index. */
export function valueEvidence(
  stated: ReadonlySet<string>,
  receipts: readonly LedgerReceipt[],
  supplied: readonly LedgerSupplied[],
): (token: string) => Match {
  const parsed = new Map<string, TimeValue | undefined>();
  const time = (token: string) => {
    if (!parsed.has(token)) parsed.set(token, timeValue(token));
    return parsed.get(token);
  };
  const wanted = new Set([...stated].flatMap((token) => lookupKeys(token, time(token))));
  const exemptions = new Set<MatchKey>();
  for (const entry of supplied)
    for (const token of entry.tokens)
      for (const key of evidenceKeys(token, time(token))) if (wanted.has(key)) exemptions.add(key);
  const matches = new Map<MatchKey, Holder>();
  const coarseMinutes = new Set<number>();
  const clocks = new Set<string>();
  const floatingDates = new Map<PartKey, number[]>();
  for (const [position, receipt] of receipts.entries()) {
    for (const token of receipt.tokens) {
      const value = time(token);
      if (value?.kind === 'minute') coarseMinutes.add(value.minute);
      if (value?.kind === 'clock') {
        clocks.add(clockKey(value.minuteOfDay, value.part));
        clocks.add(clockKey(value.minuteOfDay, ANY_PART));
      }
      if (value?.kind === 'floating-date') {
        // Index all wall minutes for a minute claim, and by sub-minute precision for exact claims.
        for (const part of [ANY_PART, value.part] as const) {
          const minutes = floatingDates.get(part);
          if (minutes === undefined) floatingDates.set(part, [value.minute]);
          else minutes.push(value.minute);
        }
      }
      for (const key of evidenceKeys(token, value)) {
        if (!wanted.has(key)) continue;
        const holder = matches.get(key);
        if (
          holder === undefined ||
          (receipt.how === 'observed' && holder.receipt.how !== 'observed')
        )
          matches.set(key, { receipt, position });
      }
    }
  }
  for (const minutes of floatingDates.values()) minutes.sort((a, b) => a - b);

  return (token) => {
    const value = time(token);
    const keys = lookupKeys(token, value);
    if (keys.some((key) => exemptions.has(key))) return { kind: 'supplied' };
    const found = keys.reduce<Holder | undefined>(
      (holder, key) => preferred(holder, matches.get(key)),
      undefined,
    );
    if (found !== undefined) return { kind: 'receipt', seq: found.receipt.seq };
    if (value === undefined) return { kind: 'missing' };
    if (value.kind !== 'minute' && value.kind !== 'instant') return { kind: 'ambiguous' };

    const part = value.kind === 'instant' ? mod(value.ms, MINUTE_MS) : ANY_PART;
    const minuteOfDay = mod(value.minute, DAY_MINUTES);
    if (
      clocks.has(clockKey(minuteOfDay, part)) ||
      clocks.has(clockKey(undefined, part)) ||
      hasPossibleOffset(floatingDates.get(part) ?? [], value.minute) ||
      (part !== ANY_PART &&
        (coarseMinutes.has(value.minute) ||
          clocks.has(clockKey(minuteOfDay, undefined)) ||
          clocks.has(clockKey(undefined, undefined)) ||
          hasPossibleOffset(floatingDates.get(undefined) ?? [], value.minute)))
    )
      return { kind: 'ambiguous' };
    return { kind: 'missing' };
  };
}
