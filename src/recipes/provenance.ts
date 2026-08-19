/**
 * provenance — who registered this name.
 *
 * Pattern: a small value type + one formatter. Pure, no dependencies beyond
 *          the recipe types.
 * Role:    recipes/ layer. `AgentBuilder` records a {@link RecipeSource} beside
 *          every tool name and injection id it takes, and reads it back when
 *          two registrations collide.
 * Emits:   N/A.
 *
 * ## Why provenance at all
 *
 * The builder has always refused a duplicate tool name — the model dispatches
 * by name, so two tools called `search` is a coin flip. What it could not say
 * was WHERE each one came from. With one recipe in the chain that answer stops
 * being obvious ("I never registered a `search` tool") and with two it is
 * unrecoverable without reading both recipes' source. A refusal that names both
 * sides turns a hunt into a sentence.
 *
 * ## Three arms, because three things are true and one of them is "I do not know"
 *
 * `local` and `unattributed` are NOT the same fact, and collapsing them would
 * make the refusal lie. `local` means: this builder watched you call
 * `.tool()` / `.injection()` yourself. `unattributed` means: the name was
 * already taken when the ledger was consulted and no source was recorded for
 * it — the honest answer is that this builder does not know, and saying
 * "you registered it" would send the reader to look in the one place it is not.
 *
 * The arm exists because there is more than one way into the injection list:
 * `.injection()` is the funnel for the named flavors, and `.outputSchema()`
 * mounts an instruction of its own. Both record a source today. A third site
 * added later would not, and this arm is what keeps that omission honest
 * instead of blaming the caller.
 */

import type { AppliedRecipe } from './types.js';

/**
 * Where a registered tool name or injection id came from.
 *
 * `stack` is the recipe application chain, OUTERMOST first: a recipe may apply
 * another recipe, and the innermost one is the code that literally called the
 * builder method.
 */
export type RecipeSource =
  | { readonly kind: 'local' }
  | { readonly kind: 'recipe'; readonly stack: readonly AppliedRecipe[] };

/** The one `local` value. A frozen singleton — it carries no data. */
export const LOCAL_SOURCE: RecipeSource = Object.freeze({ kind: 'local' as const });

/**
 * Describe a source in a sentence fragment that reads inside a refusal.
 *
 * `undefined` is the unattributed case — see the header. It is a separate
 * answer, never folded into `local`.
 */
export function describeRecipeSource(source: RecipeSource | undefined): string {
  if (source === undefined) {
    return (
      'an earlier registration with no recorded source (a builder method mounted it; ' +
      'this builder did not attribute it)'
    );
  }
  if (source.kind === 'local') return 'this agent, directly';
  const chain = [...source.stack].reverse().map((r) => `recipe '${r.id}' ${r.version}`);
  return chain.join(' ← applied by ');
}
