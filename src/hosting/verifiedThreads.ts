/**
 * verifiedThreads — the {@link ThreadBinder} that binds a thread to a VERIFIED
 * caller, so the secure binding is the one-line one.
 *
 * A request names a thread; naming one proves nothing. This binder checks the
 * caller's credential with the door's own identity verification
 * (`verifyRequestIdentity` — the bearer token, through your verifier), never a
 * header read as a name, and keys the conversation by WHO
 * plus WHICH: the same thread id from two people is two conversations. The
 * run's `identity` names the verified person, so a stored conversation records
 * its owner and a later request from anyone else is refused as not found.
 *
 * A caller with no credential is REFUSED (401), even at a door that allows
 * anonymous requests elsewhere: a thread with no owner would be anybody's who
 * guessed its id.
 */

import { IdentityNotVerifiedError } from './errors.js';
import { verifyRequestIdentity, type IdentityVerificationOptions } from './identityVerification.js';
import type { ThreadBinder } from './protocolAdapter.js';

/**
 * Bind every thread to the caller `identity` verifies.
 *
 * @example
 * ```ts
 * import { jwksIdentity } from 'agentfootprint/security';
 * const threads = verifiedThreads(jwksIdentity({ jwksUrl, issuer, audience }));
 * streamHandler({ agent, adapter: agUi(), threads, sessions: memorySessions() });
 * ```
 */
export function verifiedThreads(identity: IdentityVerificationOptions): ThreadBinder {
  const binder: ThreadBinder = {
    async bind({ conversation, headers }) {
      const who = await verifyRequestIdentity(identity, headers, undefined);
      if (who === undefined) throw new IdentityNotVerifiedError('no-token', false);
      return {
        // Injective, and visible ASCII whatever the name (`josé`, `John Smith`):
        // both halves are percent-encoded, the separator included, so no
        // (who, which) pair spells another's key.
        sessionId: `${encodeURIComponent(who.userId)}/${encodeURIComponent(conversation)}`,
        identity: { principal: who.userId, conversationId: conversation },
      };
    },
  };
  return Object.freeze(binder);
}
