import type { LedgerReceipt, LedgerSupplied } from '../types.js';
import {
  DAY_MINUTES,
  hasPrecision,
  mod,
  precisionOverlaps,
  timeValue,
  type TimeValue,
} from './valueTime.js';

type Anchored = Extract<TimeValue, { kind: 'anchored' }>;
type PartialTime = Extract<TimeValue, { kind: 'floating-date' | 'clock' }>;

interface Candidate {
  readonly value: Anchored;
  readonly receipt: LedgerReceipt;
}

type Match =
  | { readonly kind: 'supplied' | 'missing' | 'ambiguous' | 'unresolved-zone' }
  | { readonly kind: 'receipt'; readonly seq: number };

function preferred(current: LedgerReceipt | undefined, next: LedgerReceipt): LedgerReceipt {
  return current === undefined || (current.how !== 'observed' && next.how === 'observed')
    ? next
    : current;
}

function addCandidate(index: Map<number, Candidate[]>, key: number, candidate: Candidate): void {
  const current = index.get(key);
  if (current === undefined) index.set(key, [candidate]);
  else current.push(candidate);
}

/** A literal is useful for non-time values. A clock needs a unique anchored receipt. */
export function valueEvidence(
  stated: ReadonlySet<string>,
  receipts: readonly LedgerReceipt[],
  supplied: readonly LedgerSupplied[],
): (token: string) => Match {
  const parsed = new Map<string, TimeValue | undefined>();
  const time = (token: string) => {
    if (!token.includes(':')) return undefined;
    if (!parsed.has(token)) parsed.set(token, timeValue(token));
    return parsed.get(token);
  };
  const wanted = { atMinute: new Set<number>(), utcClock: new Set<number>() };
  for (const token of stated) {
    const value = time(token);
    if (value?.kind === 'anchored') wanted.atMinute.add(value.minute);
    if (value?.kind === 'clock' && value.offsetMinutes === 0)
      wanted.utcClock.add(mod(value.minute, DAY_MINUTES));
  }
  const needsTime = wanted.atMinute.size + wanted.utcClock.size > 0;
  const exemptions = new Set<string>();
  const suppliedTimes: Anchored[] = [];
  for (const entry of supplied) {
    for (const token of entry.tokens) {
      if (stated.has(token)) exemptions.add(token);
      const value = needsTime ? time(token) : undefined;
      if (value?.kind === 'anchored') suppliedTimes.push(value);
    }
  }
  const literals = new Map<string, LedgerReceipt>();
  const atMinute = new Map<number, Candidate[]>();
  const utcClock = new Map<number, Candidate[]>();
  const partials: { value: PartialTime; receipt: LedgerReceipt }[] = [];

  for (const receipt of receipts) {
    for (const token of receipt.tokens) {
      if (stated.has(token)) literals.set(token, preferred(literals.get(token), receipt));
      const value = needsTime ? time(token) : undefined;
      if (value?.kind === 'anchored') {
        const candidate = { value, receipt };
        const utc = mod(value.minute, DAY_MINUTES);
        if (wanted.atMinute.has(value.minute)) addCandidate(atMinute, value.minute, candidate);
        if (wanted.utcClock.has(utc)) addCandidate(utcClock, utc, candidate);
      } else if (value?.kind === 'floating-date' || value?.kind === 'clock') {
        partials.push({ value, receipt });
      }
    }
  }

  return (token) => {
    const value = time(token);
    if (value?.kind === 'unreadable') return { kind: 'missing' };
    if (
      value?.kind === 'unresolved-zone' ||
      value?.kind === 'floating-date' ||
      (value?.kind === 'clock' && value.offsetMinutes !== 0)
    )
      return { kind: 'unresolved-zone' };
    if (exemptions.has(token)) return { kind: 'supplied' };
    if (value === undefined) {
      const receipt = literals.get(token);
      return receipt === undefined ? { kind: 'missing' } : { kind: 'receipt', seq: receipt.seq };
    }

    if (
      value.kind === 'anchored' &&
      suppliedTimes.some((item) => item.minute === value.minute && hasPrecision(value, item))
    )
      return { kind: 'supplied' };

    const key = value.kind === 'clock' ? mod(value.minute, DAY_MINUTES) : value.minute;
    const candidates = value.kind === 'anchored' ? atMinute.get(key) : utcClock.get(key);
    let found: LedgerReceipt | undefined;
    let instant: Anchored | undefined;
    let uncertain = false;
    const anchoredReceipts = new Set<LedgerReceipt>();
    for (const candidate of candidates ?? []) {
      if (!precisionOverlaps(value, candidate.value)) continue;
      if (
        !hasPrecision(value, candidate.value) ||
        (value.kind !== 'anchored' &&
          instant !== undefined &&
          (instant.minute !== candidate.value.minute ||
            Math.floor(instant.part / value.unit) !==
              Math.floor(candidate.value.part / value.unit)))
      )
        uncertain = true;
      else {
        instant = candidate.value;
        anchoredReceipts.add(candidate.receipt);
        found = preferred(found, candidate.receipt);
      }
    }

    if (value.kind === 'anchored' && found !== undefined)
      return { kind: 'receipt', seq: found.seq };
    const possiblePartial = partials.some(({ value: other, receipt }) => {
      if (!precisionOverlaps(value, other)) return false;
      // A clock spelling in the same receipt adds no second date when that receipt
      // also fixes the instant. Another receipt or an explicit unknown offset is unresolved.
      if (
        value.kind !== 'anchored' &&
        other.kind === 'clock' &&
        !other.unknownOffset &&
        anchoredReceipts.has(receipt)
      )
        return false;
      if (value.kind === 'anchored') {
        if (other.kind === 'floating-date')
          return Math.abs(value.minute - other.minute) < DAY_MINUTES;
        return (
          other.offsetMinutes === undefined ||
          mod(value.minute, DAY_MINUTES) === mod(other.minute, DAY_MINUTES)
        );
      }
      const written =
        other.kind === 'clock' ? other.minute + (other.offsetMinutes ?? 0) : other.minute;
      return mod(value.minute, DAY_MINUTES) === mod(written, DAY_MINUTES);
    });
    if (uncertain || possiblePartial) return { kind: 'ambiguous' };
    return found === undefined ? { kind: 'missing' } : { kind: 'receipt', seq: found.seq };
  };
}
