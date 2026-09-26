/**
 * servingConversation — WHICH conversation a run's self-explain evidence is
 * kept and served under, and which run that was. Internal: nothing here is on
 * the `Agent` class's public surface.
 *
 * THE KEY SPACES ARE DISJOINT BY CONSTRUCTION (recheck RB1). A session id is a
 * string a client chose — any visible ASCII, `#` included — so it can never be
 * compared against a key the library minted. Every key is namespaced:
 *
 *  - `session:<sessionId>` — a run with a session ({@link sessionConversationKey});
 *  - `hosted:<uuid>` — a HOSTED run with no session: `standingAgent` mints a
 *    random UUID per request and hands it in through
 *    {@link withHostedConversation}; unguessable, and in a space no session id
 *    can enter, so no other caller — signed in or not — can name it;
 *  - `undefined` — a DIRECT, unhosted run with no session: the single-user
 *    path, where "the previous run with no session" is the caller's own.
 *
 * Why not a session id for the hosted case: a session id also decides the
 * memory namespace (seed's session rung), `EventMeta.sessionId` and
 * tool-session teardown, and a request that named no session changes none of
 * those.
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

/** The evidence key of a run with a session. */
export function sessionConversationKey(sessionId: string): string {
  return `session:${sessionId}`;
}

/** The evidence key of a hosted run with no session, from the host's minted id. */
export function hostedConversationKey(minted: string): string {
  return `hosted:${minted}`;
}

/** The host's minted id a run's options carry, if any. */
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
  /** A hosted request with no session: nobody can ever ask a follow-up. */
  readonly oneShot?: boolean;
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
