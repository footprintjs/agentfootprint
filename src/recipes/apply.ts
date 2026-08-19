/**
 * apply — the pure half of applying a recipe.
 *
 * Pattern: policy resolution + the sentences the applier raises. Pure, so
 *          every refusal can be read and tested without building an agent.
 * Role:    recipes/ layer. `AgentBuilder.recipe()` is the only caller; it owns
 *          the mutation, this file owns the words.
 * Emits:   N/A.
 */

import { describeRecipeSource, type RecipeSource } from './provenance.js';
import type { AppliedRecipe, RecipeConflictPolicy } from './types.js';

/** The policies that exist. One, today — see {@link RecipeConflictPolicy}. */
const CONFLICT_POLICIES: readonly RecipeConflictPolicy[] = ['error'];

/**
 * Resolve the conflict policy, or refuse the requested one BY NAME.
 *
 * The three a reader reaches for are named in the refusal because each is a
 * real design and none is implemented: every one of them has to answer where
 * the dropped registration is RECORDED, and until it does, running it as
 * `'error'`'s quiet cousin would be the accepted-and-silently-wrong shape this
 * library refuses. So the unimplemented policy is refused rather than
 * approximated by the one that ships.
 */
export function resolveRecipeConflictPolicy(
  value: unknown,
  callSite: string,
): RecipeConflictPolicy {
  if (value === undefined) return 'error';
  if ((CONFLICT_POLICIES as readonly unknown[]).includes(value)) {
    return value as RecipeConflictPolicy;
  }
  throw new Error(
    `${callSite}: conflict policy ${
      typeof value === 'string' ? `'${value}'` : String(value)
    } is not implemented. The only policy this library has is 'error' (the default): a tool ` +
      `name or injection id a recipe introduces that is already taken refuses at build, naming ` +
      `both sources.\n\n` +
      `'skip', 'replace' and automatic renaming are each a real design, and each one has to ` +
      `answer the same question first — where the dropped or overridden registration is ` +
      `RECORDED. A composition that silently loses a tool answers a turn without it and says ` +
      `nothing, which is the failure this option exists to prevent, so an unimplemented policy ` +
      `is refused here rather than quietly run as 'error'.\n\n` +
      `To compose recipes that overlap today: rename one of the colliding registrations, or ` +
      `have the recipe export the piece so the app registers it once itself.`,
  );
}

/**
 * The refusal for a name two sources both registered.
 *
 * Raised only when at least one side came from a recipe. A collision between
 * two direct builder calls keeps the sentence it has always had — the message
 * an app already reads in its tests should not change because a feature it does
 * not use shipped.
 *
 * `what` is the word the reader uses (`'tool name'` / `'injection id'`);
 * `existing` is who registered it first and `incoming` who is registering it
 * now, either of which may be `undefined` for the unattributed case;
 * `callSite` is the API being called, e.g. `Agent.tool()`.
 */
export function duplicateRegistrationRefusal(params: {
  readonly what: 'tool name' | 'injection id';
  readonly name: string;
  readonly existing: RecipeSource | undefined;
  readonly incoming: RecipeSource | undefined;
  readonly callSite: string;
}): string {
  const { what, name, existing, incoming, callSite } = params;
  const consequence =
    what === 'tool name'
      ? `The model dispatches tools BY NAME, so two tools under one name is a coin flip whose ` +
        `loser is never called and never mentioned.`
      : `An injection id is how the engine addresses one piece of context — activation, ` +
        `caching, the trace and every recorder key on it — so two under one name is one of ` +
        `them silently never reaching the model.`;
  return (
    `${callSite}: duplicate ${what} '${name}' — already registered by ` +
    `${describeRecipeSource(existing)}, and now by ${describeRecipeSource(incoming)}.\n\n` +
    `${consequence}\n\n` +
    `Pick one: rename one of them, or have the recipe export the piece so the app registers it ` +
    `once itself. There is no conflict policy that picks a winner for you — see ` +
    `.recipe(recipe, { conflict }).`
  );
}

/** The refusal for one composition applied twice to one agent. */
export function duplicateRecipeRefusal(params: {
  readonly existing: AppliedRecipe;
  readonly incoming: AppliedRecipe;
  readonly callSite: string;
}): string {
  const { existing, incoming, callSite } = params;
  const sameVersion = existing.version === incoming.version;
  return (
    `${callSite}: recipe '${incoming.id}' is already applied to this agent ` +
    `${
      sameVersion
        ? `(both at ${existing.version})`
        : `at ${existing.version}, and this one is ${incoming.version}`
    }.\n\n` +
    `${
      sameVersion
        ? `Applying it twice would run its builder calls twice — which for anything that ` +
          `refuses a duplicate (a tool, an injection) fails on the second pass, and for ` +
          `anything that does not would silently double it.`
        : `One agent runs ONE version of a composition. Two would each apply their builder ` +
          `calls over the other, and the manifest would carry two rows for a composition that ` +
          `cannot be two things at once — nothing downstream could say which one shaped the ` +
          `answer.`
    }\n\n` +
    `Apply it once${sameVersion ? '' : `, at the version you mean`}.`
  );
}

/**
 * The refusal for a recipe that applies ITSELF, directly or through another.
 *
 * A SEPARATE sentence from {@link duplicateRecipeRefusal}, because these are two
 * different facts and the fix is different for each: "already applied" means the
 * chain names one composition twice, and "currently applying" means the
 * composition is its own ancestor and would never terminate. Telling the author
 * their recursion is a duplicate would send them to look at the wrong line.
 *
 * `stack` is the application chain, outermost first, so the message can show the
 * cycle rather than assert one.
 */
export function recursiveRecipeRefusal(params: {
  readonly stack: readonly AppliedRecipe[];
  readonly incoming: AppliedRecipe;
  readonly callSite: string;
}): string {
  const { stack, incoming, callSite } = params;
  const cycle = [...stack, incoming].map((r) => `'${r.id}' ${r.version}`).join(' → ');
  return (
    `${callSite}: recipe '${incoming.id}' ${incoming.version} is applying itself — ${cycle}.\n\n` +
    `\`configure\` runs immediately, so this would recurse until the stack ran out rather than ` +
    `converge on a configured agent.\n\n` +
    `Pull the shared part into a THIRD recipe and have both apply that one, or drop the ` +
    `self-application.`
  );
}

/** The refusal for `configure` returning a promise. */
export function asyncConfigureRefusal(recipe: AppliedRecipe, callSite: string): string {
  return (
    `${callSite}: recipe '${recipe.id}' ${recipe.version} returned a promise from \`configure\`. ` +
    `A recipe composes CONFIGURATION only, and \`build()\` is synchronous — there is no phase ` +
    `in which this library would await it, so the work would run after the agent was already ` +
    `built and land on nothing.\n\n` +
    `Do the async part before you build (\`const tools = await mcpClient(…).tools()\`), and ` +
    `have the recipe take what it needs: a recipe can be a plain function of its inputs that ` +
    `RETURNS a recipe (\`export const crm = (tools) => defineAgentRecipe({ … }))\`.`
  );
}
