/**
 * Read coverage and evidence before filing a completed turn.
 * Run: npm run example examples/observability/28-completed-turn-evidence.ts
 */
import { Agent, coverage, defineTool } from '../../src/index.js';
import { readTurnCoverage, readTurnEvidenceVerdict, recordRun } from '../../src/doors/observe.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/28-completed-turn-evidence',
  title: 'Coverage and evidence for a completed turn',
  group: 'observability',
  description: 'Read per-call declaration counts and the final evidence verdict before filing.',
  defaultInput: 'What did the lookup find?',
  providerSlots: [],
  tags: ['observability', 'recording', 'coverage', 'evidence'],
};

export async function main() {
  const lookup = defineTool({
    name: 'lookup',
    description: 'Read the local inventory.',
    inputSchema: { type: 'object' },
    execute: () => coverage({ devices: 42 }, { checked: ['local inventory'] }),
  });
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'inventory', name: 'lookup', args: {} }] },
        { content: 'The inventory contains 42 devices.' },
      ],
    }),
    model: 'mock',
  })
    .tool(lookup)
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .build();

  // #region completed-turn
  const recorder = recordRun(agent);
  try {
    await agent.run({ message: 'What did the lookup find?' });
  } finally {
    recorder.stop();
  }

  const recording = recorder.toRecording();
  const terminal = recording.events.find((event) => event.type === 'agentfootprint.agent.turn_end');
  if (!terminal) throw new Error('The recording has no finished turn.');
  const runId = terminal.meta.runId;
  // #endregion completed-turn

  // #region coverage
  const callCoverage = readTurnCoverage(recording, runId);
  for (const call of callCoverage ?? []) {
    console.log(
      call.toolCallId,
      call.declarations,
      call.checked,
      call.notChecked,
      call.cannotCover,
    );
  }
  // #endregion coverage

  // #region verdict
  const evidence = readTurnEvidenceVerdict(recording, runId);
  if (evidence.status === 'unsupported') {
    console.log(evidence.items ?? 'The recording did not serve the unsupported items.');
  } else {
    console.log(evidence.status);
  }
  // #endregion verdict
}

if (isCliEntry(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
