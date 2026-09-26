/**
 * verify/claims — reading a verified claim set, one rule per kind of claim.
 *
 * Three readings, and the difference between them is the whole file:
 *
 *   • **A roles claim is a LIST.** An array contributes each string entry as
 *     one role; a single string is ONE role. `"Not neo-users"` is the role
 *     `Not neo-users` — never the two roles `Not` and `neo-users`, which is how
 *     a space-splitting reader lets a group name satisfy a role gate it does
 *     not name. (`'space-delimited'` keeps the old reading, by request only.)
 *   • **A scope claim is space-delimited** — RFC 8693 §4.2 / RFC 9068 §2.2.3
 *     define `scope` that way, and Entra's `scp` follows it. An array is also
 *     read, entry by entry.
 *   • **A claim NAME is never split.** `urn:neo:objectguid` and
 *     `http://schemas.microsoft.com/…/role` contain dots and colons and are one
 *     name each. A nested claim is named by a PATH — an array of names
 *     (`['realm_access', 'roles']` for Keycloak) — never by a dotted string.
 *
 * Comparison is always exact, and nothing here trims, case-folds or tidies a
 * value: ids are opaque bytes (rule 7).
 */

/** A top-level claim name, or a path of names into nested objects. */
export type ClaimPath = string | readonly string[];

/** How a roles claim's single STRING is read. */
export type RolesFormat = 'list' | 'space-delimited';

/** The value at `path`, or `undefined`. A string path is ONE name. */
export function claimAt(payload: Readonly<Record<string, unknown>>, path: ClaimPath): unknown {
  if (typeof path === 'string') return payload[path];
  let at: unknown = payload;
  for (const name of path) {
    if (at === null || typeof at !== 'object' || Array.isArray(at)) return undefined;
    at = (at as Record<string, unknown>)[name];
  }
  return at;
}

/** A path, spelled for a banner or a refusal — never a value. */
export function pathLabel(path: ClaimPath): string {
  return typeof path === 'string' ? path : path.join(' → ');
}

/**
 * Roles out of a claim value, never invented: ABSENT when the claim is absent,
 * empty, or holds no string.
 */
export function rolesOf(value: unknown, format: RolesFormat): readonly string[] | undefined {
  if (Array.isArray(value)) {
    const roles = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
    return roles.length > 0 ? roles : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    if (format === 'space-delimited') return value.trim().split(/\s+/);
    return [value];
  }
  return undefined;
}

/**
 * Scopes out of a scope claim: a space-delimited string or an array of
 * strings. ABSENT when the claim is absent or holds nothing — which is not the
 * same fact as "holds no matching scope", and the person test tells them apart.
 */
export function scopesOf(value: unknown): readonly string[] | undefined {
  if (Array.isArray(value)) {
    const scopes = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
    return scopes.length > 0 ? scopes : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) return value.trim().split(/\s+/);
  return undefined;
}

/**
 * The claims that name the client which OBTAINED a token, in the order they
 * are read: `azp` (OIDC, Entra v2, Keycloak), `appid` (Entra v1, AD FS), `cid`
 * (Okta), `client_id` (RFC 9068).
 */
export const CLIENT_CLAIMS: readonly string[] = ['azp', 'appid', 'cid', 'client_id'];

/**
 * The client that obtained the token: the FIRST of {@link CLIENT_CLAIMS} that
 * is present. A present claim that is not a non-empty string names nobody, and
 * the answer is `undefined` — never a fall-through to the next claim, which
 * would let a token choose which of its claims is read.
 */
export function clientOf(payload: Readonly<Record<string, unknown>>): string | undefined {
  for (const name of CLIENT_CLAIMS) {
    const value = payload[name];
    if (value === undefined) continue;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
  return undefined;
}
