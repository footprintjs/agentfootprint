/**
 * 27 — save context through an injected value table; narrate call changes.
 * The CLI demonstrates a synthetic change list. recordExample() is the full
 * recording path, run by a host with a concrete value-table writer and reader.
 * The candidate contract exercises that path with foottrace's real adapter.
 */
import { Agent } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import {
  recordContextRun,
  readContextRecording,
  contextCallCommentary,
  type ContextCallChange,
  type ContextValueWriter,
  type OpenContextValues,
} from '../../src/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/27-context-values',
  title: 'Context recorded once, each call as changes',
  group: 'observability',
  description:
    'Opt-in value-table recording with unchanged model requests; call prose reads the change list.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'recording', 'context'],
};

// #region record
export async function recordExample(values: ContextValueWriter, open: OpenContextValues) {
  const agent = Agent.create({ provider: mock({ reply: 'Complete.' }), model: 'mock' })
    .system('Use the declared evidence and state its limits.')
    .build();
  const recorder = recordContextRun(agent, values); // BEFORE run()
  try {
    await agent.run({ message: 'Summarize the declared task.' });
  } finally {
    recorder.stop();
  }
  const saved = await recorder.toRecording();
  const read = await readContextRecording(JSON.parse(JSON.stringify(saved)), open);
  return { saved, recording: read.recording, lines: read.calls.map(contextCallCommentary) };
}
// #endregion record

export async function run() {
  // A synthetic fixture: these are declared example values, not live telemetry.
  const change = {
    call: 4,
    added: [],
    removed: [],
    unchanged: 30,
    counts: { steering: 12, tools: 18 },
  } as unknown as ContextCallChange;
  const line = contextCallCommentary(change);
  console.log('Synthetic change-list narration:', line);
  return line;
}

if (isCliEntry(import.meta.url))
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
