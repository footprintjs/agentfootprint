/** Mock-only numeric evidence: exact values, honest rounding, scientific notation and range endpoints. */
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/103-evidence-rounding-ranges',
  title: 'Check decimal precision and numeric range endpoints',
  group: 'features',
  description:
    'Accept one carried decimal rounded at the answer precision, read a printed 1.12e-02 as 0.0112, and check a range endpoint by endpoint.',
  defaultInput: 'Read the measurement, the observed port range and the test result.',
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
  // A script's stdout, served as text: small values print in scientific notation.
  const script = defineTool({
    name: 'run_test',
    description: 'Run the significance test and return what it printed.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => 't = 2.54, p = 1.12e-02',
  });
  const provider = mock({
    respond: (request) =>
      request.messages.some((message) => message.role === 'tool')
        ? 'The reading is 5.20; ports 1000–9000 were observed; the test gave p = 0.0112.'
        : {
            content: '',
            toolCalls: [
              { id: 'read-1', name: 'read_measurements', args: {} },
              { id: 'test-1', name: 'run_test', args: {} },
            ],
          },
  });
  // #region numeric-evidence
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(measurements)
    .tool(script)
    .namesAndNumbersFromEvidence({ posture: 'rails', decimalRounding: true })
    .build();
  const checks: unknown[] = [];
  agent.on('agentfootprint.agent.evidence_checked', ({ payload }) => checks.push(payload));
  const answer = await agent.run({ message: input });
  // `computed` carries { derivation: 'rounded', from: '5.203 at reading' }.
  // The two port endpoints must each occur in evidence; the dash is no ID.
  // The printed `1.12e-02` grounds the answer's `0.0112`: one number, two spellings.
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
