import type { LLMMessage } from '../../../provider-contract/types.js';
import { sha256Hex } from '../../../lib/sha256.js';
import {
  skillBodyOrigin,
  legacySkillBody,
  matchesLegacySkillBody,
  carriesSkillDefinition,
} from '../../../injection-engine/skillBodyEvidence.js';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';

/** A still-present, library-produced body of a currently registered definition. */
export function skillBodyOf(
  message: LLMMessage,
  bodies: ReadonlyMap<string, string>,
): string | undefined {
  const origin = skillBodyOrigin(message);
  if (origin === undefined) return undefined;
  const current = bodies.get(origin.skillId);
  return current !== undefined && carriesSkillDefinition(message, origin, sha256Hex(current))
    ? origin.skillId
    : undefined;
}

/**
 * The recorded occurrence of the NEWEST body result of each skill in `active`: one pin per
 * skill (the `last-tool-result` rule). Older copies of the same body are
 * ordinary history a window may drop; the newest one keeps the body in front
 * of the model.
 */
export function activeSkillBodyOccurrences(
  history: readonly LLMMessage[],
  bodies: ReadonlyMap<string, string>,
  active: readonly string[],
): ReadonlySet<string> {
  const live = new Set(active);
  const newest = new Map<string, string>();
  for (const message of history) {
    const occurrence = readCallOccurrenceKey(message);
    if (typeof occurrence !== 'string') continue;
    if (legacySkillBody(message) !== undefined) {
      for (const id of live) {
        if (matchesLegacySkillBody(message, bodies.get(id))) newest.set(id, occurrence);
      }
      continue;
    }
    const id = skillBodyOf(message, bodies);
    if (id !== undefined && live.has(id)) newest.set(id, occurrence);
  }
  return new Set(newest.values());
}

/** Every skill's registered body, by id: what a `read_skill` result is compared with. */
export function skillBodiesOf(
  injections: readonly {
    readonly id: string;
    readonly flavor: string;
    readonly inject: { readonly systemPrompt?: string };
  }[],
): ReadonlyMap<string, string> {
  const bodies = new Map<string, string>();
  for (const injection of injections) {
    const body = injection.inject.systemPrompt;
    if (injection.flavor === 'skill' && body !== undefined && body.length > 0)
      bodies.set(injection.id, body);
  }
  return bodies;
}
