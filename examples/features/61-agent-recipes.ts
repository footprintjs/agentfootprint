/**
 * 61 — Recipes: the agent's setup as one named, versioned thing.
 *
 * Every capability an agent needs already shipped. What did not was a
 * declared unit of CONFIGURATION — so a setup lived as prose in an
 * example, got copy-pasted into an app, drifted there, and afterwards
 * nothing on the run could say which composition produced the agent
 * that answered.
 *
 * A recipe is that noun: a name, a version, and a function that calls
 * builder methods this library already has. Applying one puts an
 * `{ id, version }` row on the run manifest, beside the provider and
 * the model it already named.
 *
 * This example shows the three things worth knowing:
 *
 *   1. two recipes and one local tool compose in DECLARATION order;
 *   2. the manifest says which compositions produced the agent;
 *   3. a tool name two of them both register refuses at build, naming
 *      BOTH sources — never a coin flip the model resolves silently.
 *
 * Everything here runs on the mock provider: a recipe is resolved
 * entirely at build time, so nothing below makes a model call until the
 * one `agent.run()` at the end.
 *
 * Run:  npm run example examples/features/61-agent-recipes.ts
 */

import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { defineAgentRecipe } from '../../src/doors/recipes.js';
import { defineSteering } from '../../src/doors/context.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/61-agent-recipes',
  title: 'Recipes — a named, versioned agent setup',
  group: 'features',
  description:
    'Declare an agent setup once as a versioned recipe, compose two of them, and read ' +
    'back on the run manifest which compositions produced the agent that answered.',
  defaultInput: 'Where is order 4021?',
  providerSlots: ['default'],
  tags: ['features', 'configuration', 'recipes', 'composition', 'manifest', 'provenance'],
};

const lookupOrder = defineTool({
  name: 'lookup_order',
  description: 'Look up one order by id.',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string', description: 'The order id' } },
    required: ['orderId'],
  },
  execute: async ({ orderId }: { orderId: string }) => `order ${orderId}: in transit`,
});

const escalate = defineTool({
  name: 'escalate',
  description: 'Hand this conversation to a person.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: async () => 'escalated',
});

// #region declare
// ── The composition support runs. Published once, imported everywhere. ──
export const supportDesk = defineAgentRecipe({
  id: 'support-desk',
  version: '1.2.0',
  description: 'Order lookup, the way support runs it.',
  configure: (agent) => {
    agent.system('You answer support questions. Look the order up before you answer.');
    agent.tool(lookupOrder);
  },
});

// ── The rules every agent in this company carries. A different axis, so a
//    different recipe: an app can take one, the other, or both. ──
export const housePolicy = defineAgentRecipe({
  id: 'house-policy',
  version: '2.0.0',
  description: 'The steering every agent here carries.',
  configure: (agent) => {
    agent.steering(
      defineSteering({
        id: 'house-policy',
        prompt: 'Never promise a delivery date you cannot guarantee.',
      }),
    );
  },
});
// #endregion declare

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const llm = provider ?? mock({ reply: 'Your order is on its way.' });

  // #region apply
  // Declaration order IS application order: `support-desk` runs its builder
  // calls first, then `house-policy`, then this app's own tool.
  const agent = Agent.create({ provider: llm, model: 'small-model' })
    .recipe(supportDesk)
    .recipe(housePolicy)
    .tool(escalate)
    .build();
  // #endregion apply

  // The manifest is one event at run start. Subscribe before the run.
  const manifests: { id: string; version: string }[][] = [];
  agent.on('agentfootprint.agent.run_configured', (event) => {
    manifests.push([...(event.payload.recipes ?? [])]);
  });

  const answer = await agent.run({ message: input });

  console.log('the compositions this agent was built from, in declaration order:');
  for (const row of manifests[0] ?? []) console.log(`  ${row.id} ${row.version}`);

  // ── 3. What happens when two compositions claim one name. ──
  const crmBasics = defineAgentRecipe({
    id: 'crm-basics',
    version: '0.4.0',
    configure: (agent) => {
      // The SAME tool name `support-desk` already registers.
      agent.tool({ ...lookupOrder });
    },
  });

  try {
    Agent.create({ provider: llm, model: 'small-model' })
      .recipe(supportDesk)
      .recipe(crmBasics)
      .build();
    throw new Error('expected the duplicate tool name to be refused');
  } catch (error) {
    console.log('\ntwo recipes, one tool name — refused at build, naming both sources:\n');
    console.log(`  ${(error as Error).message.split('\n')[0]}`);
  }

  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
