/**
 * requestOfRun — the ONE reader of a runner's `options.request`.
 *
 * Every runner's `run()` / `resume()` reads the incoming request here, at its
 * door and before anything moves: a value `requestContext()` did not build is
 * refused by name. What it returns goes to exactly two places — the agent's
 * own run (`Agent.runRequest`) or the run a composition opens for its members
 * (`memberRun.ts · openParentRun`). It is never written to state, and the
 * engine is handed the options without it (`RunnerBase · runSignalOf`).
 *
 * Pattern: guard + accessor. Role: core, run input.
 */

import { assertRequestContext, type RequestContext } from '../identity/requestContext.js';

/**
 * The sealed request a runner's options carry, or `undefined`.
 *
 * @throws TypeError (naming `door`) when `request` is not a sealed request.
 */
export function requestOf(
  options: { readonly request?: unknown } | undefined,
  door: string,
): RequestContext | undefined {
  const request = options?.request;
  assertRequestContext(request, door);
  return request as RequestContext | undefined;
}
