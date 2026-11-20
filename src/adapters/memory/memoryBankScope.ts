/**
 * The Memory Bank scope law: what an app's `scopeFor` result must be before
 * any of it is sent to the service as a memory's `scope`. One function, used
 * by every operation of `memoryBank.ts · MemoryBankStore` through its
 * `resolveScope`, so list, search, get, put, delete and forget can never
 * disagree about whose memory they address.
 *
 * Memory Bank matches scope EXACTLY and a written scope is immutable, so the
 * law is about never letting two different scopes become one:
 *
 *   scopeFor → { tenant: 't1', principal: 'a*b' }  → sent as { tenant: 't1', principal: 'a%2Ab' }
 *   scopeFor → { tenant: 42, principal: 'alice' }  → refused: part 'tenant' is not text
 *   scopeFor → {}                                  → refused: an empty scope
 *
 * Kept apart from `memoryBank.ts` because that file is above the repository's
 * file-size ceiling and may not grow.
 */

/**
 * The scope to send, or a `TypeError` that names what is wrong with it.
 *
 * Refused, and never dropped (finding r3-61-adapters-memory-6): a part whose
 * value is not text, or whose key is empty. This used to filter such a part
 * out, which WIDENED the scope — an app whose `scopeFor` handed over a numeric
 * tenant id from request data (plain JavaScript, or a value typed `any`) put
 * every tenant under `{ principal }`, and tenant 43 listed, read and erased
 * tenant 42's memories. The refusal names the key and never the value, because
 * the value addresses a tenant and an error message travels further than it
 * should. Rows already written under such a narrowed scope keep it: the
 * service's scope is immutable, so a corrected `scopeFor` does not see them.
 *
 * @example
 *   serviceScope('memoryBankStore', { tenant: 't1', principal: 'alice' }, 'c1')
 *   // → { tenant: 't1', principal: 'alice' }
 */
export function serviceScope(
  adapter: string,
  scope: unknown,
  conversationId: string,
): Readonly<Record<string, string>> {
  const entries = Object.entries(scope ?? {}) as [string, unknown][];
  for (const [key, value] of entries) {
    if (key !== '' && typeof value === 'string') continue;
    const part =
      key === ''
        ? 'a scope part with an empty key'
        : `scope part '${key}', whose value is not text,`;
    throw new TypeError(
      `${adapter}: 'scopeFor' returned ${part} for conversation '${conversationId}'.\n` +
        `  Every part must be text under a non-empty key. Leaving the part out would widen ` +
        `the scope to everyone who differs only in it, so it is refused, not dropped; ` +
        `convert it to text in scopeFor (the value is not quoted here: it addresses a tenant).`,
    );
  }
  if (entries.length === 0) {
    throw new TypeError(
      `${adapter}: 'scopeFor' produced an empty scope for conversation ` +
        `'${conversationId}'.\n` +
        `  An empty scope is not "no scoping" — it is a real scope that matches every other ` +
        `empty-scoped memory in the bank, whoever wrote it. Return at least one key.`,
    );
  }
  // The service rejects `*` in a scope value, so one is ESCAPED rather than
  // passed on — a tenant named with one is a NAME, not a wildcard. Escaped
  // and not replaced: mapping `*` onto some other character merges two
  // different scopes into one address, which is the isolation bug this
  // function exists to prevent (`*` used to become `_`, landing a tenant named
  // `*` on top of the no-tenant scope). `%` goes first because it introduces
  // the escape; a value that arrived already encoded is escaped again, which
  // is unreadable but injective, and unreadable-and-separate beats legible
  // and shared.
  return Object.fromEntries(
    entries.map(([key, value]) => [
      key,
      (value as string).replace(/%/g, '%25').replace(/\*/g, '%2A'),
    ]),
  );
}
