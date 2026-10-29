/**
 * sessionEnded — the MCP server ended a conversation's session: the library's
 * one `SessionExpiredError`, said the pool's way.
 *
 * Pattern: a subclass that keeps the class and changes only what the pool must.
 * Role:    § 5.5 of the design. There is ONE expired-session class
 *          (`provider-contract/sessionExpired.ts` · `SessionExpiredError`), so a
 *          caller catches a code session's expiry and an MCP session's with the
 *          same `instanceof`, under the same rule: only documented evidence
 *          raises it. Here the evidence is `'server-404'`: an MCP server answered
 *          HTTP 404 to a request that carried the session id it issued.
 *
 * What differs is what the pool may say. The model reads this error as the
 * call's result, so its message is one fixed sentence; it names no remote
 * session id (`sessionId` is the pool's own client id, which the record carries
 * too) and never the server's text. The original error is `cause`, for the app.
 */

import { SessionExpiredError } from '../../provider-contract/sessionExpired.js';

/** The one sentence a server-ended session reaches the model as. */
export const SESSION_ENDED_SENTENCE =
  "The server had already ended the conversation's session when the call this result answers reached it.";

/** @internal An MCP server ended the session; raised by the pool. Catch `SessionExpiredError`. */
export class ServerEndedSessionError extends SessionExpiredError {
  constructor(server: string, clientId: string, cause: unknown) {
    super(server, clientId, 'server-404');
    this.message = SESSION_ENDED_SENTENCE;
    this.name = 'SessionExpiredError';
    if (cause !== undefined)
      Object.defineProperty(this, 'cause', { value: cause, configurable: true, writable: true });
  }
}
