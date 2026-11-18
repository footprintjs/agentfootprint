import type { Injection } from '../../../../injection-engine/types.js';
import { messagesToolRoleRefusal } from '../../../../injection-engine/messagesSlotRefusal.js';
import type { RecipeSource } from '../../../../recipes/provenance.js';
import { assertReadSkillActivation } from '../skills/activation.js';

export interface InjectionPort {
  readonly injectionList: Injection[];
  readonly injectionSources: Map<string, RecipeSource>;
  duplicateRefusal(
    what: 'tool name' | 'injection id',
    name: string,
    sources: ReadonlyMap<string, RecipeSource>,
    callSite: string,
  ): string;
  currentSource(): RecipeSource;
}

export function registerInjection<TReceiver extends InjectionPort>(
  self: TReceiver,
  injection: Injection,
  original: object,
): object {
  if (self.injectionList.some((i) => i.id === injection.id)) {
    throw new Error(
      self.duplicateRefusal(
        'injection id',
        injection.id,
        self.injectionSources,
        'Agent.injection()',
      ),
    );
  }
  for (const msg of injection.inject?.messages ?? []) {
    if (msg.role === 'tool') {
      throw new Error(messagesToolRoleRefusal(`Agent.injection('${injection.id}')`));
    }
  }
  assertReadSkillActivation(injection);
  self.injectionList.push(injection);
  self.injectionSources.set(injection.id, self.currentSource());
  return original;
}
