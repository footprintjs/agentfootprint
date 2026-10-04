/** Output policy governs public answer delivery, not erasure of the audit record. */
import assert from 'node:assert/strict';
import { Agent, allow, deny, MessageDeniedError } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/90-output-admission',
  title: 'Output admission — deliver only the accepted answer',
  group: 'features',
  description:
    'An output rule holds draft tokens, then releases the captured rewrite once. A refusal closes the stream without delivering an answer.',
  defaultInput: 'Give me the account summary.',
  providerSlots: [],
  tags: ['features', 'middleware', 'security', 'streaming'],
};

export async function run(input: string): Promise<string> {
  // #region output-admission
  const agent = Agent.create({
    provider: mock({ respond: () => 'Account PRIVATE-123 is active.' }),
    model: 'mock',
  })
    .act({
      output: [
        {
          name: 'mask-account-id',
          onMessage: (message) =>
            allow(message.content.replace('PRIVATE-123', '[account]'), 'masked account id'),
        },
      ],
    })
    .build();

  const delivered: string[] = [];
  agent.on('agentfootprint.stream.token', (event) => delivered.push(event.payload.content));
  agent.on('agentfootprint.stream.llm_end', (event) => {
    assert.equal(event.payload.content, '');
    assert.equal(event.payload.contentWithheld, true); // usage and timing still available
  });
  const answer = await agent.run(input);
  assert.equal(answer, 'Account [account] is active.');
  assert.deepEqual(delivered, [answer]); // one captured answer, not raw provider chunks
  // #endregion output-admission

  const refused = Agent.create({
    provider: mock({ respond: () => 'PRIVATE-456' }),
    model: 'mock',
  })
    .act({ output: [{ name: 'review-required', onMessage: () => deny('Review required.') }] })
    .build();
  const terminals: string[] = [];
  refused.on('agentfootprint.stream.token', () => assert.fail('refused answer escaped'));
  refused.on('agentfootprint.agent.turn_end', () => assert.fail('refusal is not success'));
  refused.on('agentfootprint.error.fatal', (event) => terminals.push(event.payload.stage));
  await assert.rejects(refused.run(input), MessageDeniedError);
  assert.deepEqual(terminals, ['__output_admission__']);
  // The decision and raw draft remain in the audit record. Protect that record
  // separately; an output rule is not a safe-export or retention policy.
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
