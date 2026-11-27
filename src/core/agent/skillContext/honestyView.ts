/**
 * The history every honesty reader of the evidence gate reads under the
 * `listed` skill context: a `read_skill` result that IS a registered body
 * (verified or a byte-exact legacy match) reads as the confirmation `read_skill` answers
 * under `declared`, and the body follows it as a `role: 'system'` line, so it
 * is exempt app text exactly as the system-prompt body is under `declared`,
 * and never a value a tool returned. Read-only: the history the model is sent
 * is not touched. Without `bodies` (every `declared` agent) the history comes
 * back as it was given, by reference.
 */
import type { LLMMessage } from '../../../provider-contract/types.js';
import {
  legacySkillBody,
  matchesLegacySkillBody,
  skillActivationConfirmation,
  skillBodyOrigin,
  verifiedSkillBody,
} from '../../../injection-engine/skillBodyEvidence.js';

/**
 * @example
 *   honestyHistory(history, gate.skillBodies); // the body result reads as "Skill 'x' activated …"
 */
export function honestyHistory(
  history: readonly LLMMessage[],
  bodies: ReadonlyMap<string, string> | undefined,
): readonly LLMMessage[] {
  if (bodies === undefined || bodies.size === 0) return history;
  let changed = false;
  const view = history.flatMap((message): LLMMessage[] => {
    const origin = skillBodyOrigin(message);
    if (origin === undefined) {
      if (message.role !== 'tool' || message.toolName !== 'read_skill') return [message];
      changed = true;
      const body = legacySkillBody(message);
      const matches =
        body === undefined
          ? []
          : [...bodies].filter(([, text]) => matchesLegacySkillBody(message, text));
      // Equal app text is exempt. A legacy result never supplies tool evidence,
      // and shared bodies cannot identify which skill answered the call.
      const match = matches[0];
      if (match === undefined) return [{ ...message, content: '' }];
      const [skillId, matchedBody] = match;
      const content = matches.length === 1 ? skillActivationConfirmation(skillId) : '';
      return [
        { ...message, content },
        { role: 'system', content: matchedBody },
      ];
    }
    const body = verifiedSkillBody(message, origin);
    changed = true;
    return [
      { ...message, content: skillActivationConfirmation(origin.skillId) },
      ...(body === undefined ? [] : [{ role: 'system' as const, content: body }]),
    ];
  });
  return changed ? view : history;
}
