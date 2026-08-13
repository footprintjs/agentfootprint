/**
 * artifacts/retention — the one owner of the eviction law.
 *
 * Three adapters, one rule for what leaves a scope and why. Each adapter
 * supplies its rows; this module decides — a pure plan over plain facts, so
 * the law is testable without a store and cannot fork into three dialects.
 *
 * The policy is three independent dials, all per scope:
 *   • `ttlMs`           — every artifact gets `expiresAt = createdAt + ttl`
 *                         stamped AT MINT (expiry is stated, never sprung),
 *                         and expired rows are swept when the scope is next
 *                         touched by a put.
 *   • `maxBytesPerScope`— a byte budget; least-recently-ACCESSED leaves first
 *                         (an artifact under active render must not be the
 *                         next one evicted — the innerRunRecords recency law).
 *   • `maxCountPerScope`— a row budget, same eviction order.
 *
 * Every eviction is a FACT the plan returns ({@link SweptArtifact}), because
 * the put that triggered it reports them upward and the capability layer puts
 * each one on the record. A store that made room silently would be lying by
 * omission.
 *
 * A payload bigger than the whole byte budget is REFUSED at the door (the
 * plan says so; the adapter throws by name) — evicting an entire scope to
 * admit one oversized object would trade everything for something that may
 * itself not fit.
 */

import type { ArtifactSweepReason, SweptArtifact } from './types.js';

/** The three dials. All optional; absent means that dial does not bind. */
export interface ArtifactRetention {
  /** Lifetime stamped onto every mint as `expiresAt` (unix ms after createdAt). */
  readonly ttlMs?: number;
  /** Byte budget per scope. */
  readonly maxBytesPerScope?: number;
  /** Row budget per scope. */
  readonly maxCountPerScope?: number;
}

/** The facts the planner needs about one held artifact. */
export interface RetainedRow {
  readonly ref: string;
  readonly kind: string;
  readonly bytes: number;
  readonly expiresAt?: number;
  /** Recency — refreshed by get/head, so eviction spares what is in use. */
  readonly lastAccessedAt: number;
}

/** What a put must do to the scope before it may admit the incoming bytes. */
export interface RetentionPlan {
  /** Rows to remove, in order, each with its reason. */
  readonly swept: readonly SweptArtifact[];
  /** When defined, the put must be REFUSED with this sentence instead. */
  readonly refusal?: string;
}

/**
 * Validate a retention policy at construction — a dial that cannot bind
 * (zero, negative, NaN) is refused where it was written, not discovered as
 * an always-empty store at the first put.
 */
export function assertRetention(adapter: string, retention: ArtifactRetention | undefined): void {
  if (retention === undefined) return;
  const dials: ReadonlyArray<[string, number | undefined]> = [
    ['ttlMs', retention.ttlMs],
    ['maxBytesPerScope', retention.maxBytesPerScope],
    ['maxCountPerScope', retention.maxCountPerScope],
  ];
  for (const [name, value] of dials) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(
        `[artifacts] ${adapter}: retention.${name} = ${String(value)} cannot bind. ` +
          `Each dial is a positive number, or absent — omitting it is how "no limit" is said.`,
      );
    }
  }
}

/**
 * Plan what must leave a scope so that `incomingBytes` may enter.
 *
 * Pure: reads rows, returns facts, mutates nothing. Rows may arrive in any
 * order; eviction order here is least-recently-accessed first.
 */
export function planRetention(
  rows: readonly RetainedRow[],
  incomingBytes: number,
  retention: ArtifactRetention | undefined,
  now: number,
): RetentionPlan {
  const swept: SweptArtifact[] = [];
  const sweep = (row: RetainedRow, reason: ArtifactSweepReason): void => {
    swept.push({ ref: row.ref, reason, kind: row.kind, bytes: row.bytes });
  };

  // 1 — the calendar: expired rows leave regardless of budgets.
  const live: RetainedRow[] = [];
  for (const row of rows) {
    if (row.expiresAt !== undefined && row.expiresAt <= now) sweep(row, 'ttl');
    else live.push(row);
  }

  if (retention === undefined) return { swept };

  const { maxBytesPerScope, maxCountPerScope } = retention;
  if (maxBytesPerScope !== undefined && incomingBytes > maxBytesPerScope) {
    return {
      swept,
      refusal:
        `the payload is ${incomingBytes} bytes and this store's byte budget per scope is ` +
        `${maxBytesPerScope}. Evicting everything else would not make it fit, so it is ` +
        `refused instead of admitted by force. Store something smaller, or build the ` +
        `store with a larger maxBytesPerScope.`,
    };
  }

  // Least-recently-accessed first — ties broken by ref for determinism.
  live.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt || (a.ref < b.ref ? -1 : 1));

  // 2 — the row budget (the incoming row occupies one slot).
  if (maxCountPerScope !== undefined) {
    let count = live.length + 1;
    while (count > maxCountPerScope && live.length > 0) {
      sweep(live.shift() as RetainedRow, 'max-count');
      count--;
    }
  }

  // 3 — the byte budget (the incoming bytes already proved they can fit).
  if (maxBytesPerScope !== undefined) {
    let total = live.reduce((sum, row) => sum + row.bytes, 0) + incomingBytes;
    while (total > maxBytesPerScope && live.length > 0) {
      const evicted = live.shift() as RetainedRow;
      sweep(evicted, 'max-bytes');
      total -= evicted.bytes;
    }
  }

  return { swept };
}

/**
 * The `expiresAt` a mint gets: the caller's own statement and the store's
 * ttl, whichever comes SOONER. A store may tighten a promise, never extend
 * one — extending would overrule the only party who knows the data.
 */
export function resolveExpiresAt(
  callerExpiresAt: number | undefined,
  retention: ArtifactRetention | undefined,
  now: number,
): number | undefined {
  const fromTtl = retention?.ttlMs !== undefined ? now + retention.ttlMs : undefined;
  if (callerExpiresAt === undefined) return fromTtl;
  if (fromTtl === undefined) return callerExpiresAt;
  return Math.min(callerExpiresAt, fromTtl);
}
