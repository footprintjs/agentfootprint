/**
 * agentfootprint/recipes — the declared unit of agent configuration.
 *
 * Every capability an agent needs already ships. What did not was a named,
 * versioned, inspectable unit of CONFIGURATION — so an agent's setup lived as
 * prose in an example, was copy-pasted into an app, drifted there, and
 * afterwards nothing on the run could say which composition produced the agent
 * that answered.
 *
 * A recipe is that noun, and it is deliberately thin: a name, a version, and a
 * function that calls builder methods this library already has. No class, no
 * registry, nothing to close, nothing deferred — see `AgentRecipe` for why each
 * of those is a limit rather than an omission.
 *
 * Its own door, and not the main barrel, for the reason `/context` and
 * `/skill-graph` have one: this is authoring-time vocabulary. An app that
 * consumes a recipe imports the object and calls `.recipe()`; only the code
 * that DECLARES one needs `defineAgentRecipe`.
 *
 * @example  declare a composition, then apply it
 * ```ts
 * import { Agent } from 'agentfootprint';
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
 * // → the run manifest now carries { id: 'support-desk', version: '1.2.0' }
 * ```
 */

export * from '../recipes/index.js';
