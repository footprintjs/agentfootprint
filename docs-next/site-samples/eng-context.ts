import { mock } from 'agentfootprint/providers';

const provider = mock({ reply: 'ok' });
export const landed: string[] = [];

// #region code
import { Agent, contextEngineering } from 'agentfootprint';
import { defineFact, defineSkill, defineSteering } from 'agentfootprint/context';
import { InMemoryStore, MEMORY_STRATEGIES, MEMORY_TYPES, defineMemory } from 'agentfootprint/memory';

const agent = Agent.create({ provider, model: 'mock' })
  .system('You answer refund questions.')
  .steering(defineSteering({ id: 'tone', prompt: 'Be brief and kind.' }))
  .fact(defineFact({ id: 'plan', data: 'Customer plan: Pro.' }))
  .skill(defineSkill({ id: 'refunds', description: 'Refund rules.', body: 'Check the ledger first.' }))
  .memory(
    defineMemory({
      id: 'recent',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
      store: new InMemoryStore(),
    }),
  )
  .build();

// Every piece that lands, and where it landed, on every iteration.
contextEngineering(agent).onEngineered((event) => {
  landed.push(`${event.payload.source} → ${event.payload.slot}`);
});
// #endregion code

await agent.run({ message: 'Where is my refund?', identity: { conversationId: 'c1' } });
