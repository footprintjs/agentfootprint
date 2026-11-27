import type { LedgerReceipt, LedgerSupplied } from '../types.js';
import { instantMs } from '../window.js';

type TimeValue =
  | { readonly kind: 'instant'; readonly ms: number; readonly minute: number }
  | { readonly kind: 'minute'; readonly minute: number }
  | { readonly kind: 'ambiguous' };

const DATE_TIME = /^(\d{4}-\d{2}-\d{2}t\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?(z|[+-]\d{2}:\d{2})?$/i;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:z|[+-]\d{2}:\d{2})?$/i;

/** Use the ledger's date validator. Precision and the absence of an offset stay explicit. */
function timeValue(token: string): TimeValue | undefined {
  const match = DATE_TIME.exec(token);
  if (match === null) return CLOCK.test(token) ? { kind: 'ambiguous' } : undefined;
  const [, minute, seconds, offset] = match;
  if (offset === undefined || offset === '-00:00') return { kind: 'ambiguous' };
  const ms = instantMs(`${minute}${seconds ?? ':00'}${offset}`.toUpperCase());
  if (ms === undefined) return { kind: 'ambiguous' };
  const bucket = Math.floor(ms / 60_000);
  return seconds === undefined
    ? { kind: 'minute', minute: bucket }
    : { kind: 'instant', ms, minute: bucket };
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
  let unknownTime = false;
  for (const [position, receipt] of receipts.entries()) {
    for (const token of receipt.tokens) {
      const value = time(token);
      if (value?.kind === 'minute') coarseMinutes.add(value.minute);
      if (value?.kind === 'ambiguous') unknownTime = true;
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
  return (token) => {
    const value = time(token);
    const keys = lookupKeys(token, value);
    if (keys.some((key) => exemptions.has(key))) return { kind: 'supplied' };
    const found = keys.reduce<Holder | undefined>(
      (holder, key) => preferred(holder, matches.get(key)),
      undefined,
    );
    if (found !== undefined) return { kind: 'receipt', seq: found.receipt.seq };
    if (
      value?.kind === 'ambiguous' ||
      (value !== undefined && unknownTime) ||
      (value?.kind === 'instant' && coarseMinutes.has(value.minute))
    )
      return { kind: 'ambiguous' };
    return { kind: 'missing' };
  };
}
