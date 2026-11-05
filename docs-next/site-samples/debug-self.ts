import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { getRefund } from './shared';

/* The scripted model asks for the trace tools only when it is asked why, as a real one would. */
export const catalogs: string[][] = [];
const provider = mock({
  respond: (request) => {
    const tools = (request.tools ?? []).map((tool) => tool.name);
    catalogs.push(tools);
    const said = JSON.stringify(request.messages);
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const asking = /why/i.test(JSON.stringify(lastUser?.content ?? ''));
    if (tools.includes('run_overview')) {
      return said.includes('TRACE RUN OVERVIEW')
        ? 'I approved it because the ledger row for A-1042 said completed.'
        : { toolCalls: [{ id: 'o1', name: 'run_overview', args: {} }] };
    }
    if (asking && tools.includes('read_skill')) return { toolCalls: [{ id: 's1', name: 'read_skill', args: { id: 'self-explain' } }] };
    if (tools.includes('get_refund') && !said.includes('"status"')) return { toolCalls: [{ id: 't1', name: 'get_refund', args: { orderId: 'A-1042' } }] };
    return 'Approved: the refund for A-1042 is complete.';
  },
});

// #region code
const agent = Agent.create({ provider, model: 'mock' })
  .system('You are a refunds assistant.')
  .tool(getRefund)
  .selfExplain() // one line, and the trace tools stay hidden until someone asks
  .build();

await agent.run({ message: 'Should order A-1042 be refunded?' });

// The next turn asks about the last one. It answers from its own record.
const why = await agent.run({ message: 'Why did you approve it?' });
// #endregion code

export { why };
