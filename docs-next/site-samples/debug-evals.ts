import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const agent = Agent.create({ provider: mock({ reply: 'Still pending.' }), model: 'mock' }).build();
const myGrader = (text: unknown) => (String(text).includes('pending') ? 1 : 0);
export const scores: number[] = [];

// #region code
agent.on('agentfootprint.eval.score', (event) => {
  scores.push(event.payload.value);
});

const answer = await agent.run({ message: 'Where is my refund for A-1042?' });

// Your grader decides the score. The library only carries it.
agent.emit('agentfootprint.eval.score', {
  metricId: 'refund-accuracy',
  value: myGrader(answer),
  target: 'run',
  targetRef: 'this-run',
  evaluator: 'heuristic',
});
// #endregion code
