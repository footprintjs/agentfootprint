/**
 * 132 — Open a saved recording and read one invocation, not the whole run.
 *
 * A finished run's recording is an artifact. `openSavedRecording` opens it by
 * its ref, through a store already bound to one scope, and serves three reads:
 * the root (the recording without its subflow results), one invocation's
 * result, or the whole recording. A recording saved in parts reads only the
 * part that holds what was asked for; a whole recording is read once and cut
 * the same way, so both layouts answer the same values.
 *
 * Every read answers a value or a fixed reason, never a fallback: an
 * invocation that was not recorded is `not-recorded`, a part that is gone is
 * `part-missing`, a part whose bytes changed is `part-changed`.
 *
 * Run:  npm run example examples/features/132-saved-recording.ts
 */
import assert from 'node:assert/strict';
import {
  Agent,
  bindArtifacts,
  defineTool,
  inMemoryArtifacts,
  recordingPutInput,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { openSavedRecording, recordRun } from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/132-saved-recording',
  title: 'Open a saved recording',
  group: 'features',
  description:
    'A mock agent calls a tool twice. Its recording is saved as an artifact, opened by ref, and one invocation is read on its own.',
  defaultInput: 'Read two pages.',
  providerSlots: [],
  tags: ['features', 'observability'],
};

export async function run(input: string): Promise<unknown> {
  const pages = defineTool<{ page: number }, unknown>({
    name: 'pages',
    description: 'Returns one page of rows.',
    inputSchema: { type: 'object', properties: { page: { type: 'number' } } },
    execute: ({ page }) => Array.from({ length: 20 }, (_, i) => ({ id: i, page })),
  });
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'one', name: 'pages', args: { page: 1 } }] },
        { toolCalls: [{ id: 'two', name: 'pages', args: { page: 2 } }] },
        { content: 'Read both pages.' },
      ],
    }),
    model: 'mock',
    reactMode: 'dynamic-grouped',
  })
    .tool(pages)
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: input });
  recorder.stop();

  const store = inMemoryArtifacts();
  const scope = { conversationId: 'example' };
  const saved = await store.put(
    scope,
    recordingPutInput(recorder.toRecording(), { runId: 'run-1' }),
  );

  // #region open
  const artifacts = bindArtifacts(store, scope); // one scope: a ref from any other is not-found
  const opened = await openSavedRecording(artifacts, saved.meta.ref, {
    maxRootBytes: 16 * 1024 * 1024, // checked from metadata before any bytes are read
  });
  if (opened.status !== 'ready') throw new Error(`not opened: ${opened.reason}`);

  const root = await opened.readRoot(); // { snapshot, events, structure } without subflow results
  const first = opened.invocations[0]!; // { key, path, subflowId, recorded, bytes }
  const call = await opened.readInvocation(first.key);
  const unknown = await opened.readInvocation('no-such-mount#0');
  // #endregion open

  assert.equal(root.status, 'ready');
  assert.equal(call.status, 'ready');
  assert.deepEqual(unknown, { status: 'unavailable', reason: 'not-recorded' });
  const whole = await opened.readWhole();
  assert.equal(whole.status, 'ready');
  await agent.shutdown();

  return {
    layout: opened.layout,
    complete: opened.complete,
    invocations: opened.invocations.length,
    nested: opened.invocations.filter((invocation) => invocation.path.length > 1).length,
    firstInvocation: { key: first.key, subflowId: first.subflowId, bytes: first.bytes },
    unknownKey: unknown,
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput!)
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
