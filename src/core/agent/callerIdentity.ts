/**
 * Caller identity is read from the checkpoint's explicit origin facts.
 * Names and identifier shapes never establish provenance or authentication.
 * Migration: 14 requires the source marker written by its seed for a stored
 * runIdentity. Older ambiguous pause state is refused rather than guessed.
 */

import type { MemoryIdentity } from '../../memory/identity/types.js';

/** The keys of the paused run's state this module reads — never writes. */
interface SeededState {
  readonly runIdentity?: unknown;
  readonly runIdentitySource?: unknown;
  readonly runSessionId?: unknown;
}

/**
 * A copy of the caller-named identity, only when the checkpoint explicitly
 * records the caller rung. Derived namespaces are never promoted to a caller.
 */
export function callerIdentityOf(state: unknown): MemoryIdentity | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  const seeded = state as SeededState;
  return seeded.runIdentitySource === 'caller' ? wellFormed(seeded.runIdentity) : undefined;
}

/**
 * The identity the paused run's memory namespace and credentials are restored
 * from — `scope.runIdentity` as the checkpoint carries it, whatever its source —
 * as a validated copy; `undefined` when absent; `'malformed'` when the
 * checkpoint's own fields disagree: a value that is not an identity, or a
 * session-rung marker (`runIdentitySource: 'session'`) on anything but exactly
 * `{ conversationId }` — the only shape seed's session rung writes.
 */
export function restoredIdentityOf(state: unknown): MemoryIdentity | 'malformed' | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  const seeded = state as SeededState;
  if (seeded.runIdentity === undefined) return undefined;
  const identity = wellFormed(seeded.runIdentity);
  if (identity === undefined) return 'malformed';
  switch (seeded.runIdentitySource) {
    case 'caller':
      return identity;
    case 'session':
    case 'composition':
    case 'run':
      if (!conversationOnly(identity)) return 'malformed';
      break;
    default:
      return 'malformed';
  }
  return identity;
}

/**
 * The session actually recorded by seed. No conversation-id or run-id shape
 * fallback: a checkpoint cannot manufacture the host's transport context.
 */
export function pausedSessionOf(state: unknown): string | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  const seeded = state as SeededState;
  return typeof seeded.runSessionId === 'string' ? seeded.runSessionId : undefined;
}

/**
 * Refuse, when a run BEGINS, an identity that is not one: not an object, a
 * field that is present and not a string, or no field at all. TypeScript
 * already forbids these; a JavaScript caller can still pass them, and without
 * this door the run would start, pause, and then every resume of it — bare ones
 * included — would refuse as a malformed checkpoint (recheck NIT 2). The
 * refusal lands where the mistake was made.
 *
 * @throws TypeError naming the door and the field.
 */
export function assertIdentityShape(identity: unknown, door: string): void {
  if (identity === undefined) return;
  if (identity === null || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new TypeError(
      `${door}: identity must be an object like { conversationId, principal?, tenant? }.`,
    );
  }
  const raw = identity as Record<string, unknown>;
  for (const key of ['conversationId', 'tenant', 'principal'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') {
      throw new TypeError(
        `${door}: identity.${key} must be a string when present (got ${typeof raw[key]}).`,
      );
    }
  }
  if (raw.conversationId === undefined && raw.tenant === undefined && raw.principal === undefined) {
    throw new TypeError(
      `${door}: identity names nothing — pass { conversationId, principal?, tenant? }, or omit identity.`,
    );
  }
}

/** Do two identities name the same tenant, principal and conversation? */
export function sameIdentity(a: MemoryIdentity, b: MemoryIdentity): boolean {
  return (
    a.conversationId === b.conversationId && a.principal === b.principal && a.tenant === b.tenant
  );
}

/** A fresh `MemoryIdentity` from an untrusted value — strings only, or nothing. */
function wellFormed(value: unknown): MemoryIdentity | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  // Every field a string or absent (a JS caller can omit `conversationId`;
  // what they named is still theirs), and at least one present.
  for (const key of ['conversationId', 'tenant', 'principal'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') return undefined;
  }
  if (raw.conversationId === undefined && raw.tenant === undefined && raw.principal === undefined) {
    return undefined;
  }
  return {
    ...(typeof raw.conversationId === 'string' && { conversationId: raw.conversationId }),
    ...(typeof raw.tenant === 'string' && { tenant: raw.tenant }),
    ...(typeof raw.principal === 'string' && { principal: raw.principal }),
  } as MemoryIdentity;
}

/** Seed's third rung has exactly one field, a string conversation id. */
function conversationOnly(identity: MemoryIdentity): boolean {
  return (
    typeof identity.conversationId === 'string' &&
    identity.tenant === undefined &&
    identity.principal === undefined
  );
}
