import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { staticTokens } from 'agentfootprint/security';

export const TOKEN = 'secret-token-7731';
process.env.HELPDESK_TOKEN = TOKEN;
export const headersSeen: Record<string, string>[] = [];
const postToHelpdesk = (headers: Record<string, string>) => {
  headersSeen.push(headers);
  return 'filed';
};
export const sent: string[] = [];
let call = 0;
const provider = mock({
  respond: (request) => {
    sent.push(JSON.stringify(request));
    call += 1;
    return call === 1 ? { content: '', toolCalls: [{ id: 'c1', name: 'create_ticket', args: {} }] } : { content: 'Filed.' };
  },
});

// #region code
const createTicket = defineTool({
  name: 'create_ticket',
  description: 'File a support ticket.',
  inputSchema: { type: 'object', properties: {} },
  needs: { credential: 'helpdesk' }, // what it needs, not the secret itself
  execute: (_args, ctx) => postToHelpdesk(ctx.credential!.toHeaders()), // this tool, at this moment
});

const agent = Agent.create({
  provider,
  model: 'mock',
  credentials: staticTokens({ helpdesk: process.env.HELPDESK_TOKEN! }), // or vaultCredentials(), or your own
})
  .tool(createTicket)
  .build();
// #endregion code

await agent.run({ message: 'File a ticket.' });
export const record = JSON.stringify(agent.getLastSnapshot());
