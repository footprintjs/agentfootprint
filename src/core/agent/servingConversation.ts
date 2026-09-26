/**
 * servingConversation — WHICH conversation a run's self-explain evidence is
 * kept and served under, and which run that was. Internal: nothing here is on
 * the `Agent` class's public surface.
 *
 * The key is the run's `sessionId` when it has one. A HOSTED run with no
 * session (a request `standingAgent` served without a `sessionId`) is keyed by
 * the host's per-request key (`#anonymous-N`) instead, handed in through
 * {@link withHostedConversation} — a key no later request can present, so no
 * other caller, signed in or not, can read that run's evidence. Only a DIRECT,
 * unhosted run with no session shares the `undefined` key: the single-user
 * path, where "the previous run with no session" is the caller's own.
 *
 * Why not `sessionId`: a session id also decides the memory namespace (seed's
 * session rung), `EventMeta.sessionId` and tool-session teardown, and a
 * request that named no session must change none of those.
 */

import type { RunOptions } from 'footprintjs';

/** The option key a host sets its per-request key under. Not a public option. */
const HOSTED_CONVERSATION = Symbol('agentfootprint.hostedConversation');

/**
 * `options` plus the host's key for a run that has no session — a copy; the
 * caller's object is not touched.
 *
 * @example
 * ```ts
 * runner.run(input, withHostedConversation(runOptions, sessionKey));
 * ```
 */
export function withHostedConversation<T extends RunOptions | undefined>(
  options: T,
  key: string,
): NonNullable<T> {
  return Object.assign({}, options, { [HOSTED_CONVERSATION]: key }) as NonNullable<T>;
}

/** The host's key a run's options carry, if any. */
export function hostedConversationOf(options: unknown): string | undefined {
  if (options === null || typeof options !== 'object') return undefined;
  const key = (options as { [HOSTED_CONVERSATION]?: unknown })[HOSTED_CONVERSATION];
  return typeof key === 'string' ? key : undefined;
}

/** What an agent answers when asked which conversation it is serving. */
export interface ServingConversation {
  /** The evidence key — see the module note. `undefined` = direct, no session. */
  readonly conversation: string | undefined;
  /** The run in flight, or the one served last. */
  readonly runId: string;
}

const registry = new WeakMap<object, () => ServingConversation>();

/** Called once by the agent's constructor. */
export function registerServingConversation(agent: object, read: () => ServingConversation): void {
  registry.set(agent, read);
}

/**
 * The conversation `agent` is serving (or served last). Throws for an object
 * that never registered — a wiring bug, never a runtime condition.
 */
export function servingConversationOf(agent: object): ServingConversation {
  const read = registry.get(agent);
  if (read === undefined) throw new Error('servingConversationOf: not an Agent');
  return read();
}
