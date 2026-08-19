/**
 * defineAgentRecipe — declare a named, versioned composition.
 *
 * Pattern: a validating factory that freezes. No class, no registry, no
 *          instance state — the "recipes over primitives" instruction taken
 *          literally.
 * Role:    recipes/ layer, pure. The validation it runs is the SAME function
 *          `AgentBuilder.recipe()` runs, so a hand-written literal cannot get
 *          past the checks the factory makes; the factory only moves the
 *          refusal to the declaration, which is where the fix is.
 * Emits:   N/A.
 *
 * ## Why it freezes
 *
 * A recipe is handed to `.recipe()` on one agent and, typically, to `.recipe()`
 * on several more. A mutable one is a shared object that a single consumer can
 * edit for everybody — and the edit would be invisible on the record, because
 * the manifest reports the id and the version, both of which would still say
 * what they always said. `Object.freeze` is shallow, which is exactly the
 * depth that matters here: the four fields are three strings and a function.
 */

import { isPlainRecipeId, recipeIdRefusal } from './identifier.js';
import { isSemverVersion, versionRefusal } from './version.js';
import type { AgentRecipe } from './types.js';

/** The fields a recipe declares. Anything else is a typo — see the refusal. */
const RECIPE_KEYS = ['id', 'version', 'description', 'configure'] as const;

/**
 * A recipe declaration that cannot be honoured. Thrown by
 * {@link defineAgentRecipe} and by `AgentBuilder.recipe()` — the same class
 * from both doors, because it is the same mistake wherever it is caught.
 */
export class InvalidAgentRecipeError extends Error {
  readonly code = 'ERR_INVALID_AGENT_RECIPE' as const;
  /** Which field was refused (`'id'`, `'version'`, `'configure'`, `'shape'`). */
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'InvalidAgentRecipeError';
    this.field = field;
  }
}

/**
 * Validate a recipe declaration, or refuse it by name.
 *
 * Total over `unknown`: this is the one gate, and it is called from the
 * factory AND from `.recipe()`, so no recipe reaches an agent unvalidated.
 *
 * @param value    - the candidate declaration.
 * @param callSite - the API the author called, named in every refusal.
 */
export function assertAgentRecipe(value: unknown, callSite: string): asserts value is AgentRecipe {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidAgentRecipeError(
      'shape',
      `${callSite}: a recipe is an object { id, version, description?, configure }, not ` +
        `${value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value}.`,
    );
  }
  const record = value as Record<string, unknown>;

  // Unknown keys first: `name:` instead of `id:` fails every later check with a
  // message about the field that is MISSING, which sends the reader looking for
  // a field they can plainly see they wrote.
  const unknown = Object.keys(record).filter(
    (key) => !(RECIPE_KEYS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    throw new InvalidAgentRecipeError(
      'shape',
      `${callSite}: unknown field${unknown.length > 1 ? 's' : ''} ${unknown
        .map((k) => `'${k}'`)
        .join(', ')}. A recipe declares exactly ${RECIPE_KEYS.map((k) => `\`${k}\``).join(', ')} ` +
        `— everything else about the agent is expressed by the builder calls \`configure\` ` +
        `makes, which is the whole point of composing over the builder instead of inventing a ` +
        `second configuration format.`,
    );
  }

  if (!isPlainRecipeId(record.id)) {
    throw new InvalidAgentRecipeError('id', recipeIdRefusal(callSite, record.id));
  }
  if (!isSemverVersion(record.version)) {
    throw new InvalidAgentRecipeError('version', versionRefusal(callSite, record.version));
  }
  if (record.description !== undefined && typeof record.description !== 'string') {
    throw new InvalidAgentRecipeError(
      'description',
      `${callSite}: description must be a string (one sentence saying what this composition is ` +
        `for), or omitted. Got ${typeof record.description}.`,
    );
  }
  if (typeof record.configure !== 'function') {
    throw new InvalidAgentRecipeError(
      'configure',
      `${callSite}: configure must be a function (builder) => void — the builder calls this ` +
        `composition stands for. Got ${
          record.configure === undefined ? 'nothing' : typeof record.configure
        }. A recipe with no \`configure\` configures nothing: it would apply cleanly, change ` +
        `no behaviour, and still put a row on the run manifest claiming it shaped the agent.`,
    );
  }
}

/**
 * Declare a recipe: a name, a version, and the builder calls it stands for.
 *
 * Validates every field and returns a frozen object. Refusals name the field
 * and the fix — `defineAgentRecipe` is where a bad id or version costs one
 * line, and `.recipe()` is where the same mistake costs a stack trace through
 * somebody else's app.
 *
 * @example  the composition an app imports and applies
 * ```ts
 * import { defineAgentRecipe } from 'agentfootprint/recipes';
 *
 * export const supportDesk = defineAgentRecipe({
 *   id: 'support-desk',
 *   version: '1.2.0',
 *   description: 'Order lookup + refund policy, the way support runs it.',
 *   configure: (agent) => {
 *     agent.system('You answer support questions.').tool(lookupOrder);
 *   },
 * });
 *
 * const agent = Agent.create({ provider, model }).recipe(supportDesk).build();
 * ```
 */
export function defineAgentRecipe(recipe: AgentRecipe): AgentRecipe {
  assertAgentRecipe(recipe, 'defineAgentRecipe');
  return Object.freeze({ ...recipe });
}
