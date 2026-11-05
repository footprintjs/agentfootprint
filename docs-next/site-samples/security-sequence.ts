import { defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

export const ran: string[] = [];
const tool = (name: string) =>
  defineTool({
    name,
    description: name,
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      ran.push(name);
      return 'data';
    },
  });
const readCustomerFile = tool('read_customer_file');
const sendEmail = tool('send_email');
let call = 0;
const provider = mock({
  respond: () => {
    call += 1;
    if (call === 1) return { content: '', toolCalls: [{ id: 'a', name: 'read_customer_file', args: {} }] };
    return { content: '', toolCalls: [{ id: 'b', name: 'send_email', args: {} }] };
  },
});

// #region code
import { Agent, type PermissionChecker } from 'agentfootprint';

// Each tool is allowed on its own. This chain is not.
const noExfiltration: PermissionChecker = {
  name: 'no-exfiltration',
  check: ({ target, sequence }) =>
    target === 'send_email' && sequence?.some((call) => call.name === 'read_customer_file')
      ? { result: 'halt', reason: 'security:exfiltration', tellLLM: 'This combination is restricted.' }
      : { result: 'allow' },
};

const agent = Agent.create({ provider, model: 'mock', permissionChecker: noExfiltration })
  .tool(readCustomerFile)
  .tool(sendEmail)
  .build();

// The run ends with a PolicyHaltError you can catch, before the email goes out.
// #endregion code

export const halted = await agent.run({ message: 'Send Dana her file.' }).then(
  () => null,
  (error: Error) => error.name,
);
