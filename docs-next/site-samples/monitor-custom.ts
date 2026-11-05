import { Agent, type CombinedRecorder } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const provider = mock({ reply: 'ok' });
export const written: string[] = [];
export const flagged: unknown[] = [];
const alertTeam = (payload: unknown) => flagged.push(payload);

// #region code
// A recorder of your own sees every state write as the run happens.
const refundWatch: CombinedRecorder = {
  id: 'refund-watch',
  onWrite: (event) => written.push(event.key),
};

const agent = Agent.create({ provider, model: 'mock' }).watch(refundWatch).build();

// Your own events travel the same stream as the library's.
agent.on('*', (event) => {
  const { type, payload } = event as { type: string; payload: unknown };
  if (type === 'myapp.refund.flagged') alertTeam(payload);
});
agent.emit('myapp.refund.flagged', { order: 'A-1042' });
// #endregion code

export const exported: string[] = [];
agent.enable.observability({
  strategy: { name: 'sink', capabilities: { events: true }, exportEvent: (event) => exported.push(event.type) },
});
agent.emit('myapp.refund.flagged', { order: 'A-1043' });
await agent.run({ message: 'hi' });
