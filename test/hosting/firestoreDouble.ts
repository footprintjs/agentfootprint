/**
 * An HONEST Firestore double — the shapes the real client returns, not the
 * shapes a test would find convenient.
 *
 * ── Why this file has a docstring at all ────────────────────────────────────
 * A double that returns something the real SDK never returns proves nothing.
 * This package has already paid for that once: a release shipped broken because
 * every double handed back an async iterable directly where the real client
 * returns a promise resolving to one, and the whole suite went green over a call
 * shape that could not work. So each decision below says WHY it is shaped the
 * way it is, and every line-numbered claim below was read out of
 * `@google-cloud/firestore` `types/firestore.d.ts` (9.0.0) — the same file the
 * surface pin was built from. Say where that file was: a scratch install OUTSIDE
 * this repository, because the package is deliberately not a devDependency here
 * (see the pin row's `notInstalled`). Nothing re-checks these line numbers on
 * this machine; they are provenance for a reader, not a guarantee.
 *
 * The six shapes that matter, and where they come from:
 *
 *  1. **`DocumentSnapshot.exists` is a PROPERTY** (`readonly exists: boolean`,
 *     line 1611), not `exists()`. And a missing document comes back as a
 *     snapshot with `exists === false` — `DocumentReference.get()` does NOT
 *     reject for an absent document. A double that threw would let an adapter
 *     that inferred "no conversation" from a failure pass.
 *
 *     **`id` is a property on both shapes for the same reason** — `readonly id:
 *     string` on `DocumentSnapshot` (line 1617) and on `DocumentReference` (line
 *     1442) — and the listing cursor reads the SNAPSHOT one, off a
 *     `QueryDocumentSnapshot`, which extends `DocumentSnapshot` (line 1667) and
 *     inherits it. An `id()` method here would put a function's source text
 *     where a document name belongs; four cursor tests catch that downstream,
 *     and one test beside them names the shape directly — which is the one that
 *     also covers `DocumentReference.id`, where no cursor ever looks.
 *  2. **`QuerySnapshot.docs` is a materialised ARRAY** (`readonly docs:
 *     Array<QueryDocumentSnapshot>`, line 2174) reached through a PROMISE from
 *     `Query.get()` (line 1914). Not an async iterable, not a stream. The SDK
 *     has `Query.stream()` for that and this adapter never calls it.
 *  3. **The query builder is SYNCHRONOUS and IMMUTABLE.** `where`, `orderBy`,
 *     `startAfter` and `limit` each return a NEW `Query` (the SDK's own
 *     docstrings say "returns a new (immutable) instance … rather than modify
 *     the existing instance"). A double that mutated in place would hide an
 *     adapter that forgot to reassign.
 *  4. **`Transaction.get` is async and `Transaction.set` is SYNCHRONOUS**,
 *     returning the transaction for chaining (lines 813 and 896). This is the
 *     asymmetry a convenient double gets wrong.
 *  5. **A transaction RETRIES.** The real service aborts a transaction whose
 *     read set was written underneath it and the client re-runs the whole
 *     function (`ReadWriteTransactionOptions.maxAttempts`, default 5). The
 *     double models that, because "ownership is established once" is a claim
 *     about concurrency and a double that never retried could not test it.
 *  6. **`startAfter` REFUSES a bad cursor synchronously.** For a documentId
 *     ordering on a collection query the client validates the value it was
 *     handed and throws from the BUILDER — a slash-bearing string is rejected as
 *     "must be a plain document ID" on the string branch, so what leaks is the
 *     caller's own cursor and not a project or database path. This is runtime
 *     validation, not a type, so unlike (1)–(5) it carries no line number: it is
 *     modelled because the adapter's cursor guard and its sanitising `try` are
 *     both claims about a builder that can throw, and a double that accepted
 *     anything could not test either.
 *
 * Nothing here reaches Google, and no credential is involved.
 */

import type {
  FirestoreCollectionLike,
  FirestoreDocumentReferenceLike,
  FirestoreDocumentSnapshotLike,
  FirestoreLike,
  FirestoreQueryLike,
  FirestoreQuerySnapshotLike,
  FirestoreSdkModule,
  FirestoreTransactionLike,
} from '../../src/adapters/hosting/firestoreSessions.js';

/** The sentinel `FieldPath.documentId()` answers. Identity is all it needs. */
export const DOCUMENT_ID_SENTINEL = { __documentId__: true } as const;

/** One stored row, keyed by document name. */
export type FakeStore = Map<string, Record<string, unknown>>;

/** How a fake failure is spelled — a gRPC error carries a NUMERIC `code`. */
export function grpcError(code: number, message = 'fake'): Error & { code: number } {
  const err = new Error(message) as Error & { code: number };
  err.code = code;
  return err;
}

/** Knobs a test turns to make the service misbehave on purpose. */
export interface FakeFirestoreOptions {
  /** Documents already in the collection, keyed by document name. */
  readonly seed?: FakeStore;
  /** Throw this from `Query.get()` — used for the missing-index refusal. */
  readonly failQueryWith?: unknown;
  /**
   * Throw this from `Query.startAfter()`.
   *
   * The builder is the one place in `listByUser` that can fail SYNCHRONOUSLY,
   * and it is reached with caller-supplied material (a pagination token). This
   * knob is how a test proves the builder sits inside the same sanitising `try`
   * as `get()` rather than beside it.
   */
  readonly failStartAfterWith?: unknown;
  /** Throw this from `DocumentReference.get()`. */
  readonly failReadWith?: unknown;
  /** Throw this from inside `runTransaction`. */
  readonly failWriteWith?: unknown;
  /**
   * Called ONCE, between a transaction's read and its write, with the store.
   * Models another container committing underneath us: whatever it writes makes
   * the transaction abort and re-run, exactly as the real client does.
   */
  readonly interleave?: (store: FakeStore) => void;
}

/** What a test can look at afterwards. */
export interface FakeFirestore {
  /** Pass as `firestoreSessions({ _sdk })`. */
  readonly sdk: FirestoreSdkModule;
  /** The documents, live. */
  readonly store: FakeStore;
  /** Every SDK member the adapter reached for, in order. */
  readonly calls: string[];
  /** How many times a transaction function was run (retries included). */
  attempts(): number;
  /** Was the client this store built ever terminated? */
  terminated(): boolean;
}

/**
 * Build the double.
 *
 * The returned `sdk` is shaped like the module — a `Firestore` CONSTRUCTOR and
 * a `FieldPath` with a static — because that is the seam the adapter loads. It
 * lets one double cover construction, the data plane and shutdown, rather than
 * three.
 */
export function fakeFirestore(options: FakeFirestoreOptions = {}): FakeFirestore {
  const store: FakeStore = options.seed ?? new Map();
  const calls: string[] = [];
  let attempts = 0;
  let terminated = false;
  let interleave = options.interleave;

  const snapshotOf = (id: string): FirestoreDocumentSnapshotLike => {
    const row = store.get(id);
    return {
      id,
      // A PROPERTY, computed at read time — the same as the real snapshot,
      // which is a value frozen at the moment of the read.
      exists: row !== undefined,
      data: () => (row === undefined ? undefined : { ...row }),
    };
  };

  const docRef = (id: string): FirestoreDocumentReferenceLike => ({
    id,
    get: () => {
      calls.push('DocumentReference.get');
      if (options.failReadWith !== undefined) return Promise.reject(options.failReadWith);
      // Resolves even when the document is absent — see shape (1).
      return Promise.resolve(snapshotOf(id));
    },
    delete: () => {
      calls.push('DocumentReference.delete');
      // Deleting an absent document SUCCEEDS in Firestore. A double that threw
      // would make the adapter's "idempotent forget" claim untestable.
      store.delete(id);
      return Promise.resolve({});
    },
  });

  /** The accumulated query state. Copied on every builder call — see shape (3). */
  interface QueryState {
    readonly owner?: string;
    readonly orderings: readonly ('savedAt' | 'docId')[];
    readonly after?: readonly unknown[];
    readonly limit?: number;
  }

  const buildQuery = (state: QueryState): FirestoreQueryLike => ({
    where: (fieldPath, opStr, value) => {
      calls.push('Query.where');
      if (opStr !== '==') throw new Error(`the double only models '==', not '${opStr}'`);
      if (fieldPath !== 'owner') throw new Error(`unexpected filter field '${fieldPath}'`);
      return buildQuery({ ...state, owner: String(value) });
    },
    orderBy: (fieldPath, directionStr) => {
      calls.push('Query.orderBy');
      if (directionStr !== 'desc') {
        throw new Error(`the double only models 'desc', not '${String(directionStr)}'`);
      }
      // The documentId ordering arrives as the SENTINEL, never as a string —
      // that is the whole reason `FieldPath.documentId()` exists.
      const key =
        fieldPath === DOCUMENT_ID_SENTINEL
          ? ('docId' as const)
          : fieldPath === 'savedAt'
          ? ('savedAt' as const)
          : (() => {
              throw new Error(`unexpected ordering '${String(fieldPath)}'`);
            })();
      return buildQuery({ ...state, orderings: [...state.orderings, key] });
    },
    startAfter: (...fieldValues) => {
      calls.push('Query.startAfter');
      if (options.failStartAfterWith !== undefined) throw options.failStartAfterWith;
      // The real client refuses a slash-bearing STRING here for a documentId
      // ordering, and it is worth being exact about which refusal that is: on a
      // COLLECTION query the string branch rejects it as "must be a plain
      // document ID" — it is NOT read as a path and no project or database name
      // is involved. It throws SYNCHRONOUSLY, out of the builder rather than out
      // of `get()`, which is the shape that matters to the adapter.
      for (const value of fieldValues) {
        if (typeof value === 'string' && value.includes('/')) {
          throw new Error('Value for argument "documentIdFieldValue" must be a plain document ID');
        }
      }
      return buildQuery({ ...state, after: fieldValues });
    },
    limit: (n) => {
      calls.push('Query.limit');
      return buildQuery({ ...state, limit: n });
    },
    get: (): Promise<FirestoreQuerySnapshotLike> => {
      calls.push('Query.get');
      if (options.failQueryWith !== undefined) return Promise.reject(options.failQueryWith);

      let rows = [...store.entries()].filter(
        ([, row]) => state.owner !== undefined && row['owner'] === state.owner,
      );
      // savedAt DESC, then document name DESC — the order the adapter asks for,
      // implemented rather than assumed, so a cursor bug shows up as a skipped
      // or repeated row instead of passing by luck.
      rows.sort(([leftId, left], [rightId, right]) => {
        const bySaved = Number(right['savedAt'] ?? 0) - Number(left['savedAt'] ?? 0);
        return bySaved !== 0 ? bySaved : rightId.localeCompare(leftId);
      });
      if (state.after !== undefined) {
        const [afterSaved, afterId] = state.after as [number, string];
        rows = rows.filter(([id, row]) => {
          const saved = Number(row['savedAt'] ?? 0);
          return saved < afterSaved || (saved === afterSaved && id.localeCompare(afterId) < 0);
        });
      }
      if (state.limit !== undefined) rows = rows.slice(0, state.limit);
      // An ARRAY inside a PROMISE — see shape (2).
      return Promise.resolve({ docs: rows.map(([id]) => snapshotOf(id)) });
    },
  });

  const collection = (name: string): FirestoreCollectionLike => {
    calls.push('Firestore.collection');
    if (name.includes('/')) throw new Error(`the double refuses a path: '${name}'`);
    return {
      ...buildQuery({ orderings: [] }),
      doc: (id: string) => {
        calls.push('CollectionReference.doc');
        // The real client refuses a slash here, and this adapter's whole
        // hashing scheme exists so that never happens.
        if (id.includes('/')) throw new Error(`the double refuses a document path: '${id}'`);
        return docRef(id);
      },
    };
  };

  const db: FirestoreLike = {
    collection,
    runTransaction: async <T>(fn: (tx: FirestoreTransactionLike) => Promise<T>): Promise<T> => {
      calls.push('Firestore.runTransaction');
      if (options.failWriteWith !== undefined) throw options.failWriteWith;

      // The real client re-runs the function when the read set was written
      // underneath it. Five attempts is the SDK's own default.
      for (let attempt = 0; attempt < 5; attempt++) {
        attempts += 1;
        const readVersions = new Map<string, unknown>();
        const staged: [string, Record<string, unknown>][] = [];
        const tx: FirestoreTransactionLike = {
          get: (ref) => {
            calls.push('Transaction.get');
            readVersions.set(ref.id, store.get(ref.id));
            return Promise.resolve(snapshotOf(ref.id));
          },
          // SYNCHRONOUS, and answers the transaction — see shape (4).
          set: (ref, data) => {
            calls.push('Transaction.set');
            staged.push([ref.id, data]);
            return tx;
          },
        };

        const result = await fn(tx);

        // Somebody else's turn, committed between our read and our commit.
        if (interleave !== undefined) {
          const run = interleave;
          interleave = undefined;
          run(store);
        }

        const conflicted = [...readVersions.entries()].some(([id, seen]) => store.get(id) !== seen);
        if (conflicted) continue;

        for (const [id, data] of staged) store.set(id, { ...data });
        return result;
      }
      throw grpcError(10, 'ABORTED: too much contention');
    },
    terminate: () => {
      calls.push('Firestore.terminate');
      terminated = true;
      return Promise.resolve();
    },
  };

  const sdk: FirestoreSdkModule = {
    // A CONSTRUCTOR, because that is what the adapter reaches for. The settings
    // it was built with are recorded verbatim, so a test can assert that
    // `project` and `database` really arrive at the client rather than being
    // accepted and dropped.
    Firestore: function FakeFirestoreClient(settings?: Record<string, unknown>): FirestoreLike {
      calls.push(`new Firestore(${JSON.stringify(settings ?? {})})`);
      return db;
    } as unknown as FirestoreSdkModule['Firestore'],
    FieldPath: { documentId: () => DOCUMENT_ID_SENTINEL },
  };

  return { sdk, store, calls, attempts: () => attempts, terminated: () => terminated };
}
