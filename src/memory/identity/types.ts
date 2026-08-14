import { encodeIdentityField } from './encode.js';

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
 * storage adapters that need a single string key (Redis, SQLite columns,
 * object-store keys). Format is stable across library versions — adapters
 * can safely use it for long-lived keys.
 *
 * **The encoding is INJECTIVE: two different identities never produce the
 * same namespace.** That is the isolation guarantee itself, not a detail of
 * it — a namespace two tuples share is a scope that reads and overwrites
 * another scope's rows, with no race required. It held only for well-behaved
 * ids before 9.36.x: `{ tenant: 'acme/hr', principal: 'alice' }` and
 * `{ tenant: 'acme', principal: 'hr/alice' }` spelled one namespace, and a
 * JWT `sub` is routinely a URI. Each field is now escaped by
 * {@link encodeIdentityField} before it is joined, so a value can no longer
 * donate a field boundary — do not "simplify" the joins back to raw
 * interpolation.
 *
 * A missing `tenant` / `principal` / `conversationId` is the segment `_`, so
 * the shape stays constant (three segments, easy to list by prefix), and a
 * field whose VALUE is `_` encodes as `%5F` so "no tenant" and "the tenant
 * named `_`" stay two different scopes.
 *
 * Building a FILESYSTEM path? Use `scopeSegments` from `artifacts/scopePath`
 * instead: it encodes each field for a path (`.` included, so a field of `..`
 * cannot be a directory hop). This namespace is a key, not a path.
 */
export function identityNamespace(identity: MemoryIdentity): string {
  return [
    encodeIdentityField(identity.tenant),
    encodeIdentityField(identity.principal),
    encodeIdentityField(identity.conversationId),
  ].join('/');
}
