/** Opt-in outer JSON meanings, checked at a mock provider boundary. No network. */
import { LLMCall } from 'agentfootprint';
import {
  CONTEXT_FIELD_MEANINGS,
  contextContractForModel,
  resolveEvidenceNeed,
} from 'agentfootprint/context';
import { mock } from 'agentfootprint/providers';

async function main(): Promise<void> {
  const need = { id: 'worker-health', description: 'Worker-health observations for this queue.' };
  const navigation = resolveEvidenceNeed(
    need,
    [
      {
        id: 'ops',
        need: need.id,
        destination: 'operations team',
        description: 'Request worker-health observations.',
        requiredInputs: ['queue', 'interval'],
      },
    ],
    ['queue'],
  );
  if (
    navigation.routes[0]?.status !== 'needs_input' ||
    navigation.routes[0].missingInputs[0] !== 'interval'
  )
    throw new Error('Missing evidence inputs must stay explicit.');
  if (resolveEvidenceNeed(need).status !== 'not_configured')
    throw new Error('Missing map must be explicit.');
  const context = {
    objective: 'Describe this recorded queue state.',
    completionRequirements: ['Retain the worker-health limitation.'],
    scope: { snapshot: 'snapshot:demo', queue: 'queue:A' },
    facts: [{ waiting: 0, oldestAgeSeconds: null }],
    limitations: ['Worker health was not checked.'],
    evidenceRefs: [],
    nextSteps: [navigation],
    domainDefinitions: { waiting: 'Queued jobs in this snapshot.' },
  };
  const message = JSON.stringify(context);
  const guidance = contextContractForModel();
  let observed = false;
  const provider = mock({
    respond(request) {
      if (request.systemPrompt !== guidance) throw new Error('Missing opt-in contract.');
      if (!request.messages.some((entry) => entry.role === 'user' && entry.content === message)) {
        throw new Error('Context JSON changed before the provider boundary.');
      }
      observed = true;
      // Scripted response: this example proves wire delivery, not model reasoning.
      return 'The snapshot records zero queued jobs. Worker health remains unknown.';
    },
  });
  const call = LLMCall.create({ provider, model: 'mock' }).system(guidance).build();
  const answer = await call.run({ message });
  if (!observed) throw new Error('Mock provider was not called.');
  console.log(JSON.stringify({ fields: Object.keys(CONTEXT_FIELD_MEANINGS), observed, answer }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
