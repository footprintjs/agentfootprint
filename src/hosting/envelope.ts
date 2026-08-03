/**
 * hosting/envelope — pack a conversation for storage, and refuse to unpack one
 * you cannot read.
 *
 * Two functions and one rule: **an unknown format is refused by name, never
 * guessed at.** A store outlives the code that wrote to it. Somebody will
 * deploy a newer runtime, it will write a newer format, and an older instance
 * still running will read it. The only honest thing that older instance can do
 * is say which format it found, which ones it knows, and stop — because
 * "restore what I can and hope" means an agent answering from a conversation
 * that is missing whatever the older reader did not understand.
 */

import { validateCheckpoint, type AgentRunCheckpoint } from '../core/runCheckpoint.js';
import type { CheckpointEnvelope } from './types.js';

/** Every format this runtime can read. Add, never redefine. */
const KNOWN_FORMATS: readonly string[] = ['conversation-v1'];

/**
 * Pack a conversation checkpoint for storage.
 *
 * @example
 *   const conversation = agent.checkpoint();
 *   if (conversation) await sessions.persist(sessionId, toEnvelope(conversation));
 */
export function toEnvelope(checkpoint: AgentRunCheckpoint): CheckpointEnvelope {
  return { format: 'conversation-v1', data: checkpoint, savedAt: Date.now() };
}

/**
 * Unpack a stored envelope back into a conversation checkpoint.
 *
 * Takes `unknown` on purpose: what comes back from a store is bytes somebody
 * else wrote, in a format this runtime may not know, and typing the parameter
 * as the happy shape would be assuming the very thing that needs checking.
 *
 * @throws TypeError naming the format when it is one this runtime cannot read,
 *   and naming the missing field when the conversation inside is malformed.
 */
export function readEnvelope(envelope: unknown): AgentRunCheckpoint {
  if (!envelope || typeof envelope !== 'object') {
    throw new TypeError(
      `[hosting] stored session is not an envelope (got ${
        envelope === null ? 'null' : typeof envelope
      }). ` + `Expected { format, data, savedAt } as written by toEnvelope().`,
    );
  }
  const found = (envelope as Partial<CheckpointEnvelope>).format;
  if (typeof found !== 'string' || !KNOWN_FORMATS.includes(found)) {
    throw new TypeError(
      `[hosting] unknown checkpoint format '${String(found)}'. ` +
        `This runtime reads: ${KNOWN_FORMATS.join(', ')}. ` +
        `Refusing rather than restoring a conversation it cannot read — a newer envelope ` +
        `needs a runtime that knows the format that wrote it.`,
    );
  }
  return validateCheckpoint((envelope as CheckpointEnvelope).data);
}
