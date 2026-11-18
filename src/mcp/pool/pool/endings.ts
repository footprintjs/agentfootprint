import type { ClientPort } from '../../clientPort.js';
import type { Ending } from '../../terminate.js';
import type { PooledClient } from '../pooledClient.js';

/** A port that can only end: what a half-opened session leaves the pool. */
export function endingOnly(halfOpen: { end(): ReturnType<ClientPort['end']> }): ClientPort {
  return {
    listing: () => Promise.reject(new Error('This client never opened.')),
    bind: () => {
      throw new Error('This client never opened.');
    },
    end: () => halfOpen.end(),
  };
}

/**
 * A lost handle's ending: nothing can be sent for it, so the remote outcome is
 * known at once — `handle-lost`, unresolved — and the work is the local close
 * alone, which the ending stays charged for until it settles.
 */
export function closeLocally(client: PooledClient): Ending {
  const target = client.client;
  const settled =
    target === undefined
      ? Promise.resolve()
      : Promise.resolve()
          .then(() => target.close())
          .then(
            () => undefined,
            () => undefined,
          );
  return {
    outcome: Promise.resolve({ remote: 'handle-lost', resolved: false, durationMs: 0 }),
    settled,
  };
}
