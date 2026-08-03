/**
 * agentfootprint/hosting — the two ports between an agent and the place it runs.
 *
 * An agent that answers one call in a script and an agent that has been up for
 * a month differ in two things, and only two: something has to carry requests
 * to it, and the conversation has to outlive the request. This subpath is those
 * two things as **ports**, plus local adapters that prove the ports work, plus
 * the composer that wires them together.
 *
 *   `AgentHost`         — something can call me.
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
 *   • `memorySessions()` — conversations in a Map, for tests and local dev.
 *   • `standingAgent({ agent, sessions, host })` — the composer.
 *   • `toEnvelope` / `readEnvelope` — pack a conversation, and refuse by name to
 *     unpack a format this runtime does not know.
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

export { nodeHost } from './nodeHost.js';
export type { NodeHost, NodeHostHandle, NodeHostOptions } from './nodeHost.js';

export { memorySessions } from './memorySessions.js';
export { toEnvelope, readEnvelope } from './envelope.js';
export { standingAgent } from './standingAgent.js';

export {
  requireCapability,
  HostClosedError,
  ConcurrentRunError,
  PauseNotCarriedError,
} from './errors.js';

export type {
  AgentHost,
  CheckpointEnvelope,
  ConcurrentInvokePolicy,
  HostCapability,
  HostHandle,
  HostHandler,
  HostReply,
  HostRequest,
  SessionLifecycle,
  StandingAgentOptions,
  WakeReason,
} from './types.js';
