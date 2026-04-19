/**
 * MemoryIdentity — hierarchical scoping for everything memory-related.
 *
 * The library enforces isolation at every storage call: no cross-tenant
 * reads, no cross-principal writes, period. Enterprise deploys (Azure Entra,
 * AWS SSO, etc.) surface tenant + principal from the incoming request;
 * simpler deploys just use `conversationId`.
 *
 * Why three fields instead of one "key"?
 *   - `tenant`     — organization / workspace / account boundary
 *   - `principal`  — user / service-account identity within the tenant
 *   - `conversationId` — a single thread / session for that principal
 *
 * Storage adapters prefix namespaces with the full identity tuple. A bug in
 * a multi-tenant app that passes the wrong `tenant` can't accidentally read
 * another customer's memory — the tuple mismatch surfaces as "no data"
 * rather than a silent leak.
 *
 * Fields after `conversationId` are reserved for future expansion (agent id,
 * role, etc.) without breaking existing stores.
 */
export interface MemoryIdentity {
  /**
   * Optional organization / workspace / account boundary. Omit for
   * single-tenant deploys. Storage adapters MUST refuse cross-tenant reads
   * when this field is set.
   */
  readonly tenant?: string;

  /**
   * Optional user / service-account identity within the tenant. Isolates
   * memory per end-user inside a shared tenant.
   */
  readonly principal?: string;

  /**
   * Required — the conversation / session / thread id. Stable across
   * multiple `agent.run()` calls so history accumulates correctly.
   */
  readonly conversationId: string;
}

/**
 * Encode a MemoryIdentity as a deterministic storage namespace. Used by
 * storage adapters that need a single string key (Redis, localStorage,
 * filesystem paths). Format is stable across library versions — adapters
 * can safely use it for long-lived keys.
 *
 * Empty `tenant` / `principal` collapse to `_` so the format has a constant
 * shape (easy to parse, easy to list by prefix).
 */
export function identityNamespace(identity: MemoryIdentity): string {
  const tenant = identity.tenant || '_';
  const principal = identity.principal || '_';
  return `${tenant}/${principal}/${identity.conversationId}`;
}
