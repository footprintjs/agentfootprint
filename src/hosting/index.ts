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
 *   • `toEnvelope` / `readEnvelope` — pack a conversation, and refuse by name to
 *     unpack a format this runtime does not know.
 *   • `toPausedEnvelope` / `readPausedRun` — the same for a run that stopped to
 *     ask a person something (`'flowchart-v1'`). `checkEnvelope` validates
 *     either without committing to which half you wanted — what a STORE wants.
 *   • `UnreadableEnvelopeError` — the refusal every reader and every store
 *     adapter inherits when a stored session is PRESENT but cannot be read. An
 *     unreadable stored conversation and an absent one are different facts, and
 *     only one of them is safe to answer with a fresh start.
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

export { nodeHost, jsonWire } from './nodeHost.js';
export type { NodeHost, NodeHostHandle, NodeHostOptions } from './nodeHost.js';

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
  toPausedEnvelope,
  readEnvelope,
  readPausedRun,
  checkEnvelope,
} from './envelope.js';
export { standingAgent } from './standingAgent.js';

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
} from './errors.js';

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
  SessionLifecycle,
  StandingAgentOptions,
  Unsubscribe,
  WakeReason,
} from './types.js';
