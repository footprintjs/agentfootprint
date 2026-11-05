// #region code
import { Agent } from 'agentfootprint';
import { agentCoreRuntimeHost, agentCoreSessions, standingAgent } from 'agentfootprint/hosting';
import { AgentCoreStore, MEMORY_STRATEGIES, MEMORY_TYPES, defineMemory } from 'agentfootprint/memory';
import { bedrock } from 'agentfootprint/providers';

const memory = defineMemory({
  id: 'conversation',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store: new AgentCoreStore({ memoryId: process.env.AGENTCORE_MEMORY_ID!, region: 'us-west-2' }),
});

await standingAgent({
  agentFactory: () =>
    Agent.create({ provider: bedrock({ region: 'us-west-2' }), model: 'bedrock' }).memory(memory).build(),
  host: agentCoreRuntimeHost(),
  sessions: agentCoreSessions({ store: 'session-storage' }),
});
// #endregion code
