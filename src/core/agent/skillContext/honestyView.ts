/**
 * The history every honesty reader of the evidence gate reads under the
 * `listed` skill context: a `read_skill` result that IS a registered body
 * (`bodies.ts` · `skillBodyOf`) reads as the confirmation `read_skill` answers
 * under `declared`, and the body follows it as a `role: 'system'` line, so it
 * is exempt app text exactly as the system-prompt body is under `declared`,
 * and never a value a tool returned. Read-only: the history the model is sent
 * is not touched. Without `bodies` (every `declared` agent) the history comes
 * back as it was given, by reference.
 */
import { skillActivationConfirmation } from '../../../injection-engine/skillToolDescriptors.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import { skillBodyOf } from './bodies.js';

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
    const id = skillBodyOf(message, bodies);
    if (id === undefined) return [message];
    changed = true;
    return [
      { ...message, content: skillActivationConfirmation(id) },
      { role: 'system', content: message.content },
    ];
  });
  return changed ? view : history;
}
