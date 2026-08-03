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
 */

import { validateCheckpoint, type AgentRunCheckpoint } from '../core/runCheckpoint.js';
import type {
  CheckpointEnvelope,
  ConversationEnvelope,
  PausedRun,
  PausedRunEnvelope,
} from './types.js';

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
 * @throws TypeError naming the format when this runtime cannot read it, or the
 *   missing field when the payload is malformed.
 *
 * @example
 *   async hydrate(sessionId) {
 *     const stored = await myStore.get(sessionId);
 *     return stored === undefined ? undefined : checkEnvelope(stored);
 *   }
 */
export function checkEnvelope(envelope: unknown): CheckpointEnvelope {
  if (readFormat(envelope) === 'flowchart-v1') {
    validatePausedRun((envelope as PausedRunEnvelope).data);
  } else {
    validateCheckpoint((envelope as ConversationEnvelope).data);
  }
  return envelope as CheckpointEnvelope;
}

/**
 * The one place a `format` is checked, so every refusal in this file says the
 * same thing in the same words.
 */
function readFormat(envelope: unknown): 'conversation-v1' | 'flowchart-v1' {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TypeError(
      `[hosting] stored session is not an envelope (got ${
        envelope === null ? 'null' : Array.isArray(envelope) ? 'an array' : typeof envelope
      }). Expected { format, data, savedAt } as written by toEnvelope() / toPausedEnvelope().`,
    );
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
