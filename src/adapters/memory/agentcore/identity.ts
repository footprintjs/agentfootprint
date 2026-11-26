import type { MemoryIdentity } from '../../../memory/identity/index.js';
import { IDENTITY_ABSENT } from '../../../memory/identity/index.js';
/**
 * Refuse, before any call, an identity this store cannot address: not an
 * object, or no `conversationId` — an absent one would encode to ONE session
 * every such identity shares.
 */
export function assertAddressable(identity: MemoryIdentity): void {
  if (identity === null || typeof identity !== 'object') {
    throw new TypeError('AgentCoreStore: an identity is required — got none.');
  }
  const { conversationId, tenant, principal } = identity as {
    readonly conversationId?: unknown;
    readonly tenant?: unknown;
    readonly principal?: unknown;
  };
  if (typeof conversationId !== 'string' || conversationId === '') {
    throw new TypeError(
      'AgentCoreStore: the identity has no `conversationId`. It is refused rather than filed ' +
        'under one session every such identity would share.',
    );
  }
  for (const [name, value] of [
    ['tenant', tenant],
    ['principal', principal],
  ] as const) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new TypeError(`AgentCoreStore: the identity's \`${name}\` must be a string.`);
    }
  }
}

/**
 * ── The AgentCore id encoders: the tenant boundary, in AWS's alphabet ──
 *
 * `actorId` and `sessionId` are where a `MemoryIdentity` becomes the address
 * AgentCore stores rows under, so the same law `identity/encode.ts` states
 * applies here word for word: the mapping must be **injective**, because two
 * tuples that spell one id are one scope reading and overwriting another's
 * memory — no race, no misconfiguration, just arithmetic.
 *
 * It was not. Until this fix the id was a lossy slug: every character outside
 * `[A-Za-z0-9_-]` became `-`, so `a.b`, `a/b` and `a b` were one actor; and the
 * two fields were joined with a bare `_`, so tenant `a_b` + principal `c` was
 * the same actor as tenant `a` + principal `b_c`. Both are cross-tenant.
 *
 * **Why this cannot call `encodeIdentityField`.** The shared encoder escapes to
 * `%25`/`%2F`/`%5F`, and AWS admits no `%` in either id. The constraints, read
 * from the AgentCore Memory data-plane API reference (`CreateEvent`, verified
 * 2026-08) rather than assumed, are:
 *
 *   actorId    1..255  `[a-zA-Z0-9][a-zA-Z0-9-_/]*(?::[a-zA-Z0-9-_/]+)*[a-zA-Z0-9-_/]*`
 *   sessionId  1..100  `[a-zA-Z0-9][a-zA-Z0-9-_]*`
 *
 * So the LAW is borrowed and the code is not: same three rules (escape the
 * escape, escape the separator, keep a present value off the absence marker),
 * a different alphabet. `shadowKey` below still delegates to the shared
 * encoder, because a process-local Map key has no charset to obey.
 *
 * **What is preserved byte for byte.** A field made only of `[A-Za-z0-9-]`
 * passes through untouched, and the joiner and the absence marker are the ones
 * this adapter always used — so `{ tenant: 'acme', principal: 'alice' }` is
 * still `afp-acme_alice`, and an omitted tenant is still a bare `_`. That is
 * what makes the fix deployable: an existing row written under a simple id
 * keeps its address. The ids that move are the ones that were sharing an
 * address with somebody else, and those were already broken.
 *
 * `_` is the one character a well-behaved-looking value does NOT keep: it is
 * the field joiner and the absence marker, so a value containing it must be
 * escaped or it would donate a field boundary — exactly what `/` does in the
 * shared encoder.
 */

/** AgentCore's own maxima, not a shared guess — see the note above. */
export const ACTOR_ID_MAX = 255;

export const SESSION_ID_MAX = 100;

/** Characters an escaped segment carries through unchanged. */
export const VERBATIM_ID_CHAR = /[A-Za-z0-9-]/;

/**
 * Escape one identity field into AgentCore's alphabet, reversibly.
 *
 * Every code unit outside {@link VERBATIM_ID_CHAR} becomes `introducer` + its
 * four-digit hex — fixed width, so a decoder reading `introducer` always knows
 * exactly how much to consume, which is what makes this a left inverse and
 * therefore injective.
 *
 * The escape character escapes ITSELF for free here, and that is deliberate:
 * `identity/encode.ts` has to order its two `.replace()` passes so `%` goes
 * first (reverse them and `a%2Fb` lands on the value that produced it). A
 * single left-to-right pass over code units has no ordering to get wrong — the
 * introducer is simply not in the verbatim set, so it is escaped like any other
 * character. Do not "optimise" this back into chained replaces.
 *
 * Code UNITS, not code points: a lone surrogate is a legal JS string and would
 * be flattened to U+FFFD by a UTF-8 pass, which is a collision.
 */
export function escapeIdSegment(raw: string, introducer: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    out += VERBATIM_ID_CHAR.test(ch)
      ? ch
      : introducer + raw.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

/**
 * One half of the actor tuple. Absence has exactly one spelling — `undefined`,
 * `null` and `''` all mean "not given" — and it is {@link IDENTITY_ABSENT},
 * the same sentinel the shared encoder uses.
 *
 * A present value can never spell the sentinel, because `_` is not verbatim:
 * a tenant literally named `_` encodes to `/005F`. That is the third rule,
 * satisfied by construction rather than by a special case.
 */
export function actorSegment(raw: string | undefined | null): string {
  return raw === undefined || raw === null || raw === ''
    ? IDENTITY_ABSENT
    : escapeIdSegment(raw, '/');
}

/**
 * Apply AgentCore's length ceiling — by refusing, never by truncating.
 *
 * Truncation (with or without a hash tail, which is what this adapter used to
 * do) maps infinitely many identities onto finitely many ids, so it cannot be
 * injective: it converts "your id is too long" into "your tenant occasionally
 * reads someone else's memory", silently. A caller can shorten an id; a caller
 * cannot detect a collision.
 *
 * The offending value is NOT quoted. This is the identity boundary, and an
 * error string is the one place a tenant id must never travel.
 */
export function boundedId(body: string, max: number, field: 'actor' | 'session'): string {
  const id = `afp-${body}`;
  if (id.length <= max) return id;
  throw new RangeError(
    `AgentCoreStore: the ${field} id for this identity encodes to ${id.length} characters, over ` +
      `AgentCore's ${max}-character limit for ${field}Id. It is deliberately not truncated to fit — ` +
      `truncating two identities to one id is how one tenant reads another's memory, and a hash tail ` +
      `makes that unlikely rather than impossible. Shorten the ` +
      `${
        field === 'actor' ? '`tenant` / `principal`' : '`conversationId`'
      } at the call site. (Anything ` +
      `outside [A-Za-z0-9-] escapes to five characters, so punctuation and non-ASCII count for more ` +
      `than they look.) The value is not quoted here on purpose: it addresses a tenant.`,
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

// (`fnv1a` lived here to build the hash tail of a truncated id. Truncation is
// gone — see `boundedId` — and with it the only caller.)

// MemoryIdentity → AgentCore (actorId, sessionId). The actor is the user/tenant; the
// session is the conversation. Both are derived deterministically, id-safe and
// INJECTIVELY — see the encoder note above `escapeIdSegment` for why that last word
// is the whole isolation guarantee and not a tidiness claim.
function actorId(identity: MemoryIdentity): string {
  // `_` joins the two halves and neither half can contain one (it is escaped),
  // so the join cannot move a field boundary.
  return boundedId(
    `${actorSegment(identity.tenant)}_${actorSegment(identity.principal)}`,
    ACTOR_ID_MAX,
    'actor',
  );
}

function sessionId(identity: MemoryIdentity): string {
  // One field, so no joiner — but `sessionId` admits no `/`, so it escapes with
  // `_` instead. `-` stays verbatim in both, which is what keeps a UUID a UUID.
  return boundedId(escapeIdSegment(identity.conversationId, '_'), SESSION_ID_MAX, 'session');
}

export function agentCoreScope(memoryId: string, identity: MemoryIdentity) {
  assertAddressable(identity);
  return { memoryId, actorId: actorId(identity), sessionId: sessionId(identity) };
}
