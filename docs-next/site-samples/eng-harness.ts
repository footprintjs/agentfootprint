import { defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { allow, deny, type ToolMiddleware } from 'agentfootprint';

const getRefund = defineTool<{ orderId: string }, unknown>({
  name: 'get_refund',
  description: 'Look up a refund by order id.',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
  execute: ({ orderId }) => ({ orderId, status: 'pending' }),
});
const knownOrdersOnly: ToolMiddleware = {
  name: 'known-orders-only',
  onToolCall: (call) => (/^A-\d{4}$/.test(String(call.args.orderId)) ? allow() : deny('order ids look like A-1042')),
};
export const primaryCalls = { count: 0 };
const primary = mock({
  respond: () => {
    primaryCalls.count += 1;
    throw Object.assign(new Error('overloaded'), { status: 529 });
  },
});
const backup = mock({ reply: 'Still pending.' });

// #region code
import { Agent } from 'agentfootprint';
import { auditExport } from 'agentfootprint/observe';
import { withFallback } from 'agentfootprint/resilience';
import { PermissionPolicy, conversationRedaction } from 'agentfootprint/security';

const roles = { support: ['get_refund', 'list_skills', 'read_skill'] };

const agent = Agent.create({
  provider: withFallback(primary, backup), //  stay up when a provider is down
  model: 'mock',
  permissionChecker: PermissionPolicy.fromRoles(roles, 'support'), // who can call what
  redact: conversationRedaction(), //          what the record keeps
})
  .system('You answer refund questions.') //   the prompt
  .tool(getRefund) //                          the tools
  .act({ beforeTool: [knownOrdersOnly] }) //   the loop
  .selfExplain() //                            it can read its own record
  .build();

const audit = auditExport({ agent: 'refunds' }); // proof, afterwards
agent.enable.observability({ strategy: audit });
// #endregion code

export const answer = await agent.run({ message: 'Where is my refund?' });
export const bundle = audit.bundle();
