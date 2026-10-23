/**
 * hosting/processLocalStore — which session stores live in this process's
 * memory, and so cannot be read by another process.
 *
 * Role:  one fact for the proof that a closed pause's call never ran
 *        (`answeredPause.ts` · `closedConversation`). A request minted under
 *        this process's default decision ledger can be proven unspent only
 *        when no other process can have answered it — when its pause was kept
 *        in this process's memory. Any store that other processes can reach (a
 *        database, a file, a service) is never marked: another replica, on its
 *        own default ledger, may have spent the request and run the call.
 * Reads:  nothing. Writes: a process-local mark on the store object.
 *
 * Only the store object itself is marked: a wrapper around it (a proxy, a
 * decorator) is not, and proves nothing — the safe direction.
 */

const local = new WeakSet<object>();

/** Mark `store` as one that lives in this process's memory only (`memorySessions`). */
export function markProcessLocalStore(store: object): void {
  local.add(store);
}

/** Whether `store` was marked as living in this process's memory only. */
export function isProcessLocalStore(store: unknown): boolean {
  return typeof store === 'object' && store !== null && local.has(store);
}
