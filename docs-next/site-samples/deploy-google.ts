// #region code
import { Agent } from 'agentfootprint';
import { agentEngineSessions, nodeHost, standingAgent } from 'agentfootprint/hosting';
import { MEMORY_STRATEGIES, MEMORY_TYPES, defineMemory, memoryBankStore } from 'agentfootprint/memory';
import { gemini } from 'agentfootprint/providers';

const vertex = { project: process.env.GOOGLE_CLOUD_PROJECT!, location: 'us-central1', reasoningEngine: process.env.REASONING_ENGINE_ID! };

const memory = defineMemory({
  id: 'conversation',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store: memoryBankStore(vertex),
});

await standingAgent({
  agentFactory: () =>
    Agent.create({ provider: gemini({ project: vertex.project, location: vertex.location }), model: 'gemini' }).memory(memory).build(),
  host: nodeHost({ port: Number(process.env.PORT ?? 8080) }),
  sessions: agentEngineSessions(vertex),
});
// #endregion code
