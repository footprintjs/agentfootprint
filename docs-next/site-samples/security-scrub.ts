import { mock } from 'agentfootprint/providers';
import { defineTool } from 'agentfootprint';

export const SSN = '123-45-6789';
const lookup = defineTool({
  name: 'lookup_customer',
  description: 'Look a customer up.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => ({ name: 'Dana', ssn: '987-65-4321' }),
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

// The message, before the run commits it.
const scrubSSNs: MessageMiddleware = {
  name: 'scrub-ssns',
  onMessage: (message) => allow(message.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'), 'masked an SSN'),
};

// Every tool result, before the model reads it.
const stripPII: ToolMiddleware = {
  name: 'strip-pii',
  onToolResult: (call) => {
    const { ssn: _ssn, ...safe } = call.result as Record<string, unknown>;
    return allow(safe, 'removed the SSN');
  },
};

const agent = Agent.create({ provider, model: 'mock' })
  .tool(lookup)
  .act({ input: [scrubSSNs], afterTool: [stripPII] })
  .build();
// #endregion code

await agent.run({ message: `My SSN is ${SSN}. Look me up.` });
