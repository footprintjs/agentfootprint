/** 112 — query a recorded failed native prefix without executing a model. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { fileSink, readRecordFile } from 'footprintjs/sinks';
import { controlDepRecorder } from 'footprintjs/trace';
import {
  callTraceTool,
  readStoredCauseArtifacts,
  traceCauseTools,
} from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/112-closed-native-prefix-cause',
  title: 'A saved failed native prefix — no model',
  group: 'features',
  description:
    'Localize a recorded failed invocation while keeping its outcome and limitations explicit.',
  defaultInput: null,
  providerSlots: [],
  tags: ['feature', 'trace', 'debugging', 'evidence'],
};

export async function run() {
  const directory = await mkdtemp(join(tmpdir(), 'closed-prefix-cause-'));
  const sink = fileSink(join(directory, 'run.jsonl'));
  try {
    // #region closed-prefix-cause
    const original = Error('Synthetic failed invocation');
    const chart = flowChart(
      'Reject request',
      () => {
        throw original;
      },
      'reject',
    )
      .setLogger({ info() {}, log() {}, debug() {}, warn() {}, error() {} })
      .build();
    const executor = new FlowChartExecutor(chart, {
      captureCoverage: true,
      captureExtent: true,
      captureClosure: true,
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
    try {
      await executor.run();
      throw Error('Expected the native invocation to fail.');
    } catch (error) {
      if (error !== original) throw error;
    }
    const runId = executor.getSnapshot().runId;
    await sink.close();
    const saved = await readRecordFile(sink.path);
    if (saved.unreadable.length) throw Error('Saved evidence has unreadable entries.');
    const result = await readStoredCauseArtifacts(saved.entries, { runId });
    if (result.status !== 'ready')
      return { status: result.status, reason: result.reason, modelCalls: 0 };
    const tools = traceCauseTools(result.cause);
    const attention = JSON.parse(await callTraceTool(tools, 'attention_list'));
    const nodeId = attention.finding.nodes[0]?.nodeId;
    if (typeof nodeId !== 'string') throw Error('No recorded failure node was returned.');
    const root = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId }));
    const impact = JSON.parse(await callTraceTool(tools, 'impact', { nodeId }));
    // This localizes the recorded failure; it does not explain an unrecorded physical cause.
    return {
      admission: result.cause.admission,
      root,
      impact,
      originalErrorPreserved: true,
      modelCalls: 0,
    };
    // #endregion closed-prefix-cause
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
