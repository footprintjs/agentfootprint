import { Agent, allow, inMemoryArtifacts } from '../../src/index.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type { AgentHost, HostHandler, HostReply } from '../../src/hosting/index.js';
import { mock } from '../../src/llm-providers.js';
import { trustBoundaryRecorder } from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'artifacts/hosted-recording-receipt',
  title: 'Receive a hosted recording with bounded trust facts',
  group: 'artifacts',
  description: 'File the native recording and read its exact receipt within the host binding.',
  defaultInput: 'Please show the summary.',
  providerSlots: [],
  tags: ['artifacts', 'hosting', 'trust'],
};

export async function run(input: string) {
  // #region capture
  const agent = Agent.create({
    provider: mock({ reply: 'Here is the summary.' }),
    model: 'mock',
    artifacts: {
      store: inMemoryArtifacts(),
      recordings: { trustBoundaries: () => trustBoundaryRecorder({ maxFacts: 25 }) },
    },
  })
    .act({ input: [{ name: 'allow-demo-request', onMessage: () => allow() }] })
    .build();
  // #endregion capture

  let deliver: HostHandler | undefined;
  const host: AgentHost = {
    name: 'in-process-demo',
    capabilities: [],
    serve: async (handler) => {
      deliver = handler;
      return { close: async () => undefined };
    },
  };
  const handle = await standingAgent({ agent, host, sessions: memorySessions() });
  try {
    let answer: string | undefined;
    let verifiedRecordingBytes: number | undefined;
    // #region receipt
    const reply: HostReply = {
      complete: (output) => void (answer = output),
      fail: (error) => {
        throw error;
      },
      turnArtifacts: async (turn) => {
        if (!turn.bound || !turn.recording) return;
        const { ref, bytes } = turn.recording;
        const metadata = await turn.artifacts.head(ref);
        if (metadata?.kind === 'recording/run' && metadata.bytes === bytes) {
          verifiedRecordingBytes = bytes;
        }
      },
    };
    // #endregion receipt
    if (!deliver) throw new Error('The demo host is unavailable.');
    await deliver({ input, sessionId: 'local-demo' }, reply);
    if (!answer || verifiedRecordingBytes === undefined)
      throw new Error('Expected a completed turn and its recording receipt.');
    return { answer, verifiedRecordingBytes };
  } finally {
    await handle.close();
  }
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput!).then(printResult, (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
