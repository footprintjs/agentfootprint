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
  | { readonly kind: 'supplied' | 'missing' | 'ambiguous' }
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
  const wanted = {
    atMinute: new Set<number>(),
    wallDate: new Set<number>(),
    utcClock: new Set<number>(),
    wallClock: new Set<number>(),
  };
  let needsTime = false;
  for (const token of stated) {
    const value = time(token);
    if (value === undefined || value.kind === 'unreadable' || value.kind === 'unresolved-zone')
      continue;
    needsTime = true;
    if (value.kind === 'anchored') wanted.atMinute.add(value.minute);
    if (value.kind === 'floating-date') wanted.wallDate.add(value.minute);
    if (value.kind === 'clock') {
      const keys = value.offsetMinutes === undefined ? wanted.wallClock : wanted.utcClock;
      keys.add(mod(value.minute, DAY_MINUTES));
    }
  }
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
  const wallClock = new Map<number, Candidate[]>();
  const wallDate = new Map<number, Candidate[]>();
  const partials: { value: PartialTime; receipt: LedgerReceipt }[] = [];

  for (const receipt of receipts) {
    for (const token of receipt.tokens) {
      if (stated.has(token)) literals.set(token, preferred(literals.get(token), receipt));
      const value = needsTime ? time(token) : undefined;
      if (value?.kind === 'anchored') {
        const candidate = { value, receipt };
        const wall = value.minute + value.offsetMinutes;
        const utc = mod(value.minute, DAY_MINUTES);
        const wallMinute = mod(wall, DAY_MINUTES);
        if (wanted.atMinute.has(value.minute)) addCandidate(atMinute, value.minute, candidate);
        if (wanted.utcClock.has(utc)) addCandidate(utcClock, utc, candidate);
        if (wanted.wallClock.has(wallMinute)) addCandidate(wallClock, wallMinute, candidate);
        if (wanted.wallDate.has(wall)) addCandidate(wallDate, wall, candidate);
      } else if (value?.kind === 'floating-date' || value?.kind === 'clock') {
        partials.push({ value, receipt });
      }
    }
  }

  return (token) => {
    const value = time(token);
    if (value?.kind === 'unreadable') return { kind: 'missing' };
    if (value?.kind === 'unresolved-zone') return { kind: 'ambiguous' };
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
    const candidates =
      value.kind === 'anchored'
        ? atMinute.get(key)
        : value.kind === 'floating-date'
        ? wallDate.get(key)
        : value.offsetMinutes === undefined
        ? wallClock.get(key)
        : utcClock.get(key);
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
      if (value.kind === 'floating-date' && other.kind === 'floating-date')
        return value.minute === other.minute;
      const written =
        value.kind === 'clock' ? value.minute + (value.offsetMinutes ?? 0) : value.minute;
      const otherWritten =
        other.kind === 'clock' ? other.minute + (other.offsetMinutes ?? 0) : other.minute;
      return mod(written, DAY_MINUTES) === mod(otherWritten, DAY_MINUTES);
    });
    if (value.kind !== 'anchored' && value.unknownOffset && found !== undefined)
      return { kind: 'ambiguous' };
    if (uncertain || possiblePartial) return { kind: 'ambiguous' };
    return found === undefined ? { kind: 'missing' } : { kind: 'receipt', seq: found.seq };
  };
}
