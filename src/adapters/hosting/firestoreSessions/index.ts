import { buildStore } from './factory.js';
/**
 * firestoreSessions — conversations in Firestore, so a fleet shares them and
 * nobody runs a database.
 *
 * The ladder this rung sits on is already in the package. `memorySessions()`
 * loses everything on restart and says so. `sqliteSessions()` survives a restart
 * on ONE machine and says so. `agentEngineSessions()` is a fleet store, but only
 * for people who already own a Vertex reasoning engine. Firestore is the row for
 * everyone else on this column: a serverless document database with no instance
 * to size, no connection pool to tune, and a free tier — the plainest "many
 * containers, one conversation" answer Google has.
 *
 * ── The shape, said plainly ─────────────────────────────────────────────────
 * One collection. One document per session. Seven fields:
 *
 *   sessionId · format · savedAt · envelope · owner · messageCount · expiresAt
 *
 * That is the SQLite table, moved. It is deliberately the same shape, because
 * the two stores implement the same port under the same laws, and a reader who
 * has understood one should not have to learn a second model to audit the other.
 *
 * The envelope rides as a JSON **string**, not as a nested map, and that is a
 * decision rather than laziness. A `CheckpointEnvelope` carries arbitrary
 * conversation JSON: keys chosen by a model's tool call, values that may be
 * `undefined`, arrays inside arrays. Firestore refuses all three — a field name
 * may not contain a dot, a tilde, a star, a slash, a bracket or a backtick;
 * `undefined` throws unless the client was
 * built with `ignoreUndefinedProperties`, and a directly nested array is not a
 * representable value. Serialising once at the edge makes every one of those a
 * non-event, at the cost of not being able to query INSIDE a conversation —
 * which no caller of this port has ever asked to do.
 *
 * ── Why the document id is a hash ───────────────────────────────────────────
 * A `sessionId` in this library is OPAQUE. It may be a UUID, an upstream
 * gateway's correlation id, a path-shaped tenant key, or a unicode string a
 * person typed. Firestore document names have rules: no `/`, not `.` or `..`,
 * not matching `__.*__`, and at most 1500 bytes. A session id that broke any of
 * them would fail at the wire on the one turn it mattered — or worse, two ids
 * that differ only past a truncation point would silently become ONE
 * conversation.
 *
 * So the document name is `sha256(domain + NUL + sessionId)` in hex — 64
 * characters, always legal, injective for every input anybody will ever have.
 * The raw id is stored in the `sessionId` FIELD, so a listing can hand it back
 * and a console reader can still see whose document they are looking at.
 *
 * **This is not encryption, and it is important not to read it as any.** The
 * conversation itself is stored in the clear; the hash is an addressing scheme,
 * not a confidentiality control. Anyone who can read the collection can read
 * every conversation in it, and the `sessionId` field beside the hash spells out
 * the id the hash was made from. Two things it DOES cost an operator, stated
 * because they are discovered at the worst moment otherwise:
 *
 *   • you cannot look a session up in the Firestore console by typing its raw
 *     id — you have to query `sessionId == '…'`, or hash it yourself;
 *   • a document name carries no information a human can sort or scan by.
 *
 * Encryption at rest is Google's (always on, and configurable with CMEK).
 * Access control is IAM's. Neither is this adapter's, and neither is implied by
 * the hash.
 *
 * ── The composite index, and the error you get without it ───────────────────
 * `listByUser` runs one server-side query — an equality on `owner`, ordered by
 * `savedAt` descending, paged with a real Firestore cursor. Firestore's
 * automatic single-field indexes do NOT serve that shape: an equality filter on
 * one field ordered by another needs a COMPOSITE index, and until it exists the
 * query fails with gRPC status 9, `FAILED_PRECONDITION`.
 *
 * The index, exactly:
 *
 *   collection group : <your collection>   (default: agentfootprint_sessions)
 *   fields           : owner    Ascending
 *                      savedAt  Descending
 *                      __name__ Descending
 *
 * `__name__` is Firestore's document-name field. It is the tiebreaker this
 * adapter orders by explicitly (see {@link FirestoreSessions.listByUser}), and
 * an index's trailing `__name__` takes the direction of the last ordered field —
 * so a console-generated index for `owner ASC, savedAt DESC` is the right one.
 *
 *   gcloud firestore indexes composite create \
 *     --collection-group=agentfootprint_sessions \
 *     --field-config=field-path=owner,order=ascending \
 *     --field-config=field-path=savedAt,order=descending \
 *     --database='(default)'
 *
 * `--database` is spelled out rather than left to gcloud's default, and it must
 * match the `database` this store was built with. gcloud assumes `(default)` when
 * the flag is absent, so an operator on a NAMED database who follows a command
 * without it creates the index somewhere else and gets the identical failure
 * back, with nothing to suggest why.
 *
 * When the index is missing this adapter raises {@link FirestoreIndexMissingError},
 * which prints that same line with your collection and database already filled
 * in, and names those fields rather than restating the service's message — see
 * {@link firestoreFailure} for why no Google text is ever echoed here.
 *
 * ── Retention: a SECOND timestamp, not a converted one (9.42.0) ─────────────
 * A native Firestore TTL policy deletes a document when a field of type
 * **Timestamp** is in the past. `savedAt` is a NUMBER — epoch milliseconds —
 * so until this release an operator could not point a policy at this
 * collection at all without a library change. The fix is a second field,
 * `expiresAt`, written as a `Date` (the client stores one as a Timestamp) on
 * every persist, holding `savedAt + expireAfterMs`. Give the store no
 * `expireAfterMs` and the field is written as `null`, which a TTL policy
 * ignores, and nothing about this release changes.
 *
 * **`savedAt` was NOT converted, and that is the load-bearing decision.** It is
 * the ordering key of the composite index, the field the listing sorts by, and
 * the first half of every cursor this store has ever minted (`<savedAt>:<docId>`,
 * parsed with `parseFloat` and handed back to `startAfter` as a number).
 * Converting it would have meant a new index, a new cursor grammar, and every
 * pagination token issued by an earlier release becoming unreadable — but the
 * decisive one is quieter: **Firestore's value ordering sorts by TYPE first.**
 * Every number sorts before every timestamp. A collection holding old
 * number-`savedAt` documents beside new timestamp-`savedAt` ones would list
 * them in two blocks, all of one type then all of the other, with a person's
 * conversations silently out of order by the type of the field rather than by
 * when they were written. A second field costs one small write per turn and
 * has no such shadow.
 *
 * So the migration consequence, plainly:
 *
 *   • **Every document already stored stays readable and listable.** Nothing
 *     about `savedAt`, the index, the cursor or the query changed, and a
 *     document written by 9.33–9.41 is read by this release unchanged.
 *   • **Old documents do not start expiring.** They carry no `expiresAt`, and
 *     a TTL policy ignores a document whose field is missing. A conversation
 *     that is still being used gains one on its next turn; a conversation
 *     nobody ever writes to again keeps living. If those matter, delete them
 *     by hand once (a query on `savedAt` plus `forget`, or a `gcloud`
 *     bulk-delete) — this adapter will not walk your collection behind your
 *     back.
 *   • **The policy is still yours to create.** `retention().enableWith` prints
 *     the exact command with your collection and database in it.
 *
 * ── The ceiling, since a store should name its own ──────────────────────────
 * A Firestore document is capped at 1 MiB. A conversation whose stored envelope
 * approaches that is refused BY NAME before the write
 * ({@link EnvelopeTooLargeError}) rather than being sent and rejected as an
 * opaque `INVALID_ARGUMENT`. Nothing is ever truncated: half a conversation
 * stored as if it were whole is the failure this whole file exists to avoid.
 * Compaction (the builder's `.compaction({ … })`, or `.window()`) is the
 * answer, and the refusal says so. Named from the builder deliberately: there
 * is no `agent.compact()` to call, and a doc comment ships into the emitted
 * `.d.ts`, so a method named here that does not exist is a method somebody
 * types on hover.
 *
 * ── The laws it inherits rather than re-implements ──────────────────────────
 * `checkEnvelope` runs on the way OUT and on the way IN, so an envelope whose
 * `format` this runtime does not know is refused by name, and a session that is
 * PRESENT but unreadable is refused by name too. Only a session that was never
 * written hydrates as `undefined`. A conversation that exists and cannot be read
 * must never be answered with a fresh start — from the outside that is
 * indistinguishable from a brand-new user.
 *
 * Ownership is DERIVED from the stored envelope and established ONCE. See
 * `persist` below: SQLite gets that from `COALESCE(sessions.owner,
 * excluded.owner)`, Firestore has no such thing, and a `set({ merge: true })`
 * would let the last writer win — which is exactly the bug, not a workaround
 * for it. So the write is a transaction.
 *
 * ── How much of this is verified ────────────────────────────────────────────
 * **Field-validated except the ownership refusal (2026-08).** An independent
 * field trial ran THIS adapter against a real Firestore and exercised seven of
 * its eight areas live: the round trip, the server-side indexed listing with
 * its document-name tiebreak and real cursor, the missing-index refusal, the
 * hashed document name, the size ceiling, ownership derived from the envelope,
 * and `forget`.
 *
 * The eighth is named because under-claiming and over-claiming are the same
 * defect: **the refusal of a turn signed by somebody else** — the
 * `resolveSessionOwner` conflict this file's `persist` raises out of the
 * transaction — was NOT exercised, because it did not exist when the trial
 * ran. It is held by tests here, including the contested-write case of the
 * shared conformance battery, and by nothing in the field. Two writers racing
 * for one fresh session against a real Firestore, with the real client's
 * transaction retry underneath, is exactly the shape a double models by
 * assumption; the sibling Vertex adapter's equivalent was found in the field
 * and not in a test suite.
 *
 * This section said "NOT field-validated. Nothing here has been run against a
 * live Firestore" for two releases after that stopped being true. Under-claiming
 * is the safe direction and it is still the same defect class the trials keep
 * reporting: a status that does not track the evidence is a status nobody can
 * use, whichever way it is wrong.
 *
 * The pin is the `firestoreSessions` row of `GOOGLE_SURFACE_PINS` in
 * `test/adapters/google/googlePin.ts`, asserted by
 * `test/adapters/google/google-surface-pin.test.ts`. Its 18 members were
 * hand-verified against a real `@google-cloud/firestore` 9.0.0 install in a
 * scratch project OUTSIDE this repository: seventeen read off
 * `types/firestore.d.ts` before a line of this file was written, and
 * `DocumentSnapshot.id` verified afterwards, when a review found the row had
 * pinned `DocumentReference.id` — real, but a member this adapter never reads —
 * in place of the one the cursor actually reads.
 *
 * That package is deliberately NOT installed here. It depends on
 * `@opentelemetry/api`, so installing it hoists that package to the repository
 * root and disarms `test/observability-providers/otel.test.ts`, which proves
 * `otelObservability()` refuses BY NAME when `@opentelemetry/api` is absent.
 * The consequence has to be said plainly: **the reality assertion — "every
 * pinned member really exists on the real package" — SKIPS in this repository.**
 * It runs in full for anyone who installs `@google-cloud/firestore` locally.
 *
 * So what is machine-checked in CI is the SHAPE pin, not the reality pin: this
 * adapter dispatches exactly the members the row names and no others, every run,
 * everywhere. That the row spells those members the way Google does is held by a
 * hand check against a real install, not by a test that runs here.
 *
 * The DESIGN was informed, before any of that, by an EARLIER and separate trial
 * of a DIFFERENT Firestore
 * session adapter, which ran against a real Firestore and passed eight ownership
 * and history checks — and whose own report named the defect this adapter does
 * not reproduce: that adapter read every document for one owner, sorted them in
 * the client, and applied an offset cursor. That works until one person has a
 * lot of conversations, and then it costs a full read of all of them per page.
 * What the trial proves is that the ownership and history SEMANTICS survive a
 * real service; it proves nothing about this file's query, cursor, transaction
 * or index, because that adapter had none of them.
 */

import type { FirestoreSessionsOptions, FirestoreSessions } from './types.js';

export type {
  FirestoreDocumentSnapshotLike,
  FirestoreQuerySnapshotLike,
  FirestoreQueryLike,
  FirestoreDocumentReferenceLike,
  FirestoreCollectionLike,
  FirestoreTransactionLike,
  FirestoreLike,
  FirestoreConstructorLike,
  FirestoreSdkModule,
  FirestoreSessionsOptions,
  FirestoreSessions,
} from './types.js';
export {
  DEFAULT_SESSION_COLLECTION,
  EXPIRES_AT_FIELD,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  FIRESTORE_MAX_ENVELOPE_BYTES,
} from './constants.js';
export { ttlPolicyCommand } from './retention.js';
export { documentIdFor } from './address.js';
export { FirestoreIndexMissingError, EnvelopeTooLargeError } from './errors.js';
export { grpcStatusOf, isFailedPrecondition, firestoreFailure } from './failure.js';

// ─── The factory ─────────────────────────────────────────────────────

/**
 * Conversations in Firestore — a fleet-shared session store with no instance to
 * run.
 *
 * **Status: field-validated except the ownership refusal (2026-08).** An
 * independent field trial ran this adapter against a real Firestore and
 * exercised seven of its eight areas live — round trip, indexed and cursored
 * listing, the missing-index refusal, the hashed document name, the size
 * ceiling, derived ownership and `forget`. The eighth, the refusal of a turn
 * signed by somebody ELSE, was added after the trial and is held by tests
 * here and by nothing in the field. Every SDK member it calls was read off a
 * real install of `@google-cloud/firestore` 9.0.0 and hand-verified there; the
 * test that re-checks those names against the real package SKIPS in this
 * repository, because the package is deliberately not installed here. What
 * runs in CI is the dispatch pin. See the module header for the full account.
 *
 * @throws FirestoreIndexMissingError from `listByUser` until the composite index
 *   exists — see the module header for the exact index.
 * @throws EnvelopeTooLargeError from `persist` for a conversation above
 *   {@link FIRESTORE_MAX_ENVELOPE_BYTES}. Never truncated.
 *
 * @example  Conversations that expire 30 days after their last turn
 *   const sessions = firestoreSessions({
 *     project: 'my-project',
 *     expireAfterMs: 30 * 24 * 60 * 60 * 1000,
 *   });
 *   // Then, ONCE, as an operator — the store prints the exact command:
 *   console.log(sessions.retention().enableWith);
 *
 * @example  A standing agent whose conversations are shared across instances
 *   import { standingAgent, nodeHost } from 'agentfootprint/hosting';
 *   import { firestoreSessions } from 'agentfootprint/hosting';
 *
 *   const sessions = firestoreSessions({ project: 'my-project' });
 *   const handle = await standingAgent({
 *     agentFactory: () => buildAgent(),
 *     host: nodeHost({ port: 8080 }),
 *     sessions,
 *   });
 *   process.on('SIGTERM', () => void handle.close().then(() => sessions.close()));
 *
 * @example  Reusing the Firestore client the application already has
 *   const sessions = firestoreSessions({ firestore: db, collection: 'chat_sessions' });
 *   // close() will NOT terminate `db` — this store did not open it.
 */
export function firestoreSessions(options: FirestoreSessionsOptions = {}): FirestoreSessions {
  return buildStore(options);
}
