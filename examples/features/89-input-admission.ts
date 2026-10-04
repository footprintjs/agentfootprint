/** A refused input is recorded, but is not a conversation to continue. */
import assert from 'node:assert/strict';
import { Agent, allow, deny, MessageDeniedError, NoConversationError } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/89-input-admission',
  title: 'Input admission — continue only the accepted conversation',
  group: 'features',
  description:
    'A refused message makes no conversation checkpoint. Keep the last accepted checkpoint and continue it explicitly.',
  defaultInput: 'Continue the accepted conversation.',
  providerSlots: [],
  tags: ['features', 'middleware', 'security', 'conversation'],
};

export async function run(input: string): Promise<string> {
  const requests: string[] = [];
  const provider = mock({
    respond: (request) => {
      requests.push(JSON.stringify(request.messages));
      return 'Accepted.';
    },
  });
  // #region input-refusal
  const agent = Agent.create({ provider, model: 'mock' })
    .act({
      input: [
        {
          name: 'no-private-markers',
          onMessage: (message) =>
            message.content.includes('PRIVATE:')
              ? deny('Remove the private marker before submitting.')
              : allow(),
        },
      ],
    })
    .build();

  await agent.run('Start a conversation.');
  const accepted = agent.checkpoint();
  assert.ok(accepted);
  await assert.rejects(agent.followUp('PRIVATE: not for the model'), MessageDeniedError);
  assert.equal(agent.checkpoint(), undefined); // the refused attempt is not a conversation
  await assert.rejects(agent.followUp('Try again.'), NoConversationError);

  // Choose the earlier accepted conversation explicitly. A hosted session
  // already keeps its last accepted checkpoint under every durability mode.
  const answer = await agent.run({ message: input, continueFrom: accepted });
  // #endregion input-refusal
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => !request.includes('PRIVATE:')));
  assert.equal(answer, 'Accepted.');
  return answer as string;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput!)
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
