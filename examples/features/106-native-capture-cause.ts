/** 106 — a native captured run, queried without a model or custom graph. */
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';
import { traceToolpack, callTraceTool } from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/106-native-capture-cause',
  title: 'Native captured root and impact — no model',
  group: 'features',
  description:
    'Read the engine capture note and retained control evidence; keep incomplete captures uncertain.',
  defaultInput: null,
  providerSlots: [],
  tags: ['feature', 'trace', 'debugging', 'evidence'],
};

export async function run() {
  // #region native-capture
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
  });
  executor.attachFlowRecorder(controlDepRecorder({ captureCoverage: true }));
  await executor.run();
  // Authorize this run before serving its snapshot. No custom CauseGraph or lookup is needed.
  const tools = traceToolpack({ snapshot: executor.getSnapshot() });
  const attention = JSON.parse(await callTraceTool(tools, 'attention_list'));
  const nodeId = attention.finding.nodes[0].nodeId;
  const root = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId }));
  const impact = JSON.parse(await callTraceTool(tools, 'impact', { nodeId }));
  // #endregion native-capture
  if (root.finding.rootCause !== nodeId || impact.finding.nodes.length === 0)
    throw new Error('Expected a native recorded root and downstream write.');
  return { root, impact, modelCalls: 0 };
}

if (isCliEntry(import.meta.url))
  run()
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
