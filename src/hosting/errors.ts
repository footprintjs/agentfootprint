/**
 * hosting/errors — the refusals, authored once so every adapter refuses in the
 * same words.
 *
 * A refusal that varies by adapter is a refusal nobody can write a test or a
 * runbook against. These three carry a stable `code`, name WHO refused, and say
 * what the caller should do instead. Adapters map the codes onto whatever their
 * transport uses to say "no" — that mapping is the adapter's business and lives
 * in the adapter, never here.
 *
 * `requireCapability` is the fourth refusal and the only one that is a
 * programming mistake rather than a runtime condition, so it throws a plain
 * `Error`: nothing branches on "I forgot to feature-detect", it just needs to
 * say so loudly and name the adapter it is talking about.
 */

import type { AgentHost, HostCapability } from './types.js';

/**
 * Thrown when a request arrives at a host that is shutting down or shut down.
 *
 * `close()` lets in-flight work finish and refuses everything after it; this is
 * what "everything after it" receives.
 */
export class HostClosedError extends Error {
  readonly code = 'ERR_HOST_CLOSED' as const;
  /** Which adapter refused. */
  readonly hostName: string;

  constructor(hostName: string) {
    super(
      `[hosting] the '${hostName}' host is closed and is not accepting new requests. ` +
        `In-flight requests were allowed to finish; this one arrived after close() was called. ` +
        `Serve again on a fresh host to accept new work.`,
    );
    this.name = 'HostClosedError';
    this.hostName = hostName;
  }
}

/**
 * Thrown when a request arrives for a session that already has a run in flight
 * and the policy is `'reject'`.
 *
 * The refusal is about the SESSION, not about load: two turns of one
 * conversation racing each other would each answer from the state the other is
 * about to replace. A request for any OTHER session is never refused — it
 * simply waits.
 */
export class ConcurrentRunError extends Error {
  readonly code = 'ERR_CONCURRENT_RUN' as const;
  /** The session that already has a run going. */
  readonly sessionId: string;
  /** The run that is already going, when it has announced itself. */
  readonly activeRunId?: string;

  constructor(sessionId: string, activeRunId?: string) {
    super(
      `[hosting] session '${sessionId}' already has a run in flight` +
        (activeRunId ? ` (run '${activeRunId}')` : '') +
        `. Refusing rather than running two turns of one conversation at once — ` +
        `they would each answer from state the other is about to replace. ` +
        `Wait for the active run, or build the standing agent with ` +
        `onConcurrentInvoke: 'enqueue' to queue this turn behind it instead.`,
    );
    this.name = 'ConcurrentRunError';
    this.sessionId = sessionId;
    if (activeRunId !== undefined) this.activeRunId = activeRunId;
  }
}

/**
 * Raised when a run paused to ask a person something and the reply cannot carry
 * a pause.
 *
 * **The run did not fail.** A pause is unfinished work: the agent stopped to ask
 * and is waiting for an answer. What cannot happen here is storing it — the
 * `'conversation-v1'` envelope holds a conversation, and a paused run is a
 * conversation plus an engine checkpoint. So nothing is written, and the
 * session keeps exactly the conversation it had before this request.
 */
export class PauseNotCarriedError extends Error {
  readonly code = 'ERR_PAUSE_NOT_CARRIED' as const;
  /** The tool that asked, when the run recorded which one it was. */
  readonly toolName?: string;
  /** The session whose stored conversation was left untouched. */
  readonly sessionId?: string;

  constructor(toolName?: string, sessionId?: string) {
    super(
      `[hosting] the run paused to ask a person about ` +
        (toolName ? `'${toolName}'` : 'a tool') +
        ` and this reply cannot carry a pause. ` +
        `The run did not fail — it is unfinished, waiting on an answer. ` +
        `Nothing was written: ` +
        (sessionId ? `session '${sessionId}'` : 'the session') +
        ` still holds the conversation it held before this request. ` +
        `The 'conversation-v1' envelope stores a conversation; a paused run is a ` +
        `conversation plus an engine checkpoint, and storing half of it would be worse ` +
        `than storing none. Carry the pause yourself with agent.run() / agent.resume().`,
    );
    this.name = 'PauseNotCarriedError';
    if (toolName !== undefined) this.toolName = toolName;
    if (sessionId !== undefined) this.sessionId = sessionId;
  }
}

/**
 * Assert that a host can do something, and throw a corrective error naming the
 * adapter when it cannot.
 *
 * This is the feature-detection law with teeth: capabilities are read, never
 * assumed, and asking for one that is absent tells you which adapter you are
 * actually holding rather than failing quietly somewhere downstream.
 *
 * @example
 *   requireCapability(host, 'streaming'); // throws unless this host streams
 *
 *   // or branch instead of insisting:
 *   if (host.capabilities.includes('streaming')) { ... }
 */
export function requireCapability(host: AgentHost, capability: HostCapability): void {
  if (host.capabilities.includes(capability)) return;
  const has = host.capabilities.length > 0 ? host.capabilities.join(', ') : 'none';
  throw new Error(
    `[hosting] the '${host.name}' host does not support '${capability}'. ` +
      `It reports: ${has}. Feature-detect with ` +
      `host.capabilities.includes('${capability}') and fall back, or serve on a host ` +
      `that has it — capabilities are read from the adapter, never assumed from its name.`,
  );
}
