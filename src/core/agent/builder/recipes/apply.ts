import { assertAgentRecipe } from '../../../../recipes/defineAgentRecipe.js';
import {
  asyncConfigureRefusal,
  duplicateRecipeRefusal,
  recursiveRecipeRefusal,
  resolveRecipeConflictPolicy,
} from '../../../../recipes/apply.js';
import type { AppliedRecipe, RecipeOptions } from '../../../../recipes/types.js';

export interface RecipePort {
  readonly recipeStack: AppliedRecipe[];
  readonly appliedRecipeList: AppliedRecipe[];
}

export function applyRecipe(
  self: RecipePort,
  recipe: unknown,
  options: RecipeOptions | undefined,
  configureRecipe: () => unknown,
  original: object,
): object {
  assertAgentRecipe(recipe, 'AgentBuilder.recipe');
  // Resolved before anything is applied: a policy this library does not have
  // must not half-apply a composition before it says so.
  resolveRecipeConflictPolicy(options?.conflict, 'AgentBuilder.recipe');
  const applied: AppliedRecipe = { id: recipe.id, version: recipe.version };
  // TWO different facts, two different refusals. On the STACK means the
  // composition is its own ancestor and `configure` would recurse forever; on
  // the LIST means the chain simply names one composition twice. Telling an
  // author their recursion is a duplicate sends them to the wrong line.
  const applying = self.recipeStack.find((r) => r.id === applied.id);
  if (applying) {
    throw new Error(
      recursiveRecipeRefusal({
        stack: [...self.recipeStack],
        incoming: applied,
        callSite: 'AgentBuilder.recipe',
      }),
    );
  }
  const already = self.appliedRecipeList.find((r) => r.id === applied.id);
  if (already) {
    throw new Error(
      duplicateRecipeRefusal({
        existing: already,
        incoming: applied,
        callSite: 'AgentBuilder.recipe',
      }),
    );
  }
  self.recipeStack.push(applied);
  try {
    const returned: unknown = configureRecipe();
    // `build()` is synchronous, so nothing would ever await this. Refused by
    // name rather than left to land on an agent that is already built.
    if (typeof (returned as { then?: unknown } | undefined)?.then === 'function') {
      throw new Error(asyncConfigureRefusal(applied, 'AgentBuilder.recipe'));
    }
  } finally {
    // `finally`, not the happy path: a refusal raised inside `configure`
    // (a duplicate tool, say) must not leave the stack claiming a recipe is
    // still applying — the next registration would be attributed to it.
    self.recipeStack.pop();
  }
  // The manifest row is recorded only once `configure` has run CLEANLY. A
  // recipe whose application was refused half-way has not produced this
  // agent, and a row claiming it did would be the manifest asserting
  // something that did not happen. (Recursion is caught by the stack above,
  // so nothing depends on the row being written early.)
  self.appliedRecipeList.push(applied);
  return original;
}
