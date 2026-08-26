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
 *   • `agentCoreA2AHost({ card, port?, hostname?, maxBodyBytes? })` — an
 *     `AgentHost` for AgentCore's **A2A** container contract, so OTHER AGENTS
 *     can call yours: JSON-RPC 2.0 at `POST /` on port 9000, the agent card at
 *     `/.well-known/agent-card.json`, `GET /ping` answering
 *     `{"status":"Healthy"}`, and the session read from
 *     `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`. It declares NO streaming
 *     capability and its card says `streaming: false`, because `message/send`
 *     has nowhere to put a chunk — the two agree on purpose. Errors carry a
 *     REAL HTTP status alongside the JSON-RPC error body (the platform's
 *     documented deviation from the A2A spec); `agentCoreA2AErrorCode` is the
 *     table, exported so a client shares it rather than keeping a copy.
 *   • `a2aWire({ card, health?, errorCodeFor? })` — the A2A PROTOCOL as an
 *     `HttpWire`, with no vendor in it, for the next runtime that speaks it.
 *     `a2aAgentCardDocument(card)` builds the discovery document on its own,
 *     for deployments that must serve it from somewhere else.
 *   • `foundryResponsesHost({ port?, hostname?, model?, maxBodyBytes? })` — an
 *     `AgentHost` for Microsoft Foundry's hosted-agent contract: `POST
 *     /responses`, a `HEAD` capability probe on the same path, `GET /readiness`
 *     answering `{"status":"healthy"}`, port 8088, and the session read from
 *     `conversation` / `agent_session_id` / `session_id` in that order. It
 *     streams when the BODY says `stream: true` — not the `Accept` header —
 *     and frames that stream as the Responses lifecycle.
 *     **Inbound only:** it is the door callers arrive at, and says nothing
 *     about which model the agent calls. It does NOT provide Workflow
 *     Visualizer topology; see the adapter's header.
 *   • `responsesWire({ defaultModel?, sessionFields?, health? })` — the
 *     Responses PROTOCOL as an `HttpWire`, with no vendor in it, for the next
 *     runtime that speaks it on paths of its own.
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
  agentCoreA2AHost,
  agentCoreA2AErrorCode,
  DEFAULT_AGENTCORE_A2A_PORT,
  AGENTCORE_A2A_INVOKE_PATH,
  AGENTCORE_PING_PATH,
  AGENTCORE_SESSION_HEADER,
} from './adapters/hosting/agentCoreA2A.js';

export type { AgentCoreA2AHostOptions } from './adapters/hosting/agentCoreA2A.js';

// The protocol under it, on the barrel in its own right — A2A is an open
// protocol, and reaching it should not mean importing a vendor's module.
export {
  a2aWire,
  a2aAgentCardDocument,
  readA2AMessageText,
  A2A_PROTOCOL_VERSION,
  A2A_AGENT_CARD_PATH,
  A2A_SEND_METHOD,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INTERNAL_ERROR,
} from './adapters/hosting/a2aWire.js';

export type { A2AWireOptions, A2AAgentCard, A2ASkill } from './adapters/hosting/a2aWire.js';

export {
  foundryResponsesHost,
  DEFAULT_FOUNDRY_PORT,
  FOUNDRY_INVOKE_PATH,
  FOUNDRY_READINESS_PATH,
  FOUNDRY_SESSION_FIELDS,
} from './adapters/hosting/foundryResponses.js';

export type { FoundryResponsesHostOptions } from './adapters/hosting/foundryResponses.js';

// The protocol under it, on the barrel in its own right: a deployment that
// speaks Responses on paths of its own is a `httpHost` away, and having to
// import a vendor-named module to reach a vendor-neutral dialect would be the
// split this pair exists to make.
export {
  responsesWire,
  readResponsesInput,
  readResponsesSession,
  DEFAULT_SESSION_FIELDS,
  PUBLIC_FAILURE_MESSAGE,
} from './adapters/hosting/responsesWire.js';

export type { ResponsesWireOptions } from './adapters/hosting/responsesWire.js';

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
