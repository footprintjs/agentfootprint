import { Agent } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { recordRun } from '../../src/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/28-recorded-value-shapes',
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
    const index = agent.getLastSnapshot()?.contextShapes;
    for (const [commit, entries] of index?.changes ?? []) {
      for (const [path, type, length] of entries) {
        if (path.length === 1 && path[0] === 'history' && type === 'array') {
          console.log(`Message count at commit ${commit}: ${length}`);
        }
      }
    }
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
