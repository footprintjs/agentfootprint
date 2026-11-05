import { Agent } from 'agentfootprint';
import { anthropic } from 'agentfootprint/providers';
import { getRefund } from './shared';

// #region code
const agent = Agent.create({
  provider: anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  model: 'claude-sonnet-5-5',
})
  .system('You answer refund questions.')
  .tool(getRefund)
  .build();
// #endregion code

export { agent };
