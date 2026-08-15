/**
 * hosting-providers — adapters for the two hosting ports.
 *
 *   src/hosting/            ← the PORTS (`AgentHost`, `SessionLifecycle`), the
 *                             composer, and the local adapters
 *   src/hosting-providers.ts ← adapters for somewhere you deploy (this file)
 *
 * The split is a source-tree split, not an import split: both halves come out
 * of the one `agentfootprint/hosting` door. It exists because the PORT files
 * promise that not one field, name or assumption in them comes from any cloud,
 * and a test greps those sources for vendor names to keep that honest. So the
 * cloud adapters live in this file, and the port files stay readable without
 * learning anybody's product names.
 *
 * One file that grows: an adapter for the next runtime lands here beside this
 * one.
 *
 * ── What ships here ──────────────────────────────────────────────────────────
 *   • `agentCoreRuntimeHost({ port?, hostname?, busy? })` — an `AgentHost` for
 *     AWS Bedrock AgentCore Runtime's container contract: `POST /invocations`,
 *     `GET /ping`, port 8080, and the conversation id read from the
 *     `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header. It is a
 *     `ConversationHost` too: `serveConversations(handler)` takes the runtime's
 *     `/ws` door on the SAME socket, with `{ maxFrameBytes: 32768,
 *     idleMs: 900000 }` declared, session affinity readable from header or
 *     query, and a `Sec-WebSocket-Protocol` bearer mapped into
 *     `headers.authorization`.
 *   • `agentCoreSessions({ store })` — a `SessionLifecycle` whose checkpoint
 *     home you choose at construction: a JSON file in the runtime's own session
 *     storage (survives a stop/resume, needs no SDK), or one AgentCore Memory
 *     event per persist (outlives the session).
 *   • `agentEngineSessions({ project, location, reasoningEngine })` — a
 *     `SessionLifecycle` in Vertex AI's own session service, for the row above
 *     `sqliteSessions`: many containers sharing one conversation. The whole
 *     `CheckpointEnvelope` rides in `Session.sessionState`, which is an
 *     arbitrary JSON Struct, so there is no blob encoding to get wrong — and it
 *     is written by APPENDING AN EVENT, because the service refuses a state
 *     patch (a field trial found that the expensive way; see the adapter).
 *   • `firestoreSessions({ project?, database?, collection? })` — the same fleet
 *     row without a reasoning engine: one Firestore document per session, in a
 *     project you probably already have. `listByUser` is a server-side indexed
 *     query with a real Firestore cursor (never a client-side sort over every
 *     document, which is the shape that quietly becomes a full read per page),
 *     and ownership is written ONCE inside a transaction because Firestore has
 *     no `COALESCE` and a merged write would let the last writer take a session.
 *     It needs one composite index; the adapter names it, and says so again in
 *     the error you get without it.
 *
 * ── How much of this is verified ─────────────────────────────────────────────
 * `agentCoreRuntimeHost` is plain HTTP with no SDK on its path, and it passes
 * the same host conformance suite as `nodeHost` over a real socket — that is
 * real verification, not a mapping asserted in prose.
 *
 * Everything that talks to AWS — `agentCoreSessions({ store: 'memory' })` — is
 * **contract-mapped and injection-tested**: the SDK calls are exercised through
 * the `_client` seam and no test pretends to have reached AWS. Real-cloud
 * verification lands with a field deployment.
 *
 * `firestoreSessions` is **field-validated except the ownership refusal
 * (2026-08)**: an independent trial ran it against a real Firestore and
 * exercised seven of its eight areas live — the round trip, the indexed and
 * cursored listing, the missing-index refusal, the hashed document name, the
 * size ceiling, derived ownership and `forget`. The eighth, refusing a turn
 * signed by somebody ELSE, was added after that trial and is held by tests
 * here and by nothing in the field. Two further caveats stand: every SDK
 * member it calls was read off a real install of `@google-cloud/firestore`
 * 9.0.0 and hand-verified there, but the package is deliberately NOT installed
 * in this repository (it would hoist `@opentelemetry/api` and disarm an
 * absent-peer refusal test), so the assertion that re-checks those names
 * against the real package SKIPS here and runs for anyone who installs it
 * locally; what CI checks is dispatch. See the adapter's module header for the
 * full account.
 *
 * @example  An agent in an AgentCore Runtime container
 *   import { standingAgent } from 'agentfootprint/hosting';
 *   import { agentCoreRuntimeHost, agentCoreSessions } from 'agentfootprint/hosting';
 *
 *   const handle = await standingAgent({
 *     agent,
 *     host: agentCoreRuntimeHost(),
 *     sessions: agentCoreSessions({ store: 'session-storage' }),
 *   });
 *   process.on('SIGTERM', () => void handle.close());
 *
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/hosting`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */

export {
  agentCoreRuntimeHost,
  agentCoreRuntimeWire,
  readAgentCoreConversation,
  agentCoreSessions,
  DEFAULT_SESSION_STORAGE_PATH,
} from './adapters/hosting/agentcore.js';

export {
  agentEngineSessions,
  DEFAULT_USER_ID,
  SESSION_STATE_KEY,
  SESSION_EVENT_AUTHOR,
} from './adapters/hosting/googleAgentEngine.js';

export type {
  AgentEngineSessions,
  AgentEngineSessionsOptions,
} from './adapters/hosting/googleAgentEngine.js';

// `documentIdFor`, `firestoreFailure` and the gRPC status readers stay OFF this
// barrel on purpose. The first is reachable as a method on the store, where it
// carries the store's own context; the others are this adapter's internals, and
// a name as generic as `grpcStatusOf` on a package-wide door is a collision
// waiting for the second gRPC adapter. Import them from the module path if a
// test needs them.
export {
  firestoreSessions,
  DEFAULT_SESSION_COLLECTION,
  // The field a native TTL policy is configured against (9.42.0). On the
  // barrel beside the collection name for the same reason: an operator types
  // both of them into a console, and a name that lives only inside a string
  // literal is a name somebody mistypes at 2am. `ttlPolicyCommand` stays off —
  // it is reachable, already filled in, as `store.retention().enableWith`.
  EXPIRES_AT_FIELD,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  FIRESTORE_MAX_ENVELOPE_BYTES,
  EnvelopeTooLargeError,
  FirestoreIndexMissingError,
} from './adapters/hosting/firestoreSessions.js';

export type {
  FirestoreSessions,
  FirestoreSessionsOptions,
  FirestoreSdkModule,
  FirestoreConstructorLike,
  FirestoreLike,
  FirestoreCollectionLike,
  FirestoreQueryLike,
  FirestoreQuerySnapshotLike,
  FirestoreDocumentReferenceLike,
  FirestoreDocumentSnapshotLike,
  FirestoreTransactionLike,
} from './adapters/hosting/firestoreSessions.js';

export type {
  AgentCoreRuntimeHostOptions,
  AgentCoreSessionsOptions,
  AgentCoreSessionStore,
  AgentCoreFileSessionsOptions,
  AgentCoreMemorySessionsOptions,
  AgentCoreSessionClientLike,
  AgentCoreSessionEvent,
  BedrockAgentCoreSessionSdkModule,
} from './adapters/hosting/agentcore.js';
