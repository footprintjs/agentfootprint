/**
 * replayUnavailable — when a connection cannot keep the `'app-authorized'`
 * contract, a call under it is refused BEFORE it is sent, and the error says why.
 *
 * Pattern: a readiness rule + one typed refusal.
 * Role:    Under `'app-authorized'`, a call that genuinely lacked an answer and
 *          then fails is raised as "may have run" (`callLifetime.ts`). That
 *          rests on two things the library must ESTABLISH for every call,
 *          never assume:
 *
 *   1. ITS REQUEST IS MATCHED to the call, by the call's private marker, taken
 *      at the transport's `send` (`callMarker.ts`, `requestLedger.ts`).
 *      - `'requests-unwatched'`: the library cannot watch this transport's
 *        `send` at all (stdio, or a transport that refuses the wrap).
 *      - `'request-unmatched'`: a request reached `send` without its call's
 *        marker (an SDK that rebuilt the params and dropped `_meta`), so it
 *        cannot be tied to any call.
 *   2. ITS ANSWER IS SEEN: the JSON-RPC response to the request's id, read as
 *      it arrives. This is checked once the connection is initialized: the
 *      `initialize` answer must have passed the library's observer.
 *      - `'answers-unobserved'`: it did not. An MCP SDK whose `connect`
 *        REPLACES the transport's `onmessage` handler instead of keeping it
 *        (SDK 1.10's `Protocol.connect` does) leaves the observer out.
 *
 * Without either, a request the server accepted and never answered would reach
 * the caller as a plain timeout: the strict contract, silently weakened. So the
 * call is refused instead, and nothing is sent. `'compatibility'` asks none of
 * this and keeps its behaviour.
 */

/** Why a call under `'app-authorized'` was refused before it was sent. */
export type McpReplayUnavailableReason =
  | 'requests-unwatched'
  | 'answers-unobserved'
  | 'request-unmatched';

/** The fixed sentence each reason reads as. Never an argument, a header or an answer. */
const BECAUSE: Readonly<Record<McpReplayUnavailableReason, string>> = {
  'requests-unwatched':
    "the library cannot watch this transport's requests, so it cannot match a request to its call",
  'answers-unobserved':
    "this connection's answers do not pass the library's observer: the MCP SDK replaced the " +
    "transport's message handler when it connected",
  'request-unmatched':
    "the request reached the transport without its call's marker: the MCP SDK rebuilt the " +
    "request's params",
};

/**
 * A tool call refused before it was sent, because this connection cannot keep
 * the `'app-authorized'` replay contract (`reason`). Nothing reached the server.
 * Names the server and the tool, never an argument.
 */
export class McpReplayUnavailableError extends Error {
  readonly code = 'ERR_MCP_REPLAY_UNAVAILABLE' as const;
  /** Nothing was sent: the refusal came before the request left the client. */
  readonly sent = false as const;

  constructor(
    readonly reason: McpReplayUnavailableReason,
    readonly server: string,
    readonly tool: string,
  ) {
    super(
      `mcpClient[${server}]: the call to '${tool}' was not sent. The 'app-authorized' replay ` +
        `policy needs each request matched to its call and each answer seen, and ` +
        `${BECAUSE[reason]}.`,
    );
    this.name = 'McpReplayUnavailableError';
  }
}

/**
 * Why a connection cannot take a call under `'app-authorized'` before anything
 * is sent — `undefined` when it can. `ledger` is the connection's request
 * ledger: absent when the library could not watch the transport's requests.
 * A request that reaches the transport without its marker is refused there, by
 * the ledger (`'request-unmatched'`).
 */
export function unavailableBeforeSending(
  ledger: { readonly answersObserved: boolean } | undefined,
): McpReplayUnavailableReason | undefined {
  if (ledger === undefined) return 'requests-unwatched';
  if (!ledger.answersObserved) return 'answers-unobserved';
  return undefined;
}
