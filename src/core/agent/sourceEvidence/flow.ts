import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { ToolExecutionContext } from '../../../tools/tools.js';
import { throwIfAborted } from '../../../lib/abort.js';

/** Raw parcels/capabilities stay in this invocation's closures; the chart records fixed outcomes only. */
export async function runSourceEvidenceFlow(
  context: ToolExecutionContext,
  steps: readonly { readonly id: string; readonly run: () => void | Promise<void> }[],
): Promise<void> {
  const first = steps[0];
  if (!first) return;
  let failed = false,
    failure: unknown;
  const run =
    (step: typeof first) =>
    async (scope: { completed: number; phase: string; $break(reason: string): void }) => {
      try {
        throwIfAborted(context.signal);
        await step.run();
        throwIfAborted(context.signal);
        scope.phase = step.id;
        scope.completed = (scope.completed ?? 0) + 1;
      } catch (error) {
        // Store/callback diagnostics and abort reasons never enter native stage failures.
        failed = true;
        failure = error;
        scope.phase = 'unavailable';
        scope.$break('source-evidence-unavailable');
      }
    };
  let builder = flowChart<{ completed: number; phase: string }>(first.id, run(first), first.id);
  for (const step of steps.slice(1)) builder = builder.addFunction(step.id, run(step), step.id);
  const executor = new FlowChartExecutor(builder.build());
  if (context.redact) executor.setRedactionPolicy(context.redact);
  // Cancellation is checked inside each bounded step; its private reason stays in the closure.
  await executor.run({ input: {} });
  if (failed) throw failure;
}
