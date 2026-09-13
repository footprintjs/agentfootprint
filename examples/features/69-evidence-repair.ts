/** Evidence repair guidance (9.96.0). Mock only: no API key or external data. */
import { Agent } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/69-evidence-repair',
  title: 'Ask for missing context during evidence repair',
  group: 'features',
  description:
    'A scripted unsupported year triggers one repair; configured guidance asks for the missing year and timezone.',
  defaultInput: 'Investigate the incident on September eleventh.',
  providerSlots: [],
  tags: ['features', 'evidence', 'recovery'],
};

const GUIDANCE =
  'If required date or scope details are missing, ask the user for them. ' +
  'Do not suggest guessed years, timezones, identifiers or example values.';
const CLARIFICATION = 'Which year and timezone should I use?';

export async function run(input: string): Promise<unknown> {
  let calls = 0;
  let guidanceServed = false;
  const actions: string[] = [];
  const provider = mock({
    respond(request) {
      calls++;
      if (calls === 1) return 'The incident happened in 2037.'; // Deliberate unsupported draft.
      guidanceServed = request.systemPrompt?.includes(GUIDANCE) === true;
      if (!guidanceServed)
        throw new Error('The repair request did not carry the configured guidance.');
      const userTurns = request.messages.filter((message) => message.role === 'user');
      if (userTurns.length !== 1 || userTurns[0]!.content !== input)
        throw new Error(
          'Recovery must preserve the real user turn without adding a synthetic one.',
        );
      return CLARIFICATION;
    },
  });
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 3 })
    .namesAndNumbersFromEvidence({ posture: 'rails', recoveryInstruction: GUIDANCE })
    .build();
  agent.on('agentfootprint.agent.evidence_checked', (event) => actions.push(event.payload.action));
  const answer = await agent.run({ message: input });
  if (calls !== 2 || answer !== CLARIFICATION || actions.join(',') !== 'revision-asked,grounded')
    throw new Error('Expected one unsupported draft, one repair and the scripted clarification.');
  return {
    answer,
    calls,
    guidanceServed,
    checks: actions,
    limitation:
      'This mock demonstrates delivery of repair guidance. Lexical checking does not prove question interpretation or claim semantics.',
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
