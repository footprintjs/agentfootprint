/**
 * identityKey — the conversation a pooled client belongs to, as one key.
 *
 * Pattern: the library's one identity encoding, never a second.
 * Role:    The client key is `identityNamespace` of the identity the CALLER
 *          named — each field through `encodeIdentityField`, the encoding the
 *          memory layer calls the tenant boundary. It is injective: tenant
 *          `acme/hr` with principal `alice` and tenant `acme` with principal
 *          `hr/alice` are two keys, and an absent field and a field named `_`
 *          are two keys. A pool is one server, so the key needs no server
 *          segment, and two pools never share a client.
 *
 * Two doors only: the run's caller identity (`ToolDispatchContext.callerIdentity`,
 * `ToolExecutionContext.identity`) and the identity app code passes to `acquire`
 * and `terminate`. Never tool arguments, model output, a message, a request
 * body, or a `sessionId` alone. No identity value is ever written to an error,
 * an event or a report: the wire carries `keyHash`, the tool-session digest.
 */

import { encodeIdentityField } from '../../memory/identity/encode.js';
import { identityNamespace } from '../../memory/identity/types.js';
import { hashSessionKey } from '../../tools/toolSessions.js';
import type { McpPoolIdentity } from './options.js';

/** One conversation's key, and the coarser keys its budgets count by. */
export interface PoolKey {
  /** `identityNamespace` of the identity — the client key. */
  readonly key: string;
  /** The tenant and principal segments — what `maxClientsPerPrincipal` counts by. */
  readonly principal: string;
  /** The tenant segment — always part of a shared definitions context. */
  readonly tenant: string;
  /** The digest the record carries in the key's place. */
  readonly keyHash: string;
  /** The identity itself, as a frozen copy — what the transport factory and `share` are asked with. */
  readonly identity: McpPoolIdentity;
}

/** What an identity must carry. */
export interface IdentityRules {
  readonly requirePrincipal: boolean;
  readonly requireTenant: boolean;
}

/**
 * The key for `identity`, or why there is none: `'no-identity'` when nothing was
 * named (a derived identity counts as none), `'incomplete-identity'` when it
 * lacks a `conversationId`, a required `principal` or a required `tenant`, or a
 * field is not a string.
 */
export function poolKeyOf(
  identity: unknown,
  rules: IdentityRules,
): PoolKey | 'no-identity' | 'incomplete-identity' {
  if (identity === undefined || identity === null) return 'no-identity';
  if (typeof identity !== 'object' || Array.isArray(identity)) return 'incomplete-identity';
  const raw = identity as Record<string, unknown>;
  const fields: { -readonly [K in keyof McpPoolIdentity]?: string } = {};
  for (const name of ['tenant', 'principal', 'conversationId'] as const) {
    let value: unknown;
    try {
      value = raw[name];
    } catch {
      return 'incomplete-identity';
    }
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') return 'incomplete-identity';
    fields[name] = value;
  }
  if (fields.conversationId === undefined) return 'incomplete-identity';
  if (rules.requirePrincipal && fields.principal === undefined) return 'incomplete-identity';
  if (rules.requireTenant && fields.tenant === undefined) return 'incomplete-identity';
  const named = Object.freeze({
    conversationId: fields.conversationId,
    ...(fields.tenant !== undefined && { tenant: fields.tenant }),
    ...(fields.principal !== undefined && { principal: fields.principal }),
  }) as McpPoolIdentity;
  const key = identityNamespace(named);
  const tenant = encodeIdentityField(named.tenant);
  return {
    key,
    principal: `${tenant}/${encodeIdentityField(named.principal)}`,
    tenant,
    keyHash: hashSessionKey(key),
    identity: named,
  };
}

/**
 * Which keys a scope names. The tenant is matched exactly, always — an absent
 * tenant is the absent segment, never a wildcard, because the tenant is the
 * boundary. A scope that names a `conversationId` names exactly that one
 * conversation (an absent principal is then the absent segment, as in the key).
 * A scope without one names every conversation of its principal, and a scope
 * without a principal either names every conversation of its tenant.
 */
export function scopeMatcher(scope: {
  readonly tenant?: string;
  readonly principal?: string;
  readonly conversationId?: string;
}): (key: PoolKey) => boolean {
  const tenant = encodeIdentityField(scope.tenant);
  if (scope.conversationId !== undefined && scope.conversationId !== '') {
    const exact = identityNamespace({
      conversationId: scope.conversationId,
      ...(scope.tenant !== undefined && { tenant: scope.tenant }),
      ...(scope.principal !== undefined && { principal: scope.principal }),
    });
    return (key) => key.key === exact;
  }
  if (scope.principal !== undefined && scope.principal !== '') {
    const principal = `${tenant}/${encodeIdentityField(scope.principal)}`;
    return (key) => key.principal === principal;
  }
  return (key) => key.tenant === tenant;
}
