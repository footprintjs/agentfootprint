import { Agent } from 'agentfootprint';
import { MEMORY_STRATEGIES, MEMORY_TYPES, defineMemory, InMemoryStore } from 'agentfootprint/memory';
import { mock } from 'agentfootprint/providers';

export const sent: string[] = [];
const provider = mock({
  respond: (request) => {
    sent.push(JSON.stringify(request));
    return { content: 'noted' };
  },
});
const store = new InMemoryStore();
const agent = Agent.create({ provider, model: 'mock' })
  .memory(defineMemory({ id: 'recent', type: MEMORY_TYPES.EPISODIC, strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 }, store }))
  .build();

// #region code
const acme = { tenant: 'acme', principal: 'ada', conversationId: 'thread-1' };
const globex = { tenant: 'globex', principal: 'ada', conversationId: 'thread-1' };

await agent.run({ message: 'Our plan is Enterprise.', identity: acme });

// The same person and thread id under another tenant. Nothing carries over.
await agent.run({ message: 'What is our plan?', identity: globex });

// Remove everything for one identity.
await store.forget(acme);
// #endregion code

await agent.run({ message: 'What is our plan?', identity: acme });
