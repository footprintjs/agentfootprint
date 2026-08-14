/**
 * hosting/envelope — pack a session for storage, and refuse to unpack one you
 * cannot read.
 *
 * One rule, and everything here is a consequence of it: **an envelope this
 * runtime cannot read is refused BY NAME, never guessed at.** A store outlives
 * the code that wrote to it. Somebody will deploy a newer runtime, it will write
 * a newer format, and an older instance still running will read it. The only
 * honest thing that older instance can do is say which format it found, which
 * ones it knows, and stop — because "restore what I can and hope" means an agent
 * answering from a session that is missing whatever the older reader did not
 * understand.
 *
 * ── Two formats, two readers, and why they refuse each other ─────────────────
 * `readEnvelope` unpacks a CONVERSATION; `readPausedRun` unpacks a PAUSED RUN.
 * Each refuses the other's format by name and points at its sibling. That looks
 * fussy until you notice the alternative: one reader that quietly returned the
 * conversation inside a paused run would hand back a session that LOOKS finished
 * while a person is still waiting on a question nobody mentioned. That is a
 * half-restore wearing a happy path, which is the exact failure the format field
 * exists to prevent.
 *
 * ── The same rule one step earlier: unreadable ≠ absent ──────────────────────
 * A format nobody knows is one way a store can hand back something unusable.
 * The other is bytes that are not an envelope at all — a store that kept its own
 * encoding and gave back its host language's `toString()` of the object rather
 * than the object, say. **An unreadable stored conversation and an absent one
 * are different facts, and only one of them is safe to answer with a fresh
 * start.** Absent is ordinary. Unreadable means a conversation EXISTS and this
 * runtime cannot see it, and answering that with a fresh start is invisible from
 * the outside — it looks exactly like a new user — until a deployment boundary
 * hands somebody a blank slate where their conversation was.
 *
 * So {@link readFormat} — the ONE place a stored value is inspected, and
 * therefore the place every reader and every store adapter inherits from —
 * raises {@link UnreadableEnvelopeError} by name, with the session and a short
 * prefix of what it found. Decoding is an adapter's business (only the adapter
 * knows its transport's encoding); "these bytes are nobody's readable session"
 * is everybody's, so it is refused here, once.
 */

import { UnreadableEnvelopeError } from './errors.js';
import { validateCheckpoint, type AgentRunCheckpoint } from '../core/runCheckpoint.js';
import type {
  CheckpointEnvelope,
  ConversationEnvelope,
  PausedRun,
  PausedRunEnvelope,
} from './types.js';
import type { TranscriptMessage } from './sessionWire.js';

/** Every format this runtime can read. Add, never redefine. */
const KNOWN_FORMATS: readonly string[] = ['conversation-v1', 'flowchart-v1'];

/**
 * Pack a conversation checkpoint for storage.
 *
 * @example
 *   const conversation = agent.checkpoint();
 *   if (conversation) await sessions.persist(sessionId, toEnvelope(conversation));
 */
export function toEnvelope(checkpoint: AgentRunCheckpoint): ConversationEnvelope {
  return { format: 'conversation-v1', data: checkpoint, savedAt: Date.now() };
}

/**
 * Pack a paused run for storage — the engine checkpoint, the conversation as of
 * the pause, and the question it is waiting on.
 *
 * Store it anywhere that speaks JSON. Note what JSON does and does not preserve
 * here: `agent.resume()` reads `checkpoint.sharedState`, which round-trips
 * unchanged; the engine's diagnostic halves lose their explicitly-`undefined`
 * properties, because that is what `JSON.stringify` does to them. See
 * {@link PausedRun}.
 *
 * @example
 *   const outcome = await agent.run({ message });
 *   if (isPaused(outcome)) {
 *     await sessions.persist(sessionId, toPausedEnvelope({
 *       checkpoint: outcome.checkpoint,
 *       conversation: agent.checkpoint()!,
 *       pending: { pauseData: outcome.pauseData },
 *     }));
 *   }
 */
export function toPausedEnvelope(paused: PausedRun): PausedRunEnvelope {
  return { format: 'flowchart-v1', data: paused, savedAt: Date.now() };
}

/**
 * Unpack a stored envelope back into a conversation checkpoint.
 *
 * Takes `unknown` on purpose: what comes back from a store is bytes somebody
 * else wrote, in a format this runtime may not know, and typing the parameter
 * as the happy shape would be assuming the very thing that needs checking.
 *
 * @throws UnreadableEnvelopeError when what came back is present but is not an
 *   envelope at all — bytes a store kept in its own encoding, say. Never
 *   `undefined`: a conversation that exists and cannot be read is not the same
 *   fact as one that was never there.
 * @throws TypeError naming the format when it is one this runtime cannot read;
 *   naming the missing field when the conversation inside is malformed; and
 *   pointing at {@link readPausedRun} when the envelope holds a paused run,
 *   which is a session with a question outstanding rather than a conversation.
 */
export function readEnvelope(envelope: unknown): AgentRunCheckpoint {
  if (readFormat(envelope) === 'flowchart-v1') {
    throw new TypeError(
      `[hosting] this envelope holds a PAUSED RUN ('flowchart-v1'), not a conversation. ` +
        `Read it with readPausedRun(envelope) — it is waiting on a person's decision, and ` +
        `handing back only the conversation inside it would restore a session that looks ` +
        `finished while somebody is still waiting to be asked.`,
    );
  }
  return validateCheckpoint((envelope as ConversationEnvelope).data);
}

/**
 * Unpack a stored envelope back into a paused run.
 *
 * @throws TypeError naming the format when it is one this runtime cannot read;
 *   pointing at {@link readEnvelope} when the envelope holds a plain
 *   conversation; and naming the missing field when the paused run inside is
 *   malformed.
 */
export function readPausedRun(envelope: unknown): PausedRun {
  if (readFormat(envelope) === 'conversation-v1') {
    throw new TypeError(
      `[hosting] this envelope holds a conversation ('conversation-v1'), not a paused run. ` +
        `Read it with readEnvelope(envelope). Nothing is waiting on a decision here.`,
    );
  }
  return validatePausedRun((envelope as PausedRunEnvelope).data);
}

/**
 * Check that an envelope is one this runtime can read, and hand it back
 * unchanged — without committing to which half you wanted.
 *
 * This is what a STORE wants. A store's job is to notice that the bytes it is
 * about to hand over are unreadable, so the refusal names the store that
 * produced them rather than whoever read them next; it has no business caring
 * whether the session inside is mid-conversation or mid-question.
 *
 * Pass `sessionId` and the refusal names the conversation, which is what turns
 * a log line into an incident somebody can act on. Pass it whenever you have it
 * — a store always does.
 *
 * @throws UnreadableEnvelopeError when the stored value is present but is not an
 *   envelope at all. That is the case a store must NOT answer with `undefined`:
 *   see the module header.
 * @throws TypeError naming the format when this runtime cannot read it, or the
 *   missing field when the payload is malformed.
 *
 * @example
 *   async hydrate(sessionId) {
 *     const stored = await myStore.get(sessionId);
 *     return stored === undefined ? undefined : checkEnvelope(stored, sessionId);
 *   }
 */
export function checkEnvelope(envelope: unknown, sessionId?: string): CheckpointEnvelope {
  if (readFormat(envelope, sessionId) === 'flowchart-v1') {
    validatePausedRun((envelope as PausedRunEnvelope).data);
  } else {
    validateCheckpoint((envelope as ConversationEnvelope).data);
  }
  return envelope as CheckpointEnvelope;
}

/**
 * WHO a stored session belongs to — the `principal` on the conversation the
 * envelope carries, or `undefined` when it names nobody (9.26.0).
 *
 * The ONE derivation, so a store's owner index and the composer's ownership
 * check can never disagree about what "belongs to" means. It is read from the
 * conversation's own identity — the tuple `standingAgent` composed from the
 * request's verified user — and NOT from anything a caller supplied at persist
 * time: a store that indexed on a claimed owner would be a store where owning
 * a session is a matter of asking.
 *
 * A conversation that ran anonymously, or under a derived session-namespace
 * rung with no principal, has no owner. That is a FACT, not a gap to fill: a
 * session nobody signed for is a session nobody can list, and inventing an
 * owner would be inventing an entitlement.
 *
 * **Status: the CONTRACT is field-validated — an independent field trial,
 * 2026-08-13.** A live multi-user run against a real Firestore: an owner
 * written once and never moved, a cross-user transcript answering the same
 * not-found a missing session gets, one caller's own two sessions listed over
 * two pages, `listByUser` / `ownerOf` feature detection, and `mayOpenSession`
 * refusing an ordinary turn on somebody else's conversation. The store
 * underneath was **the trial's own Firestore `SessionLifecycle`**, not one this
 * package ships — so the rung belongs to this derivation and the rules above
 * it, and no shipped Google adapter may borrow the credit.
 *
 * Reads both formats, so a session that is mid-question is owned exactly as
 * firmly as one that is finished. Returns `undefined` rather than throwing on
 * a shape it cannot read — an index is a convenience, and refusing to WRITE a
 * conversation because its owner could not be derived would be the tail
 * wagging the dog. (Every reader of the index still checks ownership itself.)
 */
export function envelopeOwner(envelope: unknown): string | undefined {
  const conversation = conversationOf(envelope);
  const principal = conversation?.identity?.principal;
  return typeof principal === 'string' && principal.length > 0 ? principal : undefined;
}

/**
 * The stored conversation's messages, projected to what a person may read back
 * (9.26.0): user and assistant TEXT, in stored order.
 *
 * Everything else is deliberately dropped — see {@link TranscriptMessage} for
 * the full list and the reason. Non-string content (a provider's structured
 * block) is dropped rather than stringified: a transcript is what was said, and
 * `[object Object]` is not something anybody said.
 */
export function envelopeTranscript(envelope: unknown): readonly TranscriptMessage[] {
  const history = conversationOf(envelope)?.history;
  if (!Array.isArray(history)) return [];
  const messages: TranscriptMessage[] = [];
  for (const message of history) {
    const role = (message as { role?: unknown }).role;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = (message as { content?: unknown }).content;
    if (typeof content !== 'string' || content.length === 0) continue;
    messages.push({ role, content });
  }
  return messages;
}

/**
 * The conversation inside either envelope format, WITHOUT the strict validation
 * the two readers apply.
 *
 * Lenient on purpose, and only for the two projections above: an index entry
 * and a read-back transcript are both best-effort views of something that is
 * already stored, and raising here would turn "I could not summarize your old
 * session" into "your request failed". The authoritative readers
 * ({@link readEnvelope} / {@link readPausedRun}) keep their refusals for the
 * path that actually RESTORES a session, which is the one where a half-read
 * conversation does damage.
 */
function conversationOf(
  envelope: unknown,
): { identity?: { principal?: unknown }; history?: unknown } | undefined {
  if (!envelope || typeof envelope !== 'object') return undefined;
  const { format, data } = envelope as { format?: unknown; data?: unknown };
  if (!data || typeof data !== 'object') return undefined;
  if (format === 'flowchart-v1') {
    const conversation = (data as { conversation?: unknown }).conversation;
    return conversation && typeof conversation === 'object'
      ? (conversation as { identity?: { principal?: unknown }; history?: unknown })
      : undefined;
  }
  if (format === 'conversation-v1') {
    return data as { identity?: { principal?: unknown }; history?: unknown };
  }
  return undefined;
}

/**
 * The one place a stored value is inspected, so every refusal in this file says
 * the same thing in the same words — and so the "unreadable is not absent" law
 * holds for every reader here and every store adapter that calls one, including
 * ones nobody has written yet.
 */
function readFormat(envelope: unknown, sessionId?: string): 'conversation-v1' | 'flowchart-v1' {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    // Present but not an envelope. NOT `undefined`, NOT a fresh start: see the
    // module header. Still a `TypeError` by ancestry, so an existing catch is
    // unaffected — it just has a name and a session now.
    throw new UnreadableEnvelopeError(envelope, sessionId);
  }
  const found = (envelope as Partial<CheckpointEnvelope>).format;
  if (typeof found !== 'string' || !KNOWN_FORMATS.includes(found)) {
    throw new TypeError(
      `[hosting] unknown checkpoint format '${String(found)}'. ` +
        `This runtime reads: ${KNOWN_FORMATS.join(', ')}. ` +
        `Refusing rather than restoring a session it cannot read — a newer envelope ` +
        `needs a runtime that knows the format that wrote it.`,
    );
  }
  return found as 'conversation-v1' | 'flowchart-v1';
}

/**
 * Validate a paused run at deserialization time, naming the missing piece.
 *
 * Only the fields resume actually consumes are required. `executionTree` and
 * `subflowResults` are the engine's diagnostic halves — a checkpoint that lost
 * them in transit still resumes, so demanding them would refuse a session that
 * would have worked.
 */
function validatePausedRun(value: unknown): PausedRun {
  if (!value || typeof value !== 'object') {
    throw new TypeError('[hosting] paused run is not an object.');
  }
  const run = value as Partial<PausedRun>;
  const cp = run.checkpoint as Record<string, unknown> | undefined;
  if (!cp || typeof cp !== 'object') {
    throw new TypeError(
      `[hosting] paused run is missing required field: checkpoint. ` +
        `It is the engine checkpoint agent.resume() continues from; without it the run ` +
        `cannot be continued at all.`,
    );
  }
  if (
    typeof cp.pausedStageId !== 'string' ||
    !cp.sharedState ||
    typeof cp.sharedState !== 'object'
  ) {
    throw new TypeError(
      `[hosting] paused run's checkpoint is missing required fields (pausedStageId, ` +
        `sharedState) — the two agent.resume() rebuilds the cursor and the run's state from.`,
    );
  }
  if (!Array.isArray(cp.subflowPath)) {
    throw new TypeError(
      `[hosting] paused run's checkpoint is missing required field: subflowPath.`,
    );
  }
  if (!run.pending || typeof run.pending !== 'object') {
    throw new TypeError(
      `[hosting] paused run is missing required field: pending — the question it is ` +
        `waiting on. A stored pause nobody can describe is a session that hangs.`,
    );
  }
  validateCheckpoint(run.conversation);
  return run as PausedRun;
}
