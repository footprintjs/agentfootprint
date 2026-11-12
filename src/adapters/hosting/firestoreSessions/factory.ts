import { execute } from './execute.js';
import { fresh } from './run.js';
import {
  saveChart,
  hydrateChart,
  listChart,
  ownerChart,
  forgetChart,
  ownershipChart,
  closeChart,
} from './chart.js';
import type { StorePorts } from './call.js';

import type {
  CheckpointEnvelope,
  SessionListOptions,
  SessionListPage,
} from '../../../hosting/types.js';
import { ADAPTER, DEFAULT_SESSION_COLLECTION, EXPIRES_AT_FIELD } from './constants.js';

import { documentIdFor, assertCollectionName } from './address.js';
import { loadFirestoreSdk, buildClient } from './backend.js';
import { firestoreFailure } from './failure.js';
import { ttlPolicyCommand } from './retention.js';
import type {
  FirestoreSessionsOptions,
  FirestoreSessions,
  FirestoreLike,
  FirestoreCollectionLike,
  FirestoreDocumentReferenceLike,
  FirestoreDocumentSnapshotLike,
} from './types.js';
import type { SessionRunObserver } from './record.js';

export function buildStore(
  options: FirestoreSessionsOptions = {},
  _observe?: SessionRunObserver,
): FirestoreSessions {
  const collectionName = options.collection ?? DEFAULT_SESSION_COLLECTION;
  assertCollectionName(collectionName);

  // A pre-built client and connection settings are mutually exclusive. Accepting
  // both would mean silently ignoring one of them, and the one silently ignored
  // is always the one the caller was relying on.
  if (
    options.firestore !== undefined &&
    (options.project !== undefined || options.database !== undefined)
  ) {
    throw new TypeError(
      `${ADAPTER}: 'firestore' was given together with ` +
        `${options.project !== undefined ? "'project'" : "'database'"}. Those settings belong ` +
        `to whoever constructed the client, and this store cannot apply them to a client it ` +
        `did not build — so it refuses rather than accepting a connection option it will ` +
        `ignore. Pass the pre-built client alone, or let this store build one.`,
    );
  }

  const sdk = options._sdk ?? loadFirestoreSdk();
  // Remembered, because close() must terminate only a client this store opened.
  const ownsClient = options.firestore === undefined;
  // Which database the queries run against — known exactly when this store built
  // the client (an omitted `database` IS `(default)`, and gcloud needs to be told
  // so explicitly), and `undefined` when the caller passed a client in, because
  // that setting belongs to whoever constructed it and cannot be read back off
  // the handle. The index refusal prints one or the other; it never guesses.
  const databaseName = ownsClient ? options.database ?? '(default)' : undefined;
  const db: FirestoreLike = options.firestore ?? buildClient(sdk, options);
  const documentIdSentinel = sdk.FieldPath.documentId();

  const lifecycle = { closed: false };
  const open = (verb: string): void => {
    if (!lifecycle.closed) return;
    throw new Error(
      `[hosting] the ${ADAPTER} store for '${collectionName}' is closed, so it cannot ${verb}. ` +
        `close() is final by design — reconnecting behind you would hide a shutdown-ordering ` +
        `bug rather than surface it. Build a new store if you need one after closing this.`,
    );
  };

  const collection = (): FirestoreCollectionLike => db.collection(collectionName);
  const docFor = (sessionId: string): FirestoreDocumentReferenceLike =>
    collection().doc(documentIdFor(sessionId));

  /**
   * When this conversation should expire, or `null` for a store that was not
   * given a retention setting.
   *
   * Idle expiry, measured from the envelope's own `savedAt`: every turn moves
   * it, so a live conversation never expires underneath somebody.
   */
  const expiresAtFor = (savedAt: number): Date | null =>
    options.expireAfterMs === undefined || !Number.isFinite(options.expireAfterMs)
      ? null
      : new Date(savedAt + options.expireAfterMs);

  /** The stored row, read back without trusting any of its types. */
  const readRow = async (
    sessionId: string,
    operation: string,
  ): Promise<Record<string, unknown> | undefined> => {
    let snapshot: FirestoreDocumentSnapshotLike;
    try {
      snapshot = await docFor(sessionId).get();
    } catch (err) {
      throw firestoreFailure(operation, collectionName, err);
    }
    // `exists` is a PROPERTY on the real snapshot, and a missing document comes
    // back as a snapshot rather than as an error — so "no conversation" is read
    // here and never inferred from a failure.
    if (!snapshot.exists) return undefined;
    return snapshot.data();
  };

  const ports: StorePorts = {
    open,
    docFor,
    db,
    expiresAtFor,
    collectionName,
    readRow,
    collection,
    documentIdSentinel,
    databaseName,
    writeOwner: (tx, ref, row, owner) =>
      execute(
        ownershipChart,
        { ...fresh(), sessionId: row.sessionId as string, tx, ref, row, owner },
        _observe,
      ),
  };

  return {
    collection: collectionName,

    documentIdFor,

    async hydrate(sessionId: string): Promise<CheckpointEnvelope | undefined> {
      return execute(
        hydrateChart,
        { ...fresh(), ports, sessionId, verb: 'hydrate a session', operation: 'reading a session' },
        _observe,
      );
    },

    async persist(sessionId: string, envelope: CheckpointEnvelope): Promise<void> {
      return execute(saveChart, { ...fresh(), ports, sessionId, envelope }, _observe);
    },

    async listByUser(userId: string, listOptions?: SessionListOptions): Promise<SessionListPage> {
      return execute(
        listChart,
        { ...fresh(), ports, sessionId: '', userId, listOptions },
        _observe,
      );
    },

    async ownerOf(sessionId: string): Promise<string | undefined> {
      return execute(
        ownerChart,
        {
          ...fresh(),
          ports,
          sessionId,
          verb: 'read a session’s owner',
          operation: 'reading a session’s owner',
        },
        _observe,
      );
    },

    async forget(sessionId: string): Promise<void> {
      return execute(forgetChart, { ...fresh(), ports, sessionId }, _observe);
    },

    // ── Retention (9.42.0) ──────────────────────────────────────────────
    //
    // `'the-backend'`, and the honest answer rather than the convenient one.
    // This store COULD have offered a sweep — query the old documents, delete
    // them one at a time — and it would have been a worse answer at every
    // scale: a full index read plus one write per document, billed, repeated
    // nightly, to do a job the service already does for free and does not
    // charge a delete for. A port member exists so a caller can find out what
    // a store really does; a store that implemented the OTHER arm because it
    // was implementable would be answering a different question.
    //
    // It works on a closed store on purpose — it reads no document and calls
    // no SDK member. An operator asking "what expires these, and how do I turn
    // it on?" during a shutdown or an incident should get the answer, not the
    // refusal that guards the data plane.
    retention: () => ({
      deletedBy: 'the-backend' as const,
      // Whether this store is really stamping the field, which is a different
      // fact from whether the mechanism exists. Reported rather than implied:
      // "there is a TTL field" and "conversations are expiring" are the two
      // things an auditor must not be allowed to confuse.
      active: options.expireAfterMs !== undefined && Number.isFinite(options.expireAfterMs),
      expiresOn: EXPIRES_AT_FIELD,
      enableWith:
        `${ttlPolicyCommand(collectionName, databaseName)} — or Firestore console → ` +
        `Time-to-live (TTL) → Create policy, on collection '${collectionName}' and field ` +
        `'${EXPIRES_AT_FIELD}'. The policy deletes a document within 24 hours of the ` +
        `instant in that field; it is not a hard deadline and the service says so. ` +
        `Documents stored before 'expireAfterMs' was configured carry no such field and ` +
        `are never deleted by it — they expire only once they are written again.`,
    }),

    async close(): Promise<void> {
      return execute(closeChart, { ...fresh(), lifecycle, ownsClient, db }, _observe);
    },
  };
}
