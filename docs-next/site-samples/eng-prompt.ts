import { mock } from 'agentfootprint/providers';

export const sent: string[] = [];
const provider = mock({
  respond: (request) => {
    sent.push(JSON.stringify(request));
    return { content: 'ok' };
  },
});

// #region code
import { Agent } from 'agentfootprint';
import { defineInstruction } from 'agentfootprint/context';

const calmTone = defineInstruction({
  id: 'calm-tone',
  activeWhen: (ctx) => /upset|angry|frustrated/i.test(ctx.userMessage),
  prompt: 'The user sounds upset. Acknowledge feelings before facts.',
});

const agent = Agent.create({ provider, model: 'mock' })
  .system('You answer refund questions.')
  .instruction(calmTone)
  .build();
// #endregion code

await agent.run({ message: 'Where is my refund?' });
await agent.run({ message: 'I am really upset about this refund.' });
