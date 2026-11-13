import { type ArtifactScope } from '../../../artifacts/types.js';
import { type MemoryIdentity } from '../../../memory/identity/types.js';

/**
 * WHO this request is for, when the transport said (9.12.0) — and `undefined`
 * when it did not, which leaves every earlier release's behaviour untouched to
 * the byte.
 *
 * The composition, field by field, because each one has a different rightful
 * source:
 *
 *  - `principal` — {@link HostRequest.userId}, the fact THIS request carried.
 *    It is the only field the transport supplies and the only one this function
 *    ever introduces.
 *  - `conversationId` — the namespace the conversation already runs in, else
 *    the session id. Composed with the 9.10.0 derivation rather than replacing
 *    it: a session IS a conversation, and moving a live conversation's
 *    namespace because a header appeared would lose its memory mid-thread.
 *  - `tenant` — whatever the stored identity carried. No transport field
 *    supplies one, so there is nothing here to override it with.
 *
 * **Why the header wins on `principal` specifically.** Every other field
 * belongs to the conversation and survives untouched; the actor belongs to the
 * request. Before this release `standingAgent` named no identity at all, so the
 * only principal a stored conversation can realistically carry is one an
 * EARLIER turn of this same mechanism put there — and preferring it would pin a
 * whole session to whoever spoke first, which is precisely the audit trail that
 * "looks complete and names the wrong party".
 *
 * **Nothing is invented.** With no session and no stored conversation there is
 * no conversation to name, and this returns `undefined` rather than fabricating
 * one; the id still reaches a custom handler on `HostRequest`. The managed
 * runtimes that forward a user require a session id on the same call, so that
 * gap is a guard rather than the shape this exists for.
 *
 * One consequence worth stating: naming an identity here takes the run off the
 * 9.10.0 derived rung, so `runIdentitySource: 'session'` is not written on this
 * path. The namespace is identical either way — the marker distinguishes a
 * namespace the caller chose from one the library derived, and on this path the
 * caller did choose.
 */
export function identityForRequest(
  userId: string | undefined,
  sessionId: string | undefined,
  stored: MemoryIdentity | undefined,
): MemoryIdentity | undefined {
  if (userId === undefined) return undefined;
  const conversationId = stored?.conversationId ?? sessionId;
  if (conversationId === undefined) return undefined;
  return {
    conversationId,
    ...(stored?.tenant !== undefined && { tenant: stored.tenant }),
    principal: userId,
  };
}

/**
 * The scope a SESSION's claim tickets live in, for the request being served —
 * the ONE composition of that tuple, shared by the two doors that need it.
 *
 * `answerArtifact` redeems under it, and a turn hands its host a store bound
 * to it (`reply.turnArtifacts`). One function rather than two call sites that
 * agree today: the field bug this exists for was a host that composed its own
 * tuple, got the session rung right and the signed-in rung wrong, and filed
 * every ticket where redemption would never look. Deliberately NOT exported —
 * a function a host can call with a user id is a function a host can call
 * with SOMEBODY ELSE's user id.
 *
 * `identityForRequest` when the request names a user, else the session rung
 * `{ conversationId: sessionId }` — what seed derives for an identity-less
 * served run.
 */
export function sessionArtifactScope(
  userId: string | undefined,
  sessionId: string,
  stored: MemoryIdentity | undefined,
): ArtifactScope {
  return identityForRequest(userId, sessionId, stored) ?? { conversationId: sessionId };
}

/**
 * Transport headers as the verifier reads them: string values only. A header
 * that arrived as an array (repeated) is dropped — except `authorization`,
 * which the caller refuses first (`repeatsAuthorization`): two credentials are
 * ambiguous, and dropping them would let the call proceed as anonymous at a
 * door that allows it.
 */
export function singleValuedHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (headers === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[name] = value;
  }
  return out;
}

/** Did the transport deliver `authorization` (any case) more than once? */
export function repeatsAuthorization(
  headers: Readonly<Record<string, string | readonly string[] | undefined>> | undefined,
): boolean {
  if (headers === undefined) return false;
  const values = Object.entries(headers).filter(([name]) => name.toLowerCase() === 'authorization');
  return values.length > 1 || values.some(([, value]) => Array.isArray(value));
}
