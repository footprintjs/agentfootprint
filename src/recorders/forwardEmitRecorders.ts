/**
 * forwardEmitRecorders — runner-side helper that attaches any
 * EmitRecorder-shaped consumer to the executor's emit channel.
 *
 * Why this exists: `runner.recorder(rec)` accepts both `AgentRecorder`
 * (semantic events via RecorderBridge) and `EmitRecorder` (raw emit
 * events). The runner's stored array is typed loosely; this helper
 * does the shape detection in ONE place so every runner's `run()`
 * can route by calling a single line.
 *
 * Without this, `contextEngineering()` (and any other consumer that
 * implements `onEmit`) silently drops events because RecorderBridge
 * doesn't know about the emit channel.
 *
 * Usage inside a runner's `.run()`, after the executor is created:
 *
 *   forwardEmitRecorders(executor, this.recorders);
 */
export function forwardEmitRecorders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  executor: { attachEmitRecorder(r: any): void },
  recorders: ReadonlyArray<unknown>,
): void {
  for (const rec of recorders) {
    if (rec && typeof (rec as { onEmit?: unknown }).onEmit === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      executor.attachEmitRecorder(rec as any);
    }
  }
}
