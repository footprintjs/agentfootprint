/**
 * recipes/types — the declared unit of agent configuration.
 *
 * Pattern: a data DECLARATION over an existing fluent builder. No class, no
 *          registry, no lifecycle. The repo's own instruction is that named
 *          patterns are recipes over primitives rather than new machinery, and
 *          this file is that instruction taken literally.
 * Role:    recipes/ layer, pure. Nothing here imports the engine, a provider,
 *          or a store — the only agentfootprint type it names is
 *          {@link AgentBuilder}, and it names it as a TYPE.
 * Emits:   N/A. `AgentBuilder.recipe()` records the row; `runManifest` reports
 *          it.
 *
 * ## The gap this closes
 *
 * Every capability an agent needs already ships. What did not ship was a
 * declared, versioned, inspectable unit of CONFIGURATION. So an agent's setup
 * lived as prose in an example, was copy-pasted into an app, drifted there, and
 * afterwards nothing on the run could say which composition produced the agent
 * that answered. Two runs of "the support agent" could differ in every tool and
 * every instruction and be indistinguishable on the record.
 *
 * A recipe is the missing noun: a name, a version, and a function that calls
 * the builder methods that already exist.
 *
 * ```ts
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
 *
 * ## No lifecycle magic — stated here because it is the load-bearing limit
 *
 * A recipe composes CONFIGURATION and nothing else:
 *
 *   • nothing is registered anywhere — a recipe is not discovered, not looked
 *     up by name, and not resolved from a registry. You import the object and
 *     hand it to `.recipe()`. There is no global map to go stale, and no
 *     "which version of `support-desk` is installed" question;
 *   • nothing is closable — a recipe holds no connection, no handle and no
 *     process. It never gets a `close()`, a `dispose()` or a teardown hook,
 *     and it is never awaited: `configure` is synchronous because `build()`
 *     is (an `async configure` is refused by name rather than silently not
 *     awaited);
 *   • nothing is deferred — every call `configure` makes happens during
 *     `.recipe()`, at the position in the chain where you wrote it. There is
 *     no later phase in which a recipe acts, so a run's behaviour is decided
 *     entirely by the builder calls you can read.
 *
 * That is deliberately thin. The thing being named is a COMPOSITION, and a
 * composition that also owned a resource would be a component wearing a
 * composition's name — the shape that makes "who closed the pool?" unanswerable
 * two releases later.
 */

import type { AgentBuilder } from '../core/agent/AgentBuilder.js';

/**
 * A named, versioned composition over the agent builder.
 *
 * Build one with {@link defineAgentRecipe}, which validates every field and
 * freezes the result. A hand-written object literal is accepted by
 * `.recipe()` too — it runs the SAME validation — so a recipe cannot reach an
 * agent without passing the checks; the factory only moves the refusal to the
 * declaration, where the fix is.
 */
export interface AgentRecipe {
  /**
   * The composition's plain name — lower-case words joined by single hyphens
   * (`support-desk`, `triage`, `refund-policy`).
   *
   * It carries NO version: `support-desk-2` is refused, because the version
   * axis already exists as its own field and an id that encodes one produces
   * two names for one composition, neither of which can be grouped on.
   */
  readonly id: string;
  /**
   * The composition's version, as SemVer 2.0.0 (`'1.2.0'`, `'2.0.0-rc.1'`).
   *
   * A version is what makes a recipe row on a run manifest worth reading: two
   * runs of `support-desk` that answered differently are a mystery until the
   * record says one was `1.2.0` and the other `1.3.0`.
   */
  readonly version: string;
  /** What this composition is for, in one sentence. Optional, and never
   *  reported on the wire — the manifest carries the id and the version only. */
  readonly description?: string;
  /**
   * Apply the composition: call the builder methods this recipe stands for.
   *
   * Runs SYNCHRONOUSLY, exactly once, at the `.recipe()` call site. The return
   * value is ignored — `AgentBuilder` is mutated in place and every method
   * returns the same object — so `(agent) => agent.system('…').tool(t)` and a
   * statement body are the same program.
   */
  configure(builder: AgentBuilder): void;
}

/**
 * One applied recipe, as the run manifest reports it: the id and the version,
 * never the description and never the function.
 *
 * The two stay SEPARATE FIELDS on purpose. A composed key (`'support-desk@1.2.0'`)
 * would be one string that two different pairs could produce as soon as either
 * half is allowed to contain the separator — the collision class this repo has
 * fixed seven times. Nothing here ever joins them.
 */
export interface AppliedRecipe {
  readonly id: string;
  readonly version: string;
}

/**
 * What happens when a recipe introduces a tool name or an injection id that is
 * already taken.
 *
 * `'error'` is the only policy that exists, and it is the default. The
 * alternatives a reader will reach for — skip the recipe's version, let it
 * replace what is there, rename one automatically — are real designs, and none
 * of them is implemented: each has to answer where the drop is RECORDED, and a
 * conflict resolved silently is exactly the "accepted and quietly wrong" shape
 * this library refuses. So an unimplemented policy is refused by name (see
 * {@link resolveRecipeConflictPolicy}) rather than approximated by the one that
 * ships.
 */
export type RecipeConflictPolicy = 'error';

/** Options for `AgentBuilder.recipe(recipe, options)`. */
export interface RecipeOptions {
  /** See {@link RecipeConflictPolicy}. Default `'error'`. */
  readonly conflict?: RecipeConflictPolicy;
}
