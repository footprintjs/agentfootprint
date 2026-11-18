import { LOCAL_SOURCE, type RecipeSource } from '../../../../recipes/provenance.js';
import type { AppliedRecipe } from '../../../../recipes/types.js';
import { duplicateRegistrationRefusal } from '../../../../recipes/apply.js';

export interface RecipeSourcePort {
  readonly recipeStack: AppliedRecipe[];
}

export interface DuplicateRegistrationPort {
  currentSource(): RecipeSource;
}

export function currentRecipeSource(self: RecipeSourcePort): RecipeSource {
  return self.recipeStack.length === 0
    ? LOCAL_SOURCE
    : { kind: 'recipe', stack: [...self.recipeStack] };
}

export function duplicateRegistration(
  self: DuplicateRegistrationPort,
  what: 'tool name' | 'injection id',
  name: string,
  sources: ReadonlyMap<string, RecipeSource>,
  callSite: string,
): string {
  const existing = sources.get(name);
  const incoming = self.currentSource();
  if (existing?.kind === 'local' && incoming.kind === 'local') {
    return what === 'tool name'
      ? `Agent.tool(): duplicate tool name '${name}'`
      : `Agent.injection(): duplicate id '${name}'`;
  }
  return duplicateRegistrationRefusal({ what, name, existing, incoming, callSite });
}
