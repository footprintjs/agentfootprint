import type { CacheCommandReason } from '../../../provider-contract/requestObserver.js';

/**
 * One `cache_control` breakpoint the cache strategy actually APPLIED — three
 * scalars, no bytes.
 *
 * `cache.transformHash` collapses a whole rewrite into one bit ("something
 * changed"), and a digest over the whole prepared request is not comparable
 * across epochs. The question that decides an Anthropic bill is narrower and
 * concrete: *did the breakpoints move between call 3 and call 4?* Two receipts'
 * `markersApplied` answer it by inspection.
 *
 * APPLIED, not offered: `scope.cacheMarkers` holds the CANDIDATES the strategy
 * was given, and a strategy clamps them to what the provider allows. The
 * candidates are on the record; which survived is not, which is why they ride
 * here.
 *
 * @example did the breakpoints move between two turns?
 * ```ts
 * import { receiptAt } from 'agentfootprint';
 *
 * const at = (k: number) =>
 *   JSON.stringify(receiptAt(agent.getSnapshot()!, k)?.cache.markersApplied);
 * at(3) === at(4); // false ⇒ the cached prefix moved, and the bill with it
 * ```
 */
export interface ReceiptCacheMarker {
  readonly field: 'system' | 'tools' | 'messages';
  readonly boundaryIndex: number;
  readonly ttl: 'short' | 'long';
}

/** A prepared SDK command, numbered within this one receipt. No transport claim. */
export interface ReceiptCacheCommand {
  readonly ordinal: number;
  readonly operation: 'Converse' | 'ConverseStream';
  readonly reason: CacheCommandReason;
  readonly points: number;
  readonly wire: 'unknown';
  readonly fallbackFrom?: number;
}
