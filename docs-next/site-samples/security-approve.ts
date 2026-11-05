import { mock } from 'agentfootprint/providers';

export const refunded: number[] = [];
let call = 0;
const provider = mock({
  respond: () => {
    call += 1;
    return call === 1 ? { content: '', toolCalls: [{ id: 'c1', name: 'issue_refund', args: { amount: 5000 } }] } : { content: 'Refunded.' };
  },
});

// #region code
import { Agent, checkInApproved, defineTool, isCheckInPause } from 'agentfootprint';

const issueRefund = defineTool<{ amount: number }, string>({
  name: 'issue_refund',
  description: 'Issue a refund to the customer.',
  inputSchema: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] },
  checkIn: (args) => args.amount > 1000, // a person decides on the big ones
  execute: ({ amount }) => {
    refunded.push(amount);
    return `refunded ${amount}`;
  },
});

const agent = Agent.create({ provider, model: 'mock' }).tool(issueRefund).build();

const outcome = await agent.run({ message: 'Refund $5,000 on A-1042.' });

if (isCheckInPause(outcome)) {
  // The tool has not run. Show the person outcome.checkIn: what it will do, what it read, what drove this.
  const decision = checkInApproved({ request: outcome.checkIn, by: 'ada@ops' });
  await agent.resume(outcome.checkpoint, decision);
}
// #endregion code

export const pausedFirst = isCheckInPause(outcome);
export const evidence = isCheckInPause(outcome) ? outcome.checkIn.evidence : null;
