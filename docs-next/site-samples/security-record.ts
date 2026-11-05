import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

export const SSN = '123-45-6789';
const lookup = defineTool({
  name: 'lookup_customer',
  description: 'Look a customer up.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => ({ name: 'Dana', ssn: SSN }),
});
export const sent: string[] = [];
let call = 0;
const provider = mock({
  respond: (request) => {
    sent.push(JSON.stringify(request));
    call += 1;
    return call === 1 ? { content: '', toolCalls: [{ id: 'c1', name: 'lookup_customer', args: {} }] } : { content: 'Found her.' };
  },
});

// #region code
import { recordRun } from 'agentfootprint/observe';
import { conversationRedaction } from 'agentfootprint/security';

const agent = Agent.create({
  provider,
  model: 'mock',
  // The conversation, and the fields your own tools name.
  redact: conversationRedaction({ patterns: [/ssn|email/i] }),
})
  .tool(lookup)
  .build();

const recorder = recordRun(agent);
await agent.run({ message: 'Look up Dana.' });
const recording = recorder.toRecording(); // what you store or send
// #endregion code

export { recording };
export const snapshot = agent.getLastSnapshot();
export const narrative = agent.getLastNarrativeEntries();
