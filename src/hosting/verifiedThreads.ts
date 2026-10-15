/**
 * verifiedThreads — the {@link ThreadBinder} that binds a thread to a VERIFIED
 * caller, so the secure binding is the one-line one.
 *
 * A request names a thread; naming one proves nothing. This binder checks the
 * caller's credential with the door's own identity verification
 * (`verifyRequestIdentity` — a bearer token through your verifier, or a
 * sign-in), never a header read as a name, and keys the conversation by WHO
 * plus WHICH: the same thread id from two people is two conversations. The
 * run's `identity` names the verified person, so a stored conversation records
 * its owner and a later request from anyone else is refused as not found.
 *
 * A caller with no credential is REFUSED (401), even at a door that allows
 * anonymous requests elsewhere: a thread with no owner would be anybody's who
 * guessed its id.
 */

import { encodeIdentityField } from '../memory/identity/encode.js';
import { IdentityNotVerifiedError } from './errors.js';
import { verifyRequestIdentity, type DoorIdentity } from './identityVerification.js';
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
export function verifiedThreads(identity: DoorIdentity): ThreadBinder {
  const binder: ThreadBinder = {
    async bind({ conversation, headers }) {
      const who = await verifyRequestIdentity(identity, headers, undefined);
      if (who === undefined) throw new IdentityNotVerifiedError('no-token', false);
      return {
        // Injective: both halves escape the separator, so no (who, which) pair
        // spells another's key.
        sessionId: `${encodeIdentityField(who.userId)}/${encodeIdentityField(conversation)}`,
        identity: { principal: who.userId, conversationId: conversation },
      };
    },
  };
  return Object.freeze(binder);
}
