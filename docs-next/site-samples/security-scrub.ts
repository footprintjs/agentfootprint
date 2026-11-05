import { mock } from 'agentfootprint/providers';
import { defineTool } from 'agentfootprint';

export const THE_SSN = '123-45-6789';
const lookup = defineTool({
  name: 'lookup_customer',
  description: 'Look a customer up.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => ({ name: 'Dana', profile: { ssn: '987-65-4321' }, note: 'Her SSN is 555-12-3456.' }),
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
import { Agent, allow, type MessageMiddleware, type ToolMiddleware } from 'agentfootprint';

const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

// The message, before the run commits it.
const scrubSSNs: MessageMiddleware = {
  name: 'scrub-ssns',
  onMessage: (message) => {
    const clean = message.content.replace(SSN, '[ssn]');
    return clean === message.content ? allow() : allow(clean, 'masked an SSN');
  },
};

// Every tool result, before the model reads it, at any depth.
const stripPII: ToolMiddleware = {
  name: 'strip-pii',
  onToolResult: (call) => {
    const before = JSON.stringify(call.result);
    const after = before.replace(SSN, '[ssn]');
    return after === before ? allow() : allow(JSON.parse(after), 'masked an SSN');
  },
};

const agent = Agent.create({ provider, model: 'mock' })
  .tool(lookup)
  .act({ input: [scrubSSNs], afterTool: [stripPII] })
  .build();
// #endregion code

await agent.run({ message: `My SSN is ${THE_SSN}. Look me up.` });
