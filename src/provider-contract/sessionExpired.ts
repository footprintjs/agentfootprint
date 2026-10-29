/**
 * `SessionExpiredError` — a remote session that is gone, said ONE way.
 *
 * A managed backend reaps its sessions on its own schedule (a timeout, a stop,
 * a restart), and each service words that differently: AgentCore's Code
 * Interpreter answers with a `ResourceNotFoundException`, a
 * `ValidationException` saying the session is "not active", or a stream error
 * naming an inactive session. A caller that has to recognise all of those by
 * message text will miss the next one. An adapter recognises them once and
 * raises this instead, so "start a new session" is one `instanceof` away.
 *
 * It names the session and the signal that said so — never the request that
 * hit it. Nothing reconnects: the session's files and state are gone, and a
 * session name is not an address (names are not unique), so the only honest
 * next step is a new session.
 */
export class SessionExpiredError extends Error {
  readonly code = 'ERR_SESSION_EXPIRED' as const;
  /** The adapter that raised it, e.g. `'agentCoreCodeRunner'`. */
  readonly backend: string;
  /** The backend's id for the session that is gone. */
  readonly sessionId: string;
  /** The service's own name for the signal that said so, e.g. `'ResourceNotFoundException'`. */
  readonly evidence: string;

  constructor(backend: string, sessionId: string, evidence: string) {
    super(
      `${backend}: session ${sessionId} is no longer active (${evidence}). The service ends a ` +
        'session at its timeout or when it is stopped, and its files and state end with it. ' +
        'Start a new session; nothing reconnects to this one.',
    );
    this.name = 'SessionExpiredError';
    this.backend = backend;
    this.sessionId = sessionId;
    this.evidence = evidence;
  }
}
