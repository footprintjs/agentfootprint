import { defineTool, type Tool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const tool = (name: string, onRun: () => void): Tool =>
  defineTool({
    name,
    description: name,
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      onRun();
      return 'done';
    },
  }) as Tool;
export const ran: string[] = [];
const getRefund = tool('get_refund', () => ran.push('get_refund'));
const processRefund = tool('process_refund', () => ran.push('process_refund'));
export const catalogs: string[][] = [];
let call = 0;
const provider = mock({
  respond: (request) => {
    catalogs.push((request.tools ?? []).map((t) => t.name));
    call += 1;
    /* A model that tries a tool it was never shown, as a hijacked one might. */
    return call === 1 ? { content: '', toolCalls: [{ id: 'c1', name: 'process_refund', args: {} }] } : { content: 'I cannot do that.' };
  },
});

// #region code
import { Agent } from 'agentfootprint';
import { gatedTools, staticTools } from 'agentfootprint/providers';
import { PermissionPolicy } from 'agentfootprint/security';

const policy = PermissionPolicy.fromRoles(
  {
    readonly: ['get_refund'],
    support: ['get_refund', 'process_refund'],
  },
  'readonly', // the role for this request
);

const agent = Agent.create({ provider, model: 'mock', permissionChecker: policy }) // refused if called
  .toolProvider(gatedTools(staticTools([getRefund, processRefund]), (name) => policy.isAllowed(name))) // hidden from the model
  .build();
// #endregion code

export const checks: unknown[] = [];
agent.on('agentfootprint.permission.check', (event) => checks.push(event.payload.result));
await agent.run({ message: 'Refund it.' });
