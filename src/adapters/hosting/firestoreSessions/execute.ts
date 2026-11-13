import { FlowChartExecutor } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { Facts, Outcome } from './call.js';
import type { SessionRunObserver } from './record.js';

export async function execute<T, C extends Outcome>(
  chart: FlowChart<unknown, TypedScope<Facts>>,
  call: C,
  observe?: SessionRunObserver,
): Promise<T> {
  const executor = new FlowChartExecutor(chart, { readTracking: 'summary', commitValues: 'delta' });
  await executor.run({ input: Object.freeze({ call: () => call }) });
  if (observe !== undefined)
    observe({ operation: chart.root.id ?? chart.root.name, snapshot: executor.getSnapshot() });
  if (call.failed) throw call.error;
  return call.value as T;
}
