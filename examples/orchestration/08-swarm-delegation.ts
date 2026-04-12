/**
 * Sample 08: Swarm Delegation
 *
 * LLM-routed multi-agent handoff — orchestrator delegates to specialists.
 * agentObservability() tracks tokens, tools, and cost across delegation.
 */
import { Swarm, LLMCall, mock } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';

export async function run(input: string) {
  const obs = agentObservability();

  const billing = LLMCall
    .create({ provider: mock([{ content: 'Your refund of $50 has been processed. It will appear in 3-5 business days.' }]) })
    .system('Handle billing inquiries:')
    .build();

  const technical = LLMCall
    .create({ provider: mock([{ content: 'Please try restarting your router.' }]) })
    .system('Handle technical issues:')
    .build();

  const runner = Swarm
    .create({
      provider: mock([
        { content: 'Routing to billing.', toolCalls: [{ id: '1', name: 'delegate_billing', arguments: { task: 'Process refund request' } }] },
        { content: 'The billing team has processed your refund.' },
      ]),
      name: 'support-swarm',
    })
    .system('Route customer requests to the appropriate specialist.')
    .specialist('billing', 'Handles billing and payment issues', billing)
    .specialist('technical', 'Handles technical support', technical)
    .recorder(obs)
    .build();

  const result = await runner.run(input);
  return { content: result.content, tokens: obs.tokens(), tools: obs.tools(), cost: obs.cost() };
}

if (process.argv[1] === import.meta.filename) {
  run('I need a refund for my last bill.').then(console.log);
}
