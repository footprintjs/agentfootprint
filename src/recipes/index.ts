/**
 * recipes — the declared unit of agent configuration.
 *
 * The door: what `agentfootprint/recipes` publishes. Read `types.ts` for the
 * argument (including the no-lifecycle limit) and README.md for the worked
 * example.
 *
 * ## What is NOT here, and why
 *
 * The validators (`isPlainRecipeId`, `isSemverVersion`), the provenance
 * formatter and every refusal sentence are internal. `AgentBuilder` imports
 * them by module path, and this door stays the AUTHORING vocabulary: declare a
 * recipe, catch the refusal, name the types. Publishing the plumbing would be
 * surface nobody imports and everybody has to keep documented — and a recipe's
 * whole claim is that it is a composition over primitives, not a second
 * framework with an API of its own.
 */

export { defineAgentRecipe, InvalidAgentRecipeError } from './defineAgentRecipe.js';
export type { AgentRecipe, AppliedRecipe, RecipeConflictPolicy, RecipeOptions } from './types.js';
