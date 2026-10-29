/**
 * callLifetime — one MCP tool call, from the moment it is sent until it settles:
 * what cancels it while it runs, and what its settling stops.
 *
 * Pattern: open / close around `callTool` (`mcpClient.ts` · `wrapMcpTool`).
 * Role:    The call's side of the evidence seam (`requestLedger.ts` is the
 *          transport's). Three things are true of a call while it runs, and
 *          none of them may outlive it:
 *
 *   1. ITS CANCELLATION reaches the SDK. The call's context signal (the run's,
 *      for a call the agent dispatched) and the client's own `signal` are linked
 *      into one signal the SDK request is given — so a cancelled run makes the
 *      SDK reject the call, drop its response handler and send the server
 *      `notifications/cancelled`, whether or not the request could be matched to
 *      the call. The link is undone when the call settles: the SDK keeps its
 *      abort listener on the signal it was given, and a link that outlived the
 *      call would cancel a request that had already finished.
 *   2. ITS TICKET is issued, when the call carries the run's evidence port and
 *      the connection has a ledger, keyed by the request's params object.
 *   3. ITS SETTLING ENDS ITS SERIES. However `callTool` settles — answered,
 *      failed, or given up by the SDK (its own timeout) — a retry series still
 *      sending the request is cut there and then, inside the call: it files
 *      `cancelled` before the call's result is read, and sends nothing more.
 *   4. ITS VERDICT REACHES ITS RECORD. A series that has ended waits for the
 *      call to settle before it files, because only the call can say whether
 *      the answer completed — a 200 can carry a tool error. The call leaves its
 *      verdict in the request's shared replay facts (`replay.ts` ·
 *      `RequestReplay`) before it settles the series' wait.
 *   5. "MAY HAVE RUN" IS RAISED HERE — footprintjs's law, under the
 *      `'app-authorized'` policy (`replay.ts` · `RequestReplay`, its
 *      `uncertain`). A received refusal or error is preserved: a 429, a 503,
 *      a JSON-RPC or tool error — or a chain in which every attempt received
 *      one — keeps the server's error as it came, its effect still `unknown`.
 *      A call that genuinely lacked an answer somewhere — an attempt with no
 *      response at all, or a request the HTTP layer accepted whose JSON-RPC
 *      answer never came — and then fails, fails with footprintjs's
 *      `UnknownEffectError`, its final error (a later refusal's, or the
 *      timeout) as the `cause`: that error alone would read as "failed, try
 *      again". A call that completes returns normally. Under `'compatibility'`
 *      the caller sees the error it always did; the record still says the
 *      effect is unknown. A cancellation never raises it: a call its caller
 *      cancelled ends with the caller's reason, as it always did.
 *
 * In dev mode, a ticket that no request was bound to by the time the call
 * settled, when a `tools/call` request DID go out, is named once per connection: the SDK copied
 * the params, so the call's attempts could not be matched to it. Its
 * cancellation still reached the request (1, and the ledger's own watch on
 * `notifications/cancelled`).
 */

import { isDevMode, UnknownEffectError } from 'footprintjs';

import { eitherSignal, linkedController } from '../lib/abort.js';
import { requestEvidenceOf } from '../tools/requestEvidence.js';
import type { CallVerdict } from './replay.js';
import type { RequestLedger, RequestTicket } from './requestLedger.js';

/** A call that has been opened: the signal its SDK request runs under, and how to close it. */
export interface OpenCall {
  /** What cancels the SDK request — absent when nothing can. */
  readonly signal?: AbortSignal;
  /**
   * The call failed with `error` (`verdict` says how far it got): the error it
   * fails with — `error` itself, or, under `'app-authorized'`, footprintjs's
   * `UnknownEffectError` with `error` as its `cause` when the call genuinely
   * lacked an answer somewhere (see 5 above).
   */
  failed(error: unknown, verdict: CallVerdict): unknown;
  /**
   * The call settled with `verdict`: leave it for the record, undo the link,
   * cut a series still sending, check the ticket was bound.
   */
  close(verdict: CallVerdict): void;
}

/**
 * Open one call.
 *
 * @param params the request's params object — the SDK hands this very object to
 *   the transport, which is how the ledger knows the request is this call's.
 * @param ctx the call's context: its signal, and the run's evidence port if any.
 * @param clientSignal the client's own `signal` (`McpClientOptions.signal`).
 * @param ledger the connection's ledger, when the library built its transport.
 * @param server the client's name, for the dev-mode note.
 */
export function openCall(
  params: object,
  ctx: unknown,
  clientSignal: AbortSignal | undefined,
  ledger: RequestLedger | undefined,
  server: string,
): OpenCall {
  const own = signalOf(ctx);
  const link = own === undefined ? undefined : linkedController(own, clientSignal);
  const signal = link?.controller.signal ?? clientSignal;
  const sink = ledger === undefined ? undefined : requestEvidenceOf(ctx);
  const settled = sink === undefined ? undefined : new AbortController();
  const ticket: RequestTicket | undefined =
    sink === undefined
      ? undefined
      : { sink, signal: eitherSignal(signal, settled?.signal) as AbortSignal };
  const sentBefore = ledger?.toolCallsSent ?? 0;
  if (ticket !== undefined) ledger?.issue(params, ticket);
  let mayHaveRun = false;
  return {
    ...(signal !== undefined && { signal }),
    failed: (error, verdict) => {
      // A call its caller cancelled ends with the caller's reason, whatever its
      // series did; the record still says what is known of its effect.
      if (verdict === 'completed' || signal?.aborted === true) return error;
      const replay = ledger?.replayOf(params);
      if (replay === undefined || !replay.uncertain) return error;
      mayHaveRun = true;
      // The key, when one was sent, is an argument VALUE: it stays with the
      // caller, who sent it, and never rides an error a run may record.
      return new UnknownEffectError({ system: server, attempts: replay.sent, cause: error });
    },
    close: (verdict) => {
      // The verdict first: settling the series' wait files its record.
      ledger?.replayOf(params)?.settle(verdict, mayHaveRun);
      ledger?.release(params);
      settled?.abort(callSettled());
      link?.unlink();
      if (ticket !== undefined && ledger !== undefined) {
        noteUnbound(ledger, ticket, sentBefore, server);
      }
    },
  };
}

/** The call's own signal, when its context carries a real one. */
function signalOf(ctx: unknown): AbortSignal | undefined {
  if (ctx === null || typeof ctx !== 'object' || typeof AbortSignal === 'undefined') {
    return undefined;
  }
  let signal: unknown;
  try {
    signal = (ctx as { readonly signal?: unknown }).signal;
  } catch {
    return undefined;
  }
  return signal instanceof AbortSignal ? signal : undefined;
}

/** Why a series is cut when its call settled first — a fixed sentence. */
function callSettled(): Error {
  return Object.assign(new Error('The tool call settled before its MCP request series did.'), {
    name: 'AbortError',
  });
}

/** Dev mode, once per connection: a request went out for this call, but the ledger never matched it. */
function noteUnbound(
  ledger: RequestLedger,
  ticket: RequestTicket,
  sentBefore: number,
  server: string,
): void {
  if (!isDevMode() || ledger.wasBound(ticket) || ledger.toolCallsSent <= sentBefore) return;
  if (!ledger.firstUnbound()) return;
  // eslint-disable-next-line no-console
  console.warn(
    `[agentfootprint] mcpClient[${server}]: a tool call's request could not be matched to ` +
      'the call, so its retry attempts were not recorded in the run. The MCP SDK copied the ' +
      "request's params before sending them. The call itself is unaffected, and its " +
      'cancellation still reached the request.',
  );
}
