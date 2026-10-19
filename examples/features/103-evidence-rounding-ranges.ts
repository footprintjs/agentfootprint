/** Mock-only numeric evidence: exact values, honest rounding, and range endpoints. */
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/103-evidence-rounding-ranges',
  title: 'Check decimal precision and numeric range endpoints',
  group: 'features',
  description:
    'Accept one carried decimal rounded at the answer precision and check a range endpoint by endpoint.',
  defaultInput: 'Read the measurement and the observed port range.',
  providerSlots: [],
  tags: ['features', 'evidence'],
};

export async function run(input: string): Promise<unknown> {
  const measurements = defineTool({
    name: 'read_measurements',
    description: 'Read one measurement and the observed port endpoints.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ reading: 5.203, firstPort: 1000, lastPort: 9000 }),
  });
  const provider = mock({
    respond: (request) =>
      request.messages.some((message) => message.role === 'tool')
        ? 'The reading is 5.20; ports 1000–9000 were observed.'
        : { content: '', toolCalls: [{ id: 'read-1', name: 'read_measurements', arguments: {} }] },
  });
  // #region numeric-evidence
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(measurements)
    .namesAndNumbersFromEvidence({ posture: 'rails', decimalRounding: true })
    .build();
  const checks: unknown[] = [];
  agent.on('agentfootprint.agent.evidence_checked', ({ payload }) => checks.push(payload));
  const answer = await agent.run({ message: input });
  // `computed` carries { derivation: 'rounded', from: '5.203 at reading' }.
  // The two port endpoints must each occur in evidence; the dash is no ID.
  // #endregion numeric-evidence
  return {
    answer,
    checks,
    limitation:
      'This checks token evidence and numeric precision, not whether the claim answers the question. Short bare endpoints below minDigits remain unchecked prose.',
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
