/**
 * hosting/memorySessions — conversations in a Map.
 *
 * The smallest thing that satisfies `SessionLifecycle`, for tests and for local
 * development where a Redis is ceremony you have not earned yet. It is exactly
 * as durable as the process: restart and every conversation is gone.
 *
 * That is not a shortcoming to apologise for, it is the point of the port. Swap
 * this for a store that survives a restart and the standing agent is unchanged
 * — which is also how the "a crashed process resumes the conversation" test is
 * written: keep the store, throw away everything else, and watch the
 * conversation come back through the envelope alone.
 */

import type { CheckpointEnvelope, SessionLifecycle } from './types.js';

/**
 * An in-process session store.
 *
 * @example
 *   const sessions = memorySessions();
 *   await standingAgent({ agent, sessions, host: nodeHost({ port: 8080 }) });
 */
export function memorySessions(): SessionLifecycle {
  const stored = new Map<string, CheckpointEnvelope>();
  return {
    hydrate: (sessionId) => Promise.resolve(stored.get(sessionId)),
    persist: (sessionId, envelope) => {
      stored.set(sessionId, envelope);
      return Promise.resolve();
    },
  };
}
