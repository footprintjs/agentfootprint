/**
 * InMemoryStore — reference `MemoryStore` implementation, zero dependencies.
 *
 * Kept deliberately small — ~200 lines. Its job is to validate the
 * interface contract: every stage and pipeline is tested against this
 * adapter, so any bug in the store shape surfaces here first.
 *
 * Internal structure:
 *   namespace (string) → Map<entryId, MemoryEntry>
 *                      + Set<signature>    (for seen)
 *                      + Map<id, usefulnessSum, usefulnessCount>  (for feedback)
 *
 * TTL is enforced lazily on read (cheapest; no background sweeper needed).
 * Pagination cursor is a monotonic integer — entries sorted by updatedAt desc.
 */
import type { MemoryIdentity } from '../identity';
import { identityNamespace } from '../identity';
import type { MemoryEntry } from '../entry';
import type { ListOptions, ListResult, MemoryStore, PutIfVersionResult } from './types';

interface NamespaceSlot {
  readonly entries: Map<string, MemoryEntry>;
  readonly seenSignatures: Set<string>;
  readonly feedbackStats: Map<string, { sum: number; count: number }>;
}

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;

export class InMemoryStore implements MemoryStore {
  /**
   * Top-level namespace → slot. Using `Map` rather than a plain object
   * avoids prototype-pollution surface AND preserves insertion order
   * (needed for deterministic list pagination).
   */
  private readonly namespaces = new Map<string, NamespaceSlot>();

  private slot(identity: MemoryIdentity): NamespaceSlot {
    const ns = identityNamespace(identity);
    let s = this.namespaces.get(ns);
    if (!s) {
      s = {
        entries: new Map(),
        seenSignatures: new Set(),
        feedbackStats: new Map(),
      };
      this.namespaces.set(ns, s);
    }
    return s;
  }

  /** True if the entry's TTL has elapsed. Centralized so both `get` and `list` agree. */
  private isExpired(entry: MemoryEntry): boolean {
    return typeof entry.ttl === 'number' && entry.ttl <= Date.now();
  }

  async get<T = unknown>(identity: MemoryIdentity, id: string): Promise<MemoryEntry<T> | null> {
    const slot = this.slot(identity);
    const entry = slot.entries.get(id);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      // TTL expired — evict lazily so the memory footprint follows usage.
      slot.entries.delete(id);
      return null;
    }
    // Bump decay signals — every read counts as an access. This is a write
    // via copy (MemoryEntry is immutable in spirit); we reassign the map.
    const bumped: MemoryEntry = {
      ...entry,
      accessCount: entry.accessCount + 1,
      lastAccessedAt: Date.now(),
    };
    slot.entries.set(id, bumped);
    return bumped as MemoryEntry<T>;
  }

  async put<T = unknown>(identity: MemoryIdentity, entry: MemoryEntry<T>): Promise<void> {
    const slot = this.slot(identity);
    slot.entries.set(entry.id, entry as MemoryEntry);
  }

  /**
   * Batched write — resolves the slot once and writes each entry into the
   * same Map. Saves N-1 slot lookups vs. calling `put()` in a loop, and
   * gives network-backed adapters a place to pipeline round-trips.
   */
  async putMany<T = unknown>(
    identity: MemoryIdentity,
    entries: readonly MemoryEntry<T>[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const slot = this.slot(identity);
    for (const entry of entries) {
      slot.entries.set(entry.id, entry as MemoryEntry);
    }
  }

  async putIfVersion<T = unknown>(
    identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    expectedVersion: number,
  ): Promise<PutIfVersionResult> {
    const slot = this.slot(identity);
    const existing = slot.entries.get(entry.id);

    // First-write path: expectedVersion === 0 means "I expect no prior entry".
    if (!existing || this.isExpired(existing)) {
      if (expectedVersion === 0) {
        slot.entries.set(entry.id, entry as MemoryEntry);
        return { applied: true };
      }
      return { applied: false };
    }

    if (existing.version !== expectedVersion) {
      return { applied: false, currentVersion: existing.version };
    }

    slot.entries.set(entry.id, entry as MemoryEntry);
    return { applied: true };
  }

  async list<T = unknown>(identity: MemoryIdentity, options?: ListOptions): Promise<ListResult<T>> {
    const slot = this.slot(identity);
    const limit = Math.min(options?.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const tierFilter = options?.tiers ? new Set(options.tiers) : undefined;

    // Collect non-expired matching entries, sorted by updatedAt desc
    // (most-recently-updated first — matches typical UX expectations).
    const all: MemoryEntry[] = [];
    for (const entry of slot.entries.values()) {
      if (this.isExpired(entry)) continue;
      if (tierFilter && (!entry.tier || !tierFilter.has(entry.tier))) continue;
      all.push(entry);
    }
    all.sort((a, b) => b.updatedAt - a.updatedAt);

    // Cursor is the integer offset into the sorted array. Not terribly
    // efficient for huge namespaces, but this is the reference store —
    // real backends (DynamoDB, Postgres) use their native cursors.
    const offset = options?.cursor ? parseInt(options.cursor, 10) : 0;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
    const page = all.slice(safeOffset, safeOffset + limit);
    const next = safeOffset + page.length;

    return {
      entries: page as MemoryEntry<T>[],
      cursor: next < all.length ? String(next) : undefined,
    };
  }

  async delete(identity: MemoryIdentity, id: string): Promise<void> {
    const slot = this.slot(identity);
    slot.entries.delete(id);
    slot.feedbackStats.delete(id);
    // Note: we do NOT purge from `seenSignatures` — the identity still
    // recognizes the content even if the full entry has been deleted.
  }

  async seen(identity: MemoryIdentity, signature: string): Promise<boolean> {
    return this.slot(identity).seenSignatures.has(signature);
  }

  async recordSignature(identity: MemoryIdentity, signature: string): Promise<void> {
    this.slot(identity).seenSignatures.add(signature);
  }

  async feedback(identity: MemoryIdentity, id: string, usefulness: number): Promise<void> {
    // Reject non-finite values — a NaN / Infinity in the aggregate
    // permanently poisons every future read from that slot.
    if (!Number.isFinite(usefulness)) return;
    const slot = this.slot(identity);
    // Clamp to the documented range so a rogue caller can't skew the mean.
    const clamped = Math.max(-1, Math.min(1, usefulness));
    const existing = slot.feedbackStats.get(id);
    if (existing) {
      slot.feedbackStats.set(id, {
        sum: existing.sum + clamped,
        count: existing.count + 1,
      });
    } else {
      slot.feedbackStats.set(id, { sum: clamped, count: 1 });
    }
  }

  async getFeedback(
    identity: MemoryIdentity,
    id: string,
  ): Promise<{ average: number; count: number } | null> {
    const stats = this.slot(identity).feedbackStats.get(id);
    if (!stats || stats.count === 0) return null;
    return { average: stats.sum / stats.count, count: stats.count };
  }

  async forget(identity: MemoryIdentity): Promise<void> {
    this.namespaces.delete(identityNamespace(identity));
  }
}
