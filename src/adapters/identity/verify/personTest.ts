/**
 * verify/personTest — only a person's token is a person (rule 5).
 *
 * A verified signature proves who SIGNED a token, not that it stands for a
 * person. On Entra ID any application registered in the tenant can obtain an
 * app-only token for this API by the client-credentials grant — right issuer,
 * right audience, a valid signature and an `oid` — and Microsoft says so:
 * "app-only tokens can be issued without a `roles` claim. Applications that
 * expose APIs must implement permission checks in order to accept tokens."
 * A verifier that accepted it would hand a service principal a `principal`,
 * conversations, a model budget and the agent's tools.
 *
 * Five checks, in this order, because each names a different shape:
 *
 *   c. `idtyp: "app"` — Entra's own marker, refused whenever present.
 *   d. `oid` equal to `sub` — Microsoft's documented app-only test.
 *   b. roles and NO scope claim at all — a daemon's token carries app roles
 *      instead of delegated scopes.
 *   a. the required scope in the scope claim — Microsoft: `scp` is "Only
 *      included for user tokens".
 *   e. the client that obtained the token is one this deployment lists — on
 *      Okta and Keycloak a client-credentials token may carry scopes too, and
 *      this is the check that refuses it there.
 *
 * a–d fail as `not-a-user-token`; e fails as `wrong-client`. `scp` alone is
 * Microsoft's test, not an IdP-neutral one; the five together are.
 */

import type { IdentityFailureClass } from '../../../hosting/errors.js';
import { claimAt, clientOf, scopesOf, type ClaimPath } from './claims.js';

/** What the person test is configured with. */
export interface PersonTestOptions {
  /** The OAuth scope only this API's person tokens carry. One scope, exact. */
  readonly requiredScope: string;
  /** Where the scopes are: `'scp'` (Entra, AD FS) or `'scope'` (RFC 9068, Keycloak, Okta). */
  readonly scopeClaim: ClaimPath;
  /** Clients allowed to obtain a person token for this API, or `'any'` (the check is off). */
  readonly allowedClients: readonly string[] | 'any';
  /** The configured roles claim — part of check b's "roles without a scope". */
  readonly rolesClaim: ClaimPath;
}

/** The failure class, or `undefined` when the token stands for a person. */
export function personTestFailure(
  payload: Readonly<Record<string, unknown>>,
  options: PersonTestOptions,
): Extract<IdentityFailureClass, 'not-a-user-token' | 'wrong-client'> | undefined {
  if (payload.idtyp === 'app') return 'not-a-user-token';
  const { oid, sub } = payload;
  if (typeof oid === 'string' && typeof sub === 'string' && oid === sub) return 'not-a-user-token';

  const scopes = scopesOf(claimAt(payload, options.scopeClaim));
  if (scopes === undefined && hasRoles(payload, options.rolesClaim)) return 'not-a-user-token';
  if (scopes === undefined || !scopes.includes(options.requiredScope)) return 'not-a-user-token';

  if (options.allowedClients === 'any') return undefined;
  const client = clientOf(payload);
  if (client === undefined || !options.allowedClients.includes(client)) return 'wrong-client';
  return undefined;
}

/** Entra's app roles live in `roles`; the configured claim may be another. */
function hasRoles(payload: Readonly<Record<string, unknown>>, rolesClaim: ClaimPath): boolean {
  return payload.roles !== undefined || claimAt(payload, rolesClaim) !== undefined;
}

/**
 * Unknown is not none (rule 14). When the roles claim was REPLACED by a
 * pointer to somewhere else — OIDC's distributed claims (`_claim_names`), which
 * is what Entra sends instead of `groups` above 200 groups, or Entra's
 * `hasgroups: true` — the person's roles are not in this token. Reading them
 * as "no roles" would strip a person silently; this says so instead.
 */
export function rolesAreElsewhere(
  payload: Readonly<Record<string, unknown>>,
  rolesClaim: ClaimPath,
): boolean {
  if (typeof rolesClaim !== 'string') return false;
  const names = payload._claim_names;
  if (names !== null && typeof names === 'object' && !Array.isArray(names)) {
    if (Object.prototype.hasOwnProperty.call(names, rolesClaim)) return true;
  }
  return rolesClaim === 'groups' && payload.hasgroups === true;
}
