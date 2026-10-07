/**
 * bench/recordings/run.mjs — how a recording grows with a run's length.
 *
 * A mock-provider agent calls one tool K times; each call returns R rows
 * (default 1,000). For each K it reports what the recording holds and what it
 * costs to keep: the event stream under the default cap (count, dropped, the
 * first iteration still in it), the plain recording's JSON length (or that it
 * is past JSON's string limit and cannot be minted at all), the packed
 * recording's length, and the packer's reads (`packCounted` — every member
 * value it reads, both passes). Counts, not times: the run's own time is
 * printed for orientation only.
 *
 * Linear means 4× the iterations cost ~4× — the plain recording costs ~16×.
 * The SHA-256 and UTF-8 work of the receipt mint is counted per call in
 * test/lib/time-travel/receipt-incremental.test.ts (it needs a hook into the
 * hash, which the built package does not expose).
 *
 * Run it standalone, nothing else on the machine (no paid calls — mock only):
 *
 *   npm run build && node --max-old-space-size=8192 bench/recordings/run.mjs
 *   KS=10,20,40,80,100 ROWS=1000 node --max-old-space-size=8192 bench/recordings/run.mjs
 */
import { Agent, defineTool } from '../../dist/esm/index.js';
import { mock } from '../../dist/esm/providers.js';
import { recordRun } from '../../dist/esm/observe.js';
import { packCounted } from '../../dist/esm/recorders/observability/recordingPack.js';
import { toWireJson } from '../../dist/esm/lib/wireJson.js';

const KS = (process.env.KS ?? '10,20,40,80').split(',').map(Number);
const ROWS = Number(process.env.ROWS ?? 1000);

const rowsTool = defineTool({
  name: 'rows',
  description: 'returns rows',
  inputSchema: { type: 'object', properties: { k: { type: 'number' } } },
  execute: (args) =>
    Array.from({ length: ROWS }, (_, i) => ({
      id: i,
      name: `row-${args.k}-${i}`,
      v: (i * 7) % 13,
    })),
});

async function measure(K) {
  const replies = [
    ...Array.from({ length: K }, (_, i) => ({
      toolCalls: [{ id: `c${i + 1}`, name: 'rows', args: { k: i + 1 } }],
    })),
    { content: 'done' },
  ];
  const agent = Agent.create({ provider: mock({ replies }), model: 'm', maxIterations: K + 5 })
    .tools([rowsTool])
    .build();
  const recorder = recordRun(agent);
  const t0 = performance.now();
  await agent.run({ message: 'go' });
  const runMs = performance.now() - t0;
  recorder.stop();
  const recording = recorder.toRecording();
  const first = recording.events.find((e) => e.type === 'agentfootprint.stream.llm_start');
  let plain;
  try {
    plain = toWireJson(recording).length;
  } catch {
    plain = null; // past JSON's string limit — this recording cannot be minted plain
  }
  const work = { members: 0 };
  const packed = JSON.stringify(packCounted(recording, work)).length;
  return {
    K,
    events: recording.events.length,
    dropped: recorder.droppedEvents,
    firstIteration: first?.payload.iteration,
    plainMB: plain === null ? 'over the limit' : +(plain / 1e6).toFixed(2),
    packedMB: +(packed / 1e6).toFixed(2),
    packReads: work.members,
    runMs: Math.round(runMs),
  };
}

const rows = [];
for (const K of KS) rows.push(await measure(K));
console.log(`R = ${ROWS} rows per tool result\n`);
console.log(
  '| K | events | dropped | first iteration | plain MB | packed MB | pack reads | run ms |',
);
console.log('|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) {
  console.log(
    `| ${r.K} | ${r.events} | ${r.dropped} | ${r.firstIteration} | ${r.plainMB} | ${r.packedMB} | ${r.packReads} | ${r.runMs} |`,
  );
}
