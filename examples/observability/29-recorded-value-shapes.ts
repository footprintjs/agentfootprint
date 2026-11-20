import { Agent } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { contextShapeAt, recordRun } from '../../src/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/29-recorded-value-shapes',
  title: 'Record value types and array lengths',
  group: 'observability',
  description: 'Read the length of the recorded message history without opening its messages.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'recording', 'context'],
};

// #region history
export async function run() {
  const agent = Agent.create({ provider: mock({ reply: 'Ready.' }), model: 'mock' }).build();
  const recorder = recordRun(agent);
  try {
    await agent.run({ message: 'Describe the sample.' });
    const snapshot = agent.getLastSnapshot();
    const commit = (snapshot?.commitLog?.length ?? 0) - 1;
    const history = contextShapeAt(snapshot?.contextShapes, commit, ['history']);
    if (history[0] === 'array') console.log(`Message count at commit ${commit}: ${history[1]}`);
    return recorder.toRecording();
  } finally {
    recorder.stop();
  }
}
// #endregion history

if (isCliEntry(import.meta.url)) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
