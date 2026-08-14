/**
 * hosting/sessionOwnership — the ONE owner-transition rule, so four stores
 * cannot each get it slightly wrong (9.36.1).
 *
 * Every store implementing {@link SessionLifecycle} keeps an owner index, and
 * every one of them wrote the write-once rule out longhand in its own dialect:
 * a `COALESCE` in SQL, a `has()` on a `Map`, a read-then-decide inside a
 * transaction. Four spellings of one sentence, and all four were missing the
 * same half of it — which is what a rule that lives in prose rather than in
 * code eventually costs.
 *
 * ── The rule, whole ─────────────────────────────────────────────────────────
 * An owner is a fact about the CONVERSATION, established by the first turn
 * that signs for it. Given what is stored and what a turn is carrying:
 *
 *   | stored     | incoming   | outcome                                       |
 *   |------------|------------|-----------------------------------------------|
 *   | nobody     | nobody     | still nobody — an anonymous conversation       |
 *   | nobody     | somebody   | FILLED IN — the first turn that signs, owns    |
 *   | somebody   | nobody     | KEPT — a leaner turn erases nothing            |
 *   | somebody   | the same   | KEPT — the ordinary turn                       |
 *   | somebody   | DIFFERENT  | REFUSED, by name                               |
 *
 * The last row is the one that was missing, and the difference between the
 * last two rows is the whole design decision:
 *
 *  - **A different identity is a CONTRADICTION.** Two people cannot both have
 *    signed for one conversation. Keeping the index and storing the payload
 *    anyway — which is what every store did — leaves the index naming one
 *    person and the conversation naming another, and the person the index
 *    names opens it and reads the other one's conversation.
 *  - **An absent identity is not a contradiction.** It claims nobody. The
 *    contract blesses it in as many words ("a later turn carrying a leaner
 *    identity must not erase it"), and refusing it would fail a flow the
 *    library's own documentation describes as intended, to protect against a
 *    claim nobody made.
 *
 * ── Why this is a function and not a base class ─────────────────────────────
 * Stores share no ancestry and should not start now: one is a `Map`, one is a
 * SQL upsert, one is a distributed transaction, one is somebody's managed
 * service where the owner field is immutable. What they share is a DECISION,
 * so what they share is a decision function — called at the point each of them
 * already had to decide, inside whatever atomicity that store can offer.
 *
 * The atomicity is deliberately NOT this module's business, and cannot be: a
 * read-then-decide is only as safe as the transaction it happens inside, and
 * only the store knows what it has. What this owns is the answer; where it is
 * safe to ask is the store's own promise, and the conformance suite is what
 * checks that the store kept it (`contested-write-leaves-no-split-brain`).
 */

import { SessionOwnershipConflictError } from './errors.js';

/**
 * Which owner a store should record, given what it already has and what the
 * turn being written is signed by — or a refusal.
 *
 * Call it INSIDE whatever the store uses to make read-then-write atomic (a
 * transaction, a lock, a single-threaded map), with the owner already derived
 * from the stored conversation by `envelopeOwner`. The return value is the
 * owner to store; a refusal means the whole `persist` must not land, including
 * the envelope.
 *
 * **The envelope is the part that matters.** A store that catches this and
 * writes the payload anyway has re-created the exact defect: the refusal
 * exists to stop the CONVERSATION being replaced, not merely to protect an
 * index column.
 *
 * Empty strings are read as "nobody" on both sides, matching `envelopeOwner`,
 * so a store that keeps `''` for an unowned row cannot accidentally make it a
 * principal that conflicts with everybody.
 *
 * @param sessionId  the id being written — the caller's own string, and the
 *   only thing the refusal repeats back.
 * @param storedOwner  the owner already recorded for this session, or
 *   `undefined` for a session that is new or that nobody has signed for.
 * @param incomingOwner  the owner derived from the envelope being written —
 *   `envelopeOwner(envelope)`, never anything a caller supplied.
 * @returns the owner to record. `undefined` means "record nobody".
 * @throws SessionOwnershipConflictError when the two name DIFFERENT people.
 *
 * @example  Inside a store's persist
 *   const incoming = envelopeOwner(checked);
 *   const owner = resolveSessionOwner(sessionId, rows.get(sessionId), incoming);
 *   // Only now — a refusal above must leave the stored conversation alone.
 *   rows.set(sessionId, checked);
 *   if (owner !== undefined) owners.set(sessionId, owner);
 */
export function resolveSessionOwner(
  sessionId: string,
  storedOwner: string | undefined,
  incomingOwner: string | undefined,
): string | undefined {
  const stored = nonEmpty(storedOwner);
  const incoming = nonEmpty(incomingOwner);
  // Nothing is claimed yet: the first turn that signs owns the conversation,
  // and a turn that signs for nothing leaves it unowned.
  if (stored === undefined) return incoming;
  // The blessed leaner turn. It claims nobody, so it contradicts nobody, and
  // the established owner stands.
  if (incoming === undefined) return stored;
  if (incoming === stored) return stored;
  throw new SessionOwnershipConflictError(sessionId);
}

/** `''` is nobody, exactly as `envelopeOwner` reads it. */
function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
