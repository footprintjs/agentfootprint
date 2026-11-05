import { Agent, type LLMResponse } from 'agentfootprint';

const callMyModel = async (): Promise<LLMResponse> => ({
  content: 'Hello from my own model.',
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
});

// #region code
const myModel = {
  name: 'my-model',
  complete: () => callMyModel(), // reach your model however you like
};

const agent = Agent.create({ provider: myModel, model: 'any' }).build();
// #endregion code

export const answer = await agent.run({ message: 'hi' });
export const notes = agent.getLastNarrativeEntries().length;
