/**
 * hosting/sessionRetention — the ONE feature detection for the port's
 * retention member, and the refusal a store that has none produces.
 *
 * ── Why this is a function and not `sessions.retention?.()` ──────────────────
 * Because `?.()` answers `undefined`, and `undefined` is exactly the wrong
 * answer here. Every other optional member on this port is asked for behind a
 * door that refuses by name when it is absent — `session-list` does not report
 * "you have no conversations" when a store keeps no index — and retention needs
 * that more than either of them, not less: a cleanup job whose call returned
 * without complaining looks precisely like a cleanup job that is working. The
 * difference surfaces the day somebody asks how long conversations are kept,
 * and by then the answer is "all of them, since the beginning".
 *
 * So the detection lives here, once, and produces
 * {@link SessionRetentionUnavailableError} rather than a value that reads as
 * "fine". A caller that wants the silent shape can still write
 * `sessions.retention?.()` — the port is honest about what it has — but nothing
 * in this package does, and the door somebody reaches for first refuses.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 * It does not sweep, schedule, or decide a cutoff. The cutoff is a policy
 * decision — a jurisdiction, a contract, a retention schedule somebody signed —
 * and a library that shipped a default would be answering a legal question with
 * a constant. It hands back what the store can do; WHEN is yours.
 */

import { SessionRetentionUnavailableError } from './errors.js';
import type { SessionLifecycle, SessionRetention } from './types.js';

/**
 * How a store's conversations stop existing — or a refusal that names the
 * store's limitation.
 *
 * The same detection every door in this package uses (`typeof … ===
 * 'function'`), in the one place a consumer reaches for it, so a store that
 * implements the member and a store that does not are told apart once rather
 * than at every call site.
 *
 * @param sessions The store to ask.
 * @param purpose What you are doing, in your own words. It becomes the first
 *   clause of the refusal, so an operator reading a log knows which job stopped
 *   — the same reason the session-history refusals carry their op name.
 *
 * @throws SessionRetentionUnavailableError when the store implements no
 *   `retention()`. Never returns `undefined`: a caller cannot mistake "this
 *   store cannot expire anything" for "there was nothing to expire".
 *
 * @example  A nightly job, against whatever store this deployment was built with
 *   const policy = sessionRetention(sessions, 'the nightly retention job');
 *   if (policy.deletedBy === 'this-store') {
 *     let more = true;
 *     while (more) ({ more } = await policy.forgetOlderThan(Date.now() - THIRTY_DAYS));
 *   } else {
 *     // Nothing to run: the backend expires them. Log what turns it on.
 *     console.log(policy.active ? 'expiry is armed' : policy.enableWith);
 *   }
 */
export function sessionRetention(
  sessions: SessionLifecycle,
  purpose = 'expiring old conversations',
): SessionRetention {
  // Read once into a local: a store is free to be a class instance, a literal,
  // or a Proxy, and asking twice would let a getter answer differently between
  // the check and the call — the shape of bug feature detection exists to
  // remove, not to introduce.
  const member = sessions.retention;
  if (typeof member !== 'function') throw new SessionRetentionUnavailableError(purpose);
  // Called as a METHOD, so a store that closes over nothing and one that reads
  // `this` both work. Every shipped store here returns a literal; a class-based
  // one is somebody else's perfectly reasonable choice.
  return member.call(sessions);
}
