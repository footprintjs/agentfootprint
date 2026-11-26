/**
 * Which `read_skill` results in a history ARE a registered skill's body: the
 * app's own text, under the library tool's name, equal to the body the app
 * registered. One reading for the readers that must agree on it: the window's
 * pin (`stages/window.ts`) and the honesty readers' view
 * (`honestyView.ts`).
 */
import type { LLMMessage } from '../../../provider-contract/types.js';

/** A `read_skill` result whose text is the body of one of `bodies`, and that skill's id. */
export function skillBodyOf(
  message: Pick<LLMMessage, 'role' | 'content' | 'toolName'>,
  bodies: ReadonlyMap<string, string>,
): string | undefined {
  if (message.role !== 'tool' || message.toolName !== 'read_skill') return undefined;
  for (const [id, body] of bodies) if (body.length > 0 && message.content === body) return id;
  return undefined;
}

/** The call ids of the body results of the skills in `active` (a still-active skill's only copy). */
export function activeSkillBodyCallIds(
  history: readonly LLMMessage[],
  bodies: ReadonlyMap<string, string>,
  active: readonly string[],
): ReadonlySet<string> {
  const live = new Set(active);
  const ids = new Set<string>();
  for (const message of history) {
    const id = skillBodyOf(message, bodies);
    if (id !== undefined && live.has(id) && message.toolCallId !== undefined)
      ids.add(message.toolCallId);
  }
  return ids;
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
