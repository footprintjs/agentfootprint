import { readCallOccurrenceKey } from '../lib/callOccurrence.js';
import { sha256Hex } from '../lib/sha256.js';
import type { ToolSkillBodyRecord } from '../lib/toolSkillBodyRecord.js';

/** The private record shape shared by the engine and the agent's history readers. */
export interface SkillBodyHistoryMessage {
  readonly role: string;
  readonly content: string;
  readonly toolName?: string;
  readonly toolSkillBody?: ToolSkillBodyRecord;
}

export function recordSkillBody(
  skillId: string,
  body: string,
  servedResult: unknown,
): ToolSkillBodyRecord {
  const start = typeof servedResult === 'string' ? servedResult.indexOf(body) : -1;
  return {
    skillId,
    digest: sha256Hex(body),
    ...(start >= 0 && { span: { start, length: body.length } }),
  };
}

/** Origin survives a result rewrite and a change to the registered definition. */
export function skillBodyOrigin(message: SkillBodyHistoryMessage): ToolSkillBodyRecord | undefined {
  if (message.role !== 'tool' || message.toolName !== 'read_skill') return undefined;
  const record = message.toolSkillBody;
  return record &&
    typeof record.skillId === 'string' &&
    typeof record.digest === 'string' &&
    typeof readCallOccurrenceKey(message) === 'string'
    ? record
    : undefined;
}

/** A window or policy may keep the origin record while taking the body away. */
export function verifiedSkillBody(
  message: SkillBodyHistoryMessage,
  record: ToolSkillBodyRecord,
): string | undefined {
  const span = record.span;
  if (
    !span ||
    !Number.isSafeInteger(span.start) ||
    !Number.isSafeInteger(span.length) ||
    span.start < 0 ||
    span.length <= 0 ||
    span.start + span.length > message.content.length
  )
    return undefined;
  const body = message.content.slice(span.start, span.start + span.length);
  return sha256Hex(body) === record.digest ? body : undefined;
}

/** Both the engine's surface rule and the window use this definition match. */
export function carriesSkillDefinition(
  message: SkillBodyHistoryMessage,
  record: ToolSkillBodyRecord,
  digest: string,
): boolean {
  return record.digest === digest && verifiedSkillBody(message, record) !== undefined;
}

// LENS · tool-result · persistent-history
// reads: only the id it was handed; exported so the gate can tell this sentence from a skill body
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * What `read_skill` answers when it activated a skill but did NOT carry its body
 * (surface modes `'system-prompt'` / `'auto'` — the body lands via the system
 * slot next iteration).
 *
 * Exported because the skill-graph gate has to tell this sentence apart from a
 * body: a SELF-CALL keeps the body (the model asked to re-read where it is, and
 * under `'tool-only'` the tool result is the only place that body ever appears)
 * but must not keep a promise of an activation that is not pending. Comparing
 * against the one owner of the string beats guessing at its shape.
 */
export function skillActivationConfirmation(id: string): string {
  return `Skill '${id}' activated for the next iteration.`;
}
