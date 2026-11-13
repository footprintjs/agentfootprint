import type { DecisionResult } from 'footprintjs';
import type { CheckpointEnvelope, SessionListOptions } from '../../../hosting/types.js';
import type {
  FirestoreCollectionLike,
  FirestoreDocumentReferenceLike,
  FirestoreLike,
  FirestoreQuerySnapshotLike,
  FirestoreTransactionLike,
} from './types.js';

export interface Facts {
  failed: boolean;
  reason: string;
  bytes?: number;
  envelopeLimit?: number;
  present?: boolean;
  cursorRecognized?: boolean;
}

export interface Outcome {
  failed: boolean;
  error?: unknown;
  value?: unknown;
  bytes?: number;
  reason?: string;
}

/** Live infrastructure and caller data never enter the tracked scope. */
export interface StorePorts {
  readonly open: (verb: string) => void;
  readonly db: FirestoreLike;
  readonly collectionName: string;
  readonly databaseName?: string;
  readonly documentIdSentinel: unknown;
  readonly docFor: (sessionId: string) => FirestoreDocumentReferenceLike;
  readonly collection: () => FirestoreCollectionLike;
  readonly expiresAtFor: (savedAt: number) => Date | null;
  readonly readRow: (
    sessionId: string,
    operation: string,
  ) => Promise<Record<string, unknown> | undefined>;
  readonly writeOwner: (
    tx: FirestoreTransactionLike,
    ref: FirestoreDocumentReferenceLike,
    row: Record<string, unknown>,
    owner: string | undefined,
  ) => Promise<void>;
}
export interface Call extends Outcome {
  ports: StorePorts;
  sessionId: string;
}
export interface SaveCall extends Call {
  envelope: CheckpointEnvelope;
  sizeDecision?: DecisionResult;
}
export interface ReadCall extends Call {
  verb: string;
  operation: string;
  row?: Record<string, unknown>;
}
export interface ListCall extends Call {
  userId: string;
  listOptions?: SessionListOptions;
  limit?: number;
  cursorRecognized?: boolean;
  snapshot?: FirestoreQuerySnapshotLike;
}
export interface OwnershipCall extends Outcome {
  sessionId: string;
  tx: FirestoreTransactionLike;
  ref: FirestoreDocumentReferenceLike;
  row: Record<string, unknown>;
  owner: string | undefined;
  existingOwner?: string;
  keptOwner?: string;
}

export interface CloseCall extends Outcome {
  lifecycle: { closed: boolean };
  ownsClient: boolean;
  db: FirestoreLike;
}
