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
