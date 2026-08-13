/**
 * artifacts/inMemoryArtifacts — the claim-check store in a Map.
 *
 * For tests, local development, and single-process agents whose artifacts may
 * die with the process. Exactly as durable as the process — which is the
 * point of the port: swap the one argument for `fileArtifacts` or
 * `sqliteArtifacts` and nothing else changes.
 *
 * ── Bounded, and counting its drops (the innerRunRecords laws) ─────────────
 * A retained payload is retained memory, and an agent minting a dataset per
 * turn for a week would otherwise pin every one of them — the failure would
 * look like a leak rather than like a feature. So this adapter is ALWAYS
 * bounded: it has a default byte budget and row budget per scope, an explicit
 * retention only replaces those dials, and there is deliberately no spelling
 * for "unbounded" here — a memory store without a ceiling is a leak wearing
 * configuration. When the budget forces an eviction the least-recently-USED
 * artifact leaves first (reading refreshes recency, so the dataset a chart is
 * actively rendered from is not the next casualty), every eviction is
 * reported by the `put` that caused it, and `dropped` COUNTS them — "we kept
 * the last 200 of 340" is an answer a debugging session can act on; a
 * silently missing ref is not.
 */

import { identityNamespace } from '../memory/identity/index.js';
import { prepareArtifact } from './minting.js';
import { isArtifactRef } from './naming.js';
import {
  computeArtifactDigest,
  decodeArtifactData,
  encodeArtifactData,
  type EncodedPayload,
} from './payload.js';
import {
  assertRetention,
  planRetention,
  type ArtifactRetention,
  type RetainedRow,
} from './retention.js';
import {
  ArtifactIntegrityError,
  InvalidArtifactError,
  type ArtifactListOptions,
  type ArtifactListResult,
  type ArtifactMeta,
  type ArtifactPutResult,
  type ArtifactRecord,
  type ArtifactRef,
  type ArtifactScope,
  type ArtifactStore,
} from './types.js';

/** The always-on bounds. Override dials via `retention`; there is no "off". */
export const DEFAULT_IN_MEMORY_ARTIFACT_RETENTION: Required<
  Pick<ArtifactRetention, 'maxBytesPerScope' | 'maxCountPerScope'>
> = {
  /** 32 MiB per scope — a working set, not an archive. */
  maxBytesPerScope: 32 * 1024 * 1024,
  /** 256 artifacts per scope. */
  maxCountPerScope: 256,
};

/** Options for {@link inMemoryArtifacts}. */
export interface InMemoryArtifactsOptions {
  /**
   * Retention dials. Merged OVER the defaults — name a dial to change it;
   * the byte and row budgets always exist (see the header for why).
   */
  readonly retention?: ArtifactRetention;
  /** @internal Test seam — the clock. Defaults to `Date.now`. */
  readonly _now?: () => number;
}

/** The in-memory store, plus the accounting a bounded store owes its owner. */
export interface InMemoryArtifacts extends ArtifactStore {
  /** Artifacts evicted by the byte/row budgets since construction (TTL expiry
   *  is the calendar doing its job and is not counted here). Non-zero means
   *  "resolve sooner, or raise the budget". */
  readonly dropped: number;
  /** The dials in force, defaults included. */
  readonly retention: ArtifactRetention;
}

interface StoredArtifact {
  meta: ArtifactMeta;
  /** The ENCODED envelope, exactly as the durable adapters persist — one law
   *  for all three. Holding the caller's live reference instead would let a
   *  post-put mutation silently change what the store returns (the checked-in
   *  parcel must be the parcel handed back), and decoding fresh per get keeps
   *  callers from mutating each other through a shared returned object. */
  payload: EncodedPayload;
  lastAccessedAt: number;
}

/**
 * A bounded, drop-counting, per-scope-isolated artifact store in process
 * memory.
 *
 * @example
 *   const store = inMemoryArtifacts({ retention: { ttlMs: 15 * 60_000 } });
 *   const agent = Agent.create({ provider, artifacts: store });
 */
export function inMemoryArtifacts(options: InMemoryArtifactsOptions = {}): InMemoryArtifacts {
  assertRetention('inMemoryArtifacts', options.retention);
  const retention: ArtifactRetention = {
    ...DEFAULT_IN_MEMORY_ARTIFACT_RETENTION,
    ...options.retention,
  };
  const now = options._now ?? Date.now;
  /** namespace → (ref → row). Insertion order is NOT recency; rows carry it. */
  const scopes = new Map<string, Map<ArtifactRef, StoredArtifact>>();
  let dropped = 0;

  const shelf = (scope: ArtifactScope): Map<ArtifactRef, StoredArtifact> => {
    const ns = identityNamespace(scope);
    let held = scopes.get(ns);
    if (held === undefined) {
      held = new Map();
      scopes.set(ns, held);
    }
    return held;
  };

  /** Resolve a live row, sweeping it when the calendar says it is gone. */
  const liveRow = (scope: ArtifactScope, ref: ArtifactRef): StoredArtifact | undefined => {
    if (!isArtifactRef(ref)) return undefined;
    const held = shelf(scope);
    const row = held.get(ref);
    if (row === undefined) return undefined;
    if (row.meta.expiresAt !== undefined && row.meta.expiresAt <= now()) {
      held.delete(ref);
      return undefined;
    }
    return row;
  };

  return {
    get dropped(): number {
      return dropped;
    },
    retention,

    async put(scope, input): Promise<ArtifactPutResult> {
      const held = shelf(scope);
      const at = now();
      const { meta } = await prepareArtifact(
        input,
        (parent) => liveRow(scope, parent) !== undefined,
        retention,
        at,
      );
      const rows: RetainedRow[] = [...held.values()].map((row) => ({
        ref: row.meta.ref,
        kind: row.meta.kind,
        bytes: row.meta.bytes,
        ...(row.meta.expiresAt !== undefined && { expiresAt: row.meta.expiresAt }),
        lastAccessedAt: row.lastAccessedAt,
      }));
      const plan = planRetention(rows, meta.bytes, retention, at);
      if (plan.refusal !== undefined) throw new InvalidArtifactError(plan.refusal);
      for (const swept of plan.swept) {
        held.delete(swept.ref);
        if (swept.reason !== 'ttl') dropped++;
      }
      held.set(meta.ref, { meta, payload: encodeArtifactData(input.data), lastAccessedAt: at });
      return { meta, swept: plan.swept };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async head(scope, ref): Promise<ArtifactMeta | null> {
      const row = liveRow(scope, ref);
      if (row === undefined) return null;
      row.lastAccessedAt = now();
      return row.meta;
    },

    async get(scope, ref): Promise<ArtifactRecord | null> {
      const row = liveRow(scope, ref);
      if (row === undefined) return null;
      row.lastAccessedAt = now();
      const data = decodeArtifactData(row.payload);
      if (row.meta.digest !== undefined) {
        const actual = await computeArtifactDigest(data);
        if (actual !== row.meta.digest) {
          throw new ArtifactIntegrityError(row.meta.ref, row.meta.digest, actual);
        }
      }
      return { meta: row.meta, data };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async delete(scope, ref): Promise<void> {
      if (!isArtifactRef(ref)) return;
      shelf(scope).delete(ref);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async list(scope, listOptions?: ArtifactListOptions): Promise<ArtifactListResult> {
      const at = now();
      const held = shelf(scope);
      // Sweep-on-access: an expired row is "no data" everywhere, lists included.
      for (const [ref, row] of held) {
        if (row.meta.expiresAt !== undefined && row.meta.expiresAt <= at) held.delete(ref);
      }
      const all = [...held.values()]
        .map((row) => row.meta)
        .sort((a, b) => b.createdAt - a.createdAt || (a.ref < b.ref ? -1 : 1));
      const offset = decodeCursor(listOptions?.cursor);
      const limit = Math.max(1, Math.floor(listOptions?.limit ?? 50));
      const page = all.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return {
        artifacts: page,
        ...(nextOffset < all.length && { cursor: String(nextOffset) }),
      };
    },
  };
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}
