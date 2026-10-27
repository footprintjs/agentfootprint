/** 114 — query an acknowledged saved root without a model or synthetic snapshot. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { fileSink, readRecordFile } from 'footprintjs/sinks';
import { controlDepRecorder } from 'footprintjs/trace';
import {
  readStoredCauseArtifacts,
  traceCauseTools,
  callTraceTool,
} from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/114-saved-cause-tools',
  title: 'Saved root and impact — no model',
  group: 'features',
  description:
    'Load one authorized saved root, preserve storage limits and query recorded evidence.',
  defaultInput: null,
  providerSlots: [],
  tags: ['feature', 'trace', 'debugging', 'evidence'],
};

export async function run() {
  const directory = await mkdtemp(join(tmpdir(), 'saved-cause-example-'));
  const sink = fileSink(join(directory, 'run.jsonl'));
  try {
    // #region saved-cause
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
    const runId = executor.getSnapshot().runId;
    await sink.close();

    // The host authorizes this file and run. Neither is a tool argument.
    const saved = await readRecordFile(sink.path);
    if (saved.unreadable.length) throw new Error('Saved evidence has unreadable entries.');
    const result = await readStoredCauseArtifacts(saved.entries, { runId });
    if (result.status !== 'ready')
      return { status: result.status, reason: result.reason, modelCalls: 0 };
    const tools = traceCauseTools(result.cause, { maxNodes: 100, timeoutMs: 1_000 });
    const attention = JSON.parse(await callTraceTool(tools, 'attention_list'));
    const nodeId = attention.finding.nodes[0].nodeId;
    const root = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId }));
    const impact = JSON.parse(await callTraceTool(tools, 'impact', { nodeId }));
    // #endregion saved-cause
    if (root.finding.rootCause !== nodeId || impact.finding.nodes.length === 0)
      throw new Error('Expected recorded root and downstream evidence.');
    return { root, impact, modelCalls: 0 };
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
