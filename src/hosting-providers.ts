/**
 * agentfootprint/hosting-providers — adapters for the two hosting ports.
 *
 *   agentfootprint/hosting            ← the PORTS (`AgentHost`, `SessionLifecycle`),
 *                                       the composer, and the local adapters
 *   agentfootprint/hosting-providers  ← adapters for somewhere you deploy (this file)
 *
 * Same split as `agentfootprint/memory` ↔ `agentfootprint/memory-providers`, and
 * for the same reason. `agentfootprint/hosting` promises that not one field,
 * name or assumption in it comes from any cloud, and a test greps its sources
 * for vendor names to keep that honest — including the barrel. So the cloud
 * adapters get their own subpath, and the port subpath stays a file you can
 * read without learning anybody's product names.
 *
 * One subpath that grows: an adapter for the next runtime lands here beside
 * this one rather than minting `agentfootprint/hosting-<vendor>`.
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
 *   import { agentCoreRuntimeHost, agentCoreSessions } from 'agentfootprint/hosting-providers';
 *
 *   const handle = await standingAgent({
 *     agent,
 *     host: agentCoreRuntimeHost(),
 *     sessions: agentCoreSessions({ store: 'session-storage' }),
 *   });
 *   process.on('SIGTERM', () => void handle.close());
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
