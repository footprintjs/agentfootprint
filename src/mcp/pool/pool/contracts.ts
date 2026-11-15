import type { DefinitionList } from '../definitions.js';
import type { PooledClient } from '../pooledClient.js';

/** An app lease, as the pool tracks it for `maxLeaseMs`. */
export interface HeldLease {
  readonly client: PooledClient;
  readonly takenAt: number;
  /** Revoked: its next use throws `lease-expired`. */
  revoked: boolean;
  /** Released: idempotent. */
  released: boolean;
}

/** Where a list's definitions live: a client's own, or a shared entry. */
export interface ServedList {
  readonly list: DefinitionList;
  readonly shared: boolean;
  /** The definitions context: `pc:` or `sh:`. */
  readonly context: string;
}

/** What a failed request proved about its client, if anything. */
export type RequestEvidenceOutcome = 'expired' | 'handle-lost' | undefined;
