/**
 * agentfootprint/hosting — the ports between an agent and the place it runs.
 *
 * An agent that answers one call in a script and an agent that has been up for
 * a month differ in a few things: something has to carry requests to it,
 * something sometimes has to hold a channel OPEN to it, and the conversation
 * has to outlive the request. This subpath is those things as **ports**, plus
 * local adapters that prove the ports work, plus the composer that wires the
 * request half together.
 *
 *   `AgentHost`         — something can call me.
 *   `ConversationHost`  — something can talk to me, both ways, until one of us
 *                         ends it. `HostRequest → HostReply` is one exchange;
 *                         some doors are not.
 *   `SessionLifecycle`  — the conversation outlives the request.
 *   `standingAgent`     — hydrate → resume-or-fresh → persist → reply.
 *
 * ── Why the ports look like nothing in particular ────────────────────────────
 * Deliberately. Not one field, name or assumption here comes from any hosting
 * product, cloud or protocol. A port shaped around one provider's request
 * envelope stops being a port and becomes that provider's SDK with extra steps,
 * and every adapter after the first pays for the shortcut. So the ports carry
 * an input, a reply, an optional session id, headers, a signal — the vocabulary
 * every transport already has — and everything specific to one place you might
 * deploy lives in the adapter for that place. `nodeHost` gets no special
 * treatment: its paths, status codes and JSON body shape are all in
 * `nodeHost.ts` and the port types do not know they exist. A test greps these
 * source files for vendor names, crudely and on purpose.
 *
 * ── What ships here ──────────────────────────────────────────────────────────
 *   • `nodeHost({ port?, hostname?, invokePath?, healthPath? })` — plain
 *     `node:http`, zero dependencies. `POST /invoke`, `GET /health`, and
 *     Server-Sent Events when the caller asks for them.
 *   • `httpHost({ name, wire, invokePath, healthPath, ... })` — the HTTP work
 *     itself, parameterised by the JSON dialect it speaks. `nodeHost` is one
 *     configuration of it; an adapter for someone's container runtime is
 *     another. Two paths and five body shapes are all a second HTTP adapter
 *     re-decides. Pass `server` and it attaches to a `node:http` server YOU
 *     own instead of binding one — for the container that gets a single port
 *     and must serve a WebSocket upgrade (or anything else) beside the agent.
 *   • `host.serveConversations(handler)` — the conversation door, on every
 *     adapter built on `httpHost` that was given a `conversationPath`.
 *     `nodeHost` serves it on `/conversation` with a real WebSocket
 *     implementation and **no dependency to install**, sharing the socket with
 *     `/invoke`. Frames are STRINGS at the port; what they mean is your
 *     protocol's business, not this port's.
 *   • `ConversationLimits` — the ceilings a door DECLARES
 *     (`maxFrameBytes`, `idleMs`, `maxPendingBytes`) so the layer above can
 *     chunk or heartbeat on its own protocol. The port does neither, on
 *     purpose: hiding a cap inside auto-chunking decides a protocol question
 *     for every consumer at once.
 *   • `memorySessions()` — conversations in a Map, for tests and local dev.
 *   • `sqliteSessions({ file })` — the same port, in a file, so a restart is not
 *     an amnesia event. Conversations AND runs paused waiting on a person, in
 *     one table, on Node's built-in `node:sqlite` — nothing to install and no
 *     peer dependency. One machine, one file, one writer at a time is the
 *     stated ceiling; it is not a distributed store. Refuses BY NAME on a Node
 *     without `node:sqlite` rather than falling back to memory, because a store
 *     that silently forgot everything looks exactly like a new user.
 *   • `standingAgent({ agent, sessions, host, durability? })` — the composer.
 *     `{ agentFactory }` instead of `{ agent }` gives every ACTIVE SESSION its
 *     own agent, so sessions run in parallel while each session's turns still
 *     serialize on its own instance — bounded by `maxActiveSessions`, evicted
 *     least-recently-used, and invisible when it evicts because the
 *     conversation lives in the store rather than in the instance.
 *   • `toEnvelope` / `readEnvelope` — pack a conversation, and refuse by name to
 *     unpack a format this runtime does not know.
 *   • `toPausedEnvelope` / `readPausedRun` — the same for a run that stopped to
 *     ask a person something (`'flowchart-v1'`). `checkEnvelope` validates
 *     either without committing to which half you wanted — what a STORE wants.
 *   • `UnreadableEnvelopeError` — the refusal every reader and every store
 *     adapter inherits when a stored session is PRESENT but cannot be read. An
 *     unreadable stored conversation and an absent one are different facts, and
 *     only one of them is safe to answer with a fresh start.
 *   • `sessionRetention(sessions)` — how long a store keeps a conversation.
 *     The port's optional `retention()` member, feature-detected once: a store
 *     that deletes its own bytes hands back a sweep your cron calls, one whose
 *     backend expires rows hands back the policy and the step that arms it, and
 *     a store that can do neither is REFUSED BY NAME rather than sweeping
 *     nothing. Nothing here runs on a timer of its own, and no wire op deletes
 *     a conversation.
 *   • `requireCapability` — feature-detection with teeth.
 *
 * @example  An agent that stays up and remembers
 *   import { Agent } from 'agentfootprint';
 *   import { standingAgent, nodeHost, memorySessions } from 'agentfootprint/hosting';
 *
 *   const handle = await standingAgent({
 *     agent: Agent.create({ provider, model }).system('You help customers.').build(),
 *     sessions: memorySessions(),
 *     host: nodeHost({ port: 8080 }),
 *   });
 *   process.on('SIGTERM', () => void handle.close());
 */

export { nodeHost, jsonWire, jsonWireWith, DEFAULT_SESSION_HEADER } from './nodeHost.js';
export type { NodeHost, NodeHostHandle, NodeHostOptions, JsonWireOptions } from './nodeHost.js';
// `browserSessionId` — the CLIENT half of a session — is deliberately NOT on
// this barrel. It lives in `./browserSession.ts` beside the server half it
// pairs with, and is exported from the MAIN barrel instead: everything else in
// this folder is Node (`node:http` behind a dynamic import, `node:sqlite`
// behind `createRequire`), and a browser bundle must not have to reach through
// a Node door to mint a session id.

export { httpHost, headerValue } from './httpHost.js';
export type {
  ConversationHandshake,
  HandshakeFacts,
  HttpHost,
  HttpHostHandle,
  HttpHostOptions,
  HttpRequestFacts,
  HttpWire,
} from './httpHost.js';

export { memorySessions } from './memorySessions.js';
export {
  sqliteSessions,
  SqliteUnavailableError,
  UnreadableSessionFileError,
} from './sqliteSessions.js';
// The `node:sqlite` shape types (`SqliteModuleLike` and friends) stay OFF this
// barrel on purpose: they exist to type the adapter's internal test seam, and a
// name on the public door is a name somebody will build on.
export type { SqliteSessions, SqliteSessionsOptions } from './sqliteSessions.js';
export {
  toEnvelope,
  envelopeOwner,
  envelopeTranscript,
  toPausedEnvelope,
  readEnvelope,
  readPausedRun,
  checkEnvelope,
} from './envelope.js';
export { standingAgent } from './standingAgent.js';

export { DEFAULT_MAX_ACTIVE_SESSIONS, DEFAULT_SWEEP_LIMIT } from './types.js';

export {
  requireCapability,
  HostClosedError,
  ConcurrentRunError,
  PauseNotCarriedError,
  AwaitingDecisionError,
  NoPendingAskError,
  UnreadableEnvelopeError,
  ConversationClosedError,
  FrameTooLargeError,
  InvalidWireOpError,
  ArtifactSessionRequiredError,
  NoArtifactStoreError,
  ArtifactNotFoundError,
  ArtifactNotCarriedError,
  IdentityNotVerifiedError,
  VerifierUnavailableError,
  AdmissionRefusedError,
  SessionOpNeedsIdentityError,
  SessionIndexUnavailableError,
  SessionRetentionUnavailableError,
  SessionNotFoundError,
  SessionOwnershipConflictError,
  SessionsNotCarriedError,
} from './errors.js';
export type { IdentityFailureClass } from './errors.js';

// Retention (9.42.0) — the ONE feature detection for the port's optional
// `retention()` member, and the refusal a store without one produces. A door
// rather than `sessions.retention?.()`, because `undefined` there reads as
// "fine" and a retention job that quietly deletes nothing is the failure this
// whole member exists to prevent.
export { sessionRetention } from './sessionRetention.js';

// The one owner-transition rule (9.36.1) — shared by every store here, and
// available to any store anybody else writes. Four adapters each spelling this
// rule out in their own dialect is how all four came to be missing the same
// half of it.
export { resolveSessionOwner } from './sessionOwnership.js';

// The battery a store must pass to CLAIM the port (9.36.1), exported beside
// the port itself so an out-of-tree store imports the check the same way it
// imports the interface it is implementing.
// See src/hosting/conformance/README.md.
export {
  formatConformanceReport,
  runSessionLifecycleCase,
  runSessionLifecycleConformance,
  sessionLifecycleConformance,
} from './conformance/index.js';
export type {
  ConformanceKit,
  SessionLifecycleCase,
  SessionLifecycleCaseName,
  SessionLifecycleOutcome,
  SessionLifecycleReport,
  SessionStoreHarness,
  SessionStoreMember,
} from './conformance/index.js';

// Verified identity at the door (9.26.0) — the badge is CHECKED instead of
// read off. `IdentityVerifier` is the port; `jwksIdentity` (from
// `agentfootprint/security`) is the shipped adapter; `bearerToken` is the one
// extraction every dialect's credential arrives through.
export { bearerToken, verifyRequestIdentity } from './identityVerification.js';
export type {
  IdentityVerificationOptions,
  IdentityVerifier,
  VerifiedIdentity,
} from './identityVerification.js';

// Admission (9.26.0) — decide whether a request runs before it costs anything.
// `turnsPerHour` is the shipped reference policy; `spendLedger` is the
// in-process rolling-window accountant the composer feeds.
export { spendKeyFor, spendLedger, turnsPerHour } from './admission.js';
export type {
  AdmissionContext,
  AdmissionPolicy,
  AdmissionVerdict,
  RecentSpend,
  SpendLedger,
  SpendLedgerOptions,
  TurnsPerHourOptions,
} from './admission.js';

// The ingress record (9.32.0) — one record per DOOR decision, including every
// request that never became a run, so the 401s and 429s `auditExport()` cannot
// see have somewhere honest to land. Types only: the seam is the
// `onIngressDecision` option, and this package emits nothing on its own.
export type {
  IngressAdmissionVerdict,
  IngressDoor,
  IngressOutcome,
  IngressRecord,
  IngressSink,
} from './ingressRecord.js';

// The session-history wire operations (9.26.0) — a person's own conversations,
// answered only for a VERIFIED caller. One grammar owner, exactly as the
// artifact ops have.
export {
  readSessionWireOp,
  sessionWireBody,
  SESSION_LIST_OP,
  SESSION_TRANSCRIPT_OP,
} from './sessionWire.js';
export type {
  SessionSummary,
  SessionWireRequest,
  SessionWireResult,
  TranscriptMessage,
} from './sessionWire.js';
export { ALL_WIRE_OPS, isWireOp, refuseUnknownWireOp, WIRE_OPS } from './wireOps.js';
export type { WireOpName } from './wireOps.js';

// The artifact wire operations (9.23.0) — the screen's half of render-by-ref:
// `{ op: 'artifact-head' | 'artifact-get', ref }` on the invoke path redeems
// a claim ticket under the requesting session's identity-composed scope.
// The grammar has ONE owner; a custom HttpWire dialect reads the ops with
// `readArtifactWireOp` and answers with `artifactWireBody`, exactly as the
// two shipped dialects do.
export {
  readArtifactWireOp,
  artifactWireBody,
  ARTIFACT_HEAD_OP,
  ARTIFACT_GET_OP,
} from './artifactWire.js';
export type { ArtifactWireRequest, ArtifactWireResult } from './artifactWire.js';

export type {
  AgentHost,
  CheckpointEnvelope,
  ConcurrentInvokePolicy,
  ConversationClose,
  ConversationEnvelope,
  ConversationHandler,
  ConversationHost,
  ConversationLimits,
  DurabilityMode,
  HostCapability,
  HostConversation,
  HostHandle,
  HostHandler,
  HostReply,
  HostRequest,
  PausedRun,
  PausedRunEnvelope,
  PendingAsk,
  SessionExpiryPolicy,
  SessionLifecycle,
  SessionListOptions,
  SessionListPage,
  SessionRetention,
  SessionSweep,
  SessionSweepOptions,
  SessionSweepResult,
  StandingAgentBaseOptions,
  StandingAgentOptions,
  StandingAgentPoolOptions,
  StandingAgentSharedOptions,
  Unsubscribe,
  WakeReason,
} from './types.js';
