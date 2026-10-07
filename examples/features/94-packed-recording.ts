/**
 * 94 — A long run's recording, packed: every repeated value written once.
 *
 * A plain recording repeats the conversation once per place that saw it, so
 * its JSON grows with the square of the iteration count — with 1,000-row tool
 * results it passes JSON's string limit before 80 iterations and cannot be
 * saved at all. `packRecording` writes each repeated value once;
 * `unpackRecording` reads it back (and hands a plain recording back
 * untouched), byte for byte the plain recording's JSON.
 *
 * It reads a packed recording only up to a bound on the PLAIN recording it
 * stands for: a few KB packed can stand for billions of bytes, and a reader
 * that walks the result as a tree does that much work. A host passes the same
 * ceiling it puts on a plain recording.
 *
 * Run:  npm run example examples/features/94-packed-recording.ts
 */
import assert from 'node:assert/strict';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import {
  packRecording,
  PackedRecordingTooLargeError,
  recordRun,
  unpackRecording,
} from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/94-packed-recording',
  title: 'Packed recordings',
  group: 'features',
  description:
    'A mock agent calls a 500-row tool twelve times. The plain recording repeats every result once per place that saw it; the packed one writes each once and reads back to the same JSON.',
  defaultInput: 'Read the rows twelve times.',
  providerSlots: [],
  tags: ['features', 'observability'],
};

export async function run(input: string): Promise<unknown> {
  const rows = defineTool<{ page: number }, unknown>({
    name: 'rows',
    description: 'Returns one page of 500 rows.',
    inputSchema: { type: 'object', properties: { page: { type: 'number' } } },
    execute: ({ page }) =>
      Array.from({ length: 500 }, (_, i) => ({ id: i, name: `row-${page}-${i}` })),
  });
  const replies = [
    ...Array.from({ length: 12 }, (_, i) => ({
      toolCalls: [{ id: `call-${i + 1}`, name: 'rows', args: { page: i + 1 } }],
    })),
    { content: 'Read all twelve pages.' },
  ];
  const agent = Agent.create({ provider: mock({ replies }), model: 'mock', maxIterations: 20 })
    .tools([rows])
    .build();

  // #region pack
  const recorder = recordRun(agent);
  await agent.run({ message: input });
  recorder.stop();
  const recording = recorder.toRecording();

  const plain = JSON.stringify(recording);
  const packed = JSON.stringify(packRecording(recording)); // what you store or send

  // Reading it back: one call reads either shape.
  const readBack = unpackRecording(JSON.parse(packed));
  // #endregion pack

  assert.equal(JSON.stringify(readBack), plain);
  assert.ok(packed.length * 10 < plain.length);

  // #region bound
  // A host that explains recordings other people send holds a packed one to the
  // ceiling it puts on a plain one — measured over the packed form, before
  // anything is expanded.
  const ceiling = 16 * 1024 * 1024;
  let refused = false;
  try {
    unpackRecording(JSON.parse(packed), { maxBytes: ceiling });
  } catch (err) {
    refused = err instanceof PackedRecordingTooLargeError; // ~36 MB plain: over it
  }
  // #endregion bound

  assert.ok(refused);
  return {
    plainKB: Math.round(plain.length / 1024),
    packedKB: Math.round(packed.length / 1024),
    events: readBack.events.length,
    refusedOver16MiB: refused,
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
