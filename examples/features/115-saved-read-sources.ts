/** 115 — recorded read versions with native ownership, without a model. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { fileSink, readRecordFile } from 'footprintjs/sinks';
import { controlDepRecorder } from 'footprintjs/trace';
import { createRecordGraph } from 'foottrace/cause';
import {
  readStoredCauseArtifacts,
  traceCauseTools,
  callTraceTool,
} from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/115-saved-read-sources',
  title: 'Saved exact read sources — no model',
  group: 'features',
  description:
    'Use native producer ownership to ask about a saved execution, while output derivation stays uncertain.',
  defaultInput: null,
  providerSlots: [],
  tags: ['feature', 'trace', 'debugging', 'evidence'],
};

export async function run() {
  const directory = await mkdtemp(join(tmpdir(), 'saved-source-example-'));
  const sink = fileSink(join(directory, 'run.jsonl'));
  try {
    // #region saved-exact-read
    let attempts = 0;
    const chart = flowChart<{ quote: number; total: number }>(
      'Quote',
      (scope) => {
        if (++attempts === 1) throw new Error('Synthetic first-attempt failure');
        scope.quote = 4;
      },
      'quote',
    )
      .retry({ attempts: 2 })
      .addFunction(
        'Total',
        (scope) => {
          scope.total = scope.quote;
        },
        'total',
      )
      .build();
    const executor = new FlowChartExecutor(chart, {
      captureCoverage: true,
      readSources: true,
      readTracking: 'full',
      writeTracking: 'full',
      writeProvenance: 'reads-prefix',
      sink: {
        adapter: sink,
        capture: { acknowledge: (target, context) => sink.acknowledge(target, context) },
      },
    });
    executor.attachFlowRecorder(controlDepRecorder({ captureCoverage: true }));
    await executor.run();
    const snapshot = executor.getSnapshot();
    await sink.close();
    // Both the path and the run were authorized by the host, never by tool arguments.
    const saved = await readRecordFile(sink.path);
    if (saved.unreadable.length) throw new Error('Saved evidence is unreadable.');
    const admitted = await readStoredCauseArtifacts(saved.entries, { runId: snapshot.runId });
    if (admitted.status !== 'ready')
      return { status: admitted.status, reason: admitted.reason, modelCalls: 0 };
    const tools = traceCauseTools(admitted.cause);
    const total = snapshot.commitLog.find((bundle) => bundle.stageId === 'total')!;
    const ids = createRecordGraph([]);
    const nodeId = ids.nodeId(snapshot.logAddress!, { runtimeStageId: total.runtimeStageId });
    const root = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId }));
    const impact = JSON.parse(
      await callTraceTool(tools, 'impact', { nodeId: root.finding.rootCause }),
    );
    // A recorded read does not prove that this particular output used it.
    const output = ids.nodeId(snapshot.logAddress!, {
      runtimeStageId: total.runtimeStageId,
      commitIdx: snapshot.commitLog.indexOf(total),
      key: 'total',
    });
    const derivation = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId: output }));
    // #endregion saved-exact-read
    if (root.finding.rootCause === undefined || derivation.finding.rootCause !== undefined)
      throw new Error('Expected exact execution evidence and uncertain output derivation.');
    return { root, impact, derivation, modelCalls: 0 };
  } finally {
    await sink.close();
    await rm(directory, { recursive: true, force: true });
  }
}

if (isCliEntry(import.meta.url))
  run()
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
