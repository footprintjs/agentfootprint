/**
 * requestSealing — a host hands each run the credential that arrived with ITS
 * request, sealed for that run alone.
 *
 * `requestContext({ secrets })` (`agentfootprint/security`) seals a request's
 * secrets; `requestCredentials` vends them to the tools that declare a `needs`
 * for them. A host that runs the agent for you (`standingAgent`,
 * `streamHandler`) cannot know which header holds the credential, so it asks
 * the app — once per request, with the request's headers — through the
 * {@link RequestSealer} option `sealRequest`, and passes the handle to that
 * request's `run()` / `resume()` and nowhere else. The sealer is handed the
 * headers ONLY: nothing about who is calling, so it can never be tempted to
 * look a stored credential up by a name the caller could have claimed.
 *
 * THE RULES, in one funnel ({@link requestSealing}):
 *   - asked only for a request that runs, after the caller is bound and every
 *     refusal is behind it — a refused request never seals anything;
 *   - the answer is a handle `requestContext` built, or `undefined` (no
 *     request: a tool that needs one fails closed, by name);
 *   - ONE HANDLE, ONE RUN, PROCESS-WIDE: a handle any host was handed before
 *     is refused, so a sealer that caches one — even one shared by two doors
 *     — cannot hand one caller's credential to another caller's run;
 *   - a sealer that throws refuses the request in FIXED words
 *     (`ERR_REQUEST_NOT_SEALED`, 400). Its own message is never sent: it may
 *     quote the value it could not read.
 * The handle never enters a frame, a stored session or a checkpoint; the
 * headers never leave the sealer.
 *
 * Pattern: guarded strategy call. Role: hosting, run input.
 */

import { isRequestContext, type RequestContext } from '../identity/requestContext.js';
import { WireRequestRefusal } from './errors.js';

/** What a host hands the app's {@link RequestSealer} — one request's headers, and nothing else. */
export interface RequestSealFacts {
  /**
   * The request's headers, names lower-cased — where a per-request credential
   * travels (a gateway's encrypted token, a session-bound key). Untrusted, as
   * every header is: what a sealer reads here is the CALLER's credential for
   * the caller's own run, never proof of who the caller is — so seal what the
   * request CARRIES, and never look a stored credential up by a header.
   */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * The app's port that seals one request's credential for its run: return
 * `requestContext({ secrets })`, or `undefined` for a request that carries
 * none. Called once per request that runs; return a NEW handle every time.
 *
 * @example
 * ```ts
 * sealRequest: ({ headers }) =>
 *   headers['x-crm-token'] === undefined
 *     ? undefined
 *     : requestContext({ secrets: { crmToken: headers['x-crm-token'] } }),
 * ```
 */
export type RequestSealer = (
  facts: RequestSealFacts,
) => RequestContext | undefined | Promise<RequestContext | undefined>;

/** The code a request refused by its sealer carries — the status is 400. */
export const REQUEST_NOT_SEALED = 'ERR_REQUEST_NOT_SEALED';

/**
 * Every handle any host in this process handed to a run — held weakly,
 * compared by identity. Module-wide on purpose: two doors sharing one caching
 * sealer must not each accept the same handle once.
 */
const handedToARun = new WeakSet<object>();

/**
 * The one funnel a host seals through: the app's sealer, checked. `undefined`
 * when no sealer was given — the host passes no request, exactly as before.
 *
 * @throws TypeError at construction when `sealer` is not a function.
 */
export function requestSealing(
  sealer: RequestSealer | undefined,
  door: string,
): ((facts: RequestSealFacts) => Promise<RequestContext | undefined>) | undefined {
  if (sealer === undefined) return undefined;
  if (typeof sealer !== 'function') {
    throw new TypeError(
      `[hosting] '${door}': sealRequest must be a function that returns ` +
        'requestContext({ secrets }) for one request, or undefined.',
    );
  }
  return async (facts) => {
    let handle: unknown;
    try {
      handle = await sealer(facts);
    } catch {
      // Never the sealer's message: it may quote the value it could not read.
      throw new WireRequestRefusal(
        REQUEST_NOT_SEALED,
        `'${door}': the credentials this request carries could not be sealed for its run.`,
        400,
      );
    }
    if (handle === undefined) return undefined;
    if (!isRequestContext(handle)) {
      throw new TypeError(
        `[hosting] '${door}': sealRequest must return a handle built by ` +
          'requestContext({ secrets }), or undefined — a plain object is refused, because its ' +
          'values would travel wherever the run options are logged or copied.',
      );
    }
    if (handedToARun.has(handle)) {
      throw new TypeError(
        `[hosting] '${door}': sealRequest returned a handle it returned before. Every ` +
          "request seals its own — a shared handle hands one caller's credential to another " +
          "caller's run.",
      );
    }
    handedToARun.add(handle);
    return handle;
  };
}
