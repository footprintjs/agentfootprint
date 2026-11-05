import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).build();
export const shipped: string[] = [];
const sendToYourBackend = (type: string) => shipped.push(type);

// #region code
agent.enable.observability({
  strategy: {
    name: 'my-backend',
    capabilities: { events: true },
    exportEvent: (event) => sendToYourBackend(event.type), // synchronous, and must not throw
  },
});
// #endregion code

await agent.run({ message: 'hi' });
