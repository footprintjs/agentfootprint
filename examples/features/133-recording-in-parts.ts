/**
 * 133 — Save a run's recording in parts, then open one invocation of it.
 *
 * With `artifacts: { recordings: { layout: 'parts' } }` an agent files each
 * completed run as an index, a base part (the recording without its subflow
 * results) and invocation parts of about 1 MiB. The receipt names the index.
 * `openSavedRecording` then reads the index at open, and one invocation reads
 * only the one part that holds it. What a sub-flow was handed and handed back
 * lives with it too: `readInvocation` serves those `payloads` beside the
 * result, and the root marks the step instead of holding a second copy.
 *
 * The cost is stated on the option: N + 2 store writes per turn instead of
 * one, and as many artifacts in the scope.
 *
 * Run:  npm run example examples/features/133-recording-in-parts.ts
 */
import assert from 'node:assert/strict';
import {
  Agent,
  bindArtifacts,
  defineTool,
  inMemoryArtifacts,
  RECORDING_INDEX_ARTIFACT_KIND,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { openSavedRecording } from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/133-recording-in-parts',
  title: 'Save a recording in parts',
  group: 'features',
  description:
    'A mock agent files its run recording in parts. The index is opened by its ref, and one invocation is read from the one part that holds it.',
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
  const store = inMemoryArtifacts();
  const scope = { conversationId: 'example' };

  // #region write
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
    artifacts: { store, recordings: { layout: 'parts' } }, // index + base part + parts
  })
    .tool(pages)
    .build();
  await agent.run({ message: input, identity: scope });
  // #endregion write

  // The index is the artifact a receipt names; here it is found by its kind.
  const listed = await store.list(scope);
  const index = listed.artifacts.find((row) => row.kind === RECORDING_INDEX_ARTIFACT_KIND)!;

  // #region read
  const opened = await openSavedRecording(bindArtifacts(store, scope), index.ref);
  if (opened.status !== 'ready') throw new Error(`not opened: ${opened.reason}`);
  const first = opened.invocations[0]!;
  const call = await opened.readInvocation(first.key); // reads the index's one part for this key
  // What the sub-flow was handed, kept with it (the root's event says `payloadWith: 'invocation'`).
  const handed = call.status === 'ready' ? call.payloads?.entry : undefined;
  // #endregion read

  assert.equal(opened.layout, 'parts');
  assert.equal(call.status, 'ready');
  assert.equal(handed?.status, 'ready');
  await agent.shutdown();

  return {
    layout: opened.layout,
    artifacts: opened.sizes.artifacts,
    storedBytes: opened.sizes.storedBytes,
    restoredBytes: opened.sizes.restoredBytes,
    invocations: opened.invocations.length,
    firstInvocation: { key: first.key, bytes: first.bytes, input: handed?.status },
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
